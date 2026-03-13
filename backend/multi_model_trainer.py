"""Train separate ML models for multiple AI features in the fraud analytics stack."""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
import requests
from sklearn.ensemble import GradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import IsolationForest

from fraud_model import train_wallet_risk_model


TARGET_COLUMN = "FLAG"
NON_FEATURE_COLUMNS = {"Index", "Address", TARGET_COLUMN}

MODEL_FILES = {
    "wallet_risk_classifier": "wallet_risk_model.joblib",
    "transaction_anomaly_detector": "transaction_anomaly_model.joblib",
    "counterparty_contagion_regressor": "counterparty_contagion_model.joblib",
    "behavior_shift_detector": "behavior_shift_model.joblib",
    "entity_type_classifier": "entity_type_model.joblib",
    "alert_prioritizer": "alert_prioritizer_model.joblib",
}

_DATAFRAME_CACHE: dict[str, tuple[float, pd.DataFrame]] = {}
_BUNDLE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_RESULT_CACHE: dict[tuple[Any, ...], tuple[float, list[dict[str, Any]]]] = {}
_RESULT_CACHE_TTL_SECONDS = 60.0
_RESULT_CACHE_MAX_ENTRIES = 256


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if value is None or not str(value).strip():
        raise RuntimeError(f"Missing required environment variable: {name}")
    return str(value).strip()


def _default_download_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "external"


def _invalidate_caches() -> None:
    _DATAFRAME_CACHE.clear()
    _BUNDLE_CACHE.clear()
    _RESULT_CACHE.clear()


def _get_dataset_df(ds_path: Path) -> pd.DataFrame:
    cache_key = str(ds_path.resolve())
    mtime = ds_path.stat().st_mtime
    cached = _DATAFRAME_CACHE.get(cache_key)
    if cached and cached[0] == mtime:
        return cached[1]

    df = _normalize_columns(pd.read_csv(ds_path))
    _DATAFRAME_CACHE[cache_key] = (mtime, df)
    return df


def _cleanup_result_cache(now: float) -> None:
    expired = [k for k, (ts, _) in _RESULT_CACHE.items() if now - ts > _RESULT_CACHE_TTL_SECONDS]
    for key in expired:
        _RESULT_CACHE.pop(key, None)

    if len(_RESULT_CACHE) > _RESULT_CACHE_MAX_ENTRIES:
        oldest = sorted(_RESULT_CACHE.items(), key=lambda item: item[1][0])
        for key, _ in oldest[: len(_RESULT_CACHE) - _RESULT_CACHE_MAX_ENTRIES]:
            _RESULT_CACHE.pop(key, None)


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.columns = [str(c).strip() for c in out.columns]
    return out


def _find_col(columns: list[str], needle: str) -> str | None:
    needle = needle.lower()
    for col in columns:
        if needle in col.lower():
            return col
    return None


def _numeric_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in out.columns:
        if col not in NON_FEATURE_COLUMNS:
            out[col] = pd.to_numeric(out[col], errors="coerce")

    keep = [
        c for c in out.columns
        if c not in NON_FEATURE_COLUMNS
        and not str(c).lower().startswith("unnamed")
        and pd.api.types.is_numeric_dtype(out[c])
        and not out[c].isna().all()
    ]
    return out[keep]


def _download_external_datasets(download_dir: Path) -> dict[str, Any]:
    sources = {
        "ofac_sdn.csv": "https://www.treasury.gov/ofac/downloads/sdn.csv",
        "darklist_urls.json": "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/urls/urls-darklist.json",
    }
    download_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, Any] = {}
    for name, url in sources.items():
        target = download_dir / name
        try:
            resp = requests.get(url, timeout=20)
            resp.raise_for_status()
            target.write_bytes(resp.content)
            report[name] = {"status": "downloaded", "url": url, "path": str(target), "bytes": len(resp.content)}
        except Exception as exc:
            report[name] = {"status": "failed", "url": url, "error": str(exc)}
    return report


def _derive_entity_label(row: pd.Series, sent_col: str | None, recv_col: str | None, contract_col: str | None) -> str:
    sent = float(row.get(sent_col, 0)) if sent_col else 0.0
    recv = float(row.get(recv_col, 0)) if recv_col else 0.0
    contracts = float(row.get(contract_col, 0)) if contract_col else 0.0

    if sent + recv > 800:
        return "exchange"
    if contracts > 20:
        return "contract_heavy"
    if sent > recv * 3 and sent > 100:
        return "mixer_like"
    if recv > sent * 2 and recv > 120:
        return "collector"
    return "retail"


def _split(X: pd.DataFrame, y: pd.Series, random_state: int = 42):
    return train_test_split(X, y, test_size=0.2, random_state=random_state, stratify=y if y.nunique() > 1 else None)


def train_all_models(
    dataset_path: str | None = None,
    artifact_dir: str | None = None,
    fetch_external: bool = True,
    random_state: int = 42,
) -> dict[str, Any]:
    ds_path = Path(dataset_path or _require_env("TRANSACTION_DATASET_PATH"))
    model_dir = Path(artifact_dir or _require_env("WALLET_ML_MODEL_DIR"))
    download_dir = _default_download_dir()

    if not ds_path.exists():
        raise FileNotFoundError(f"Dataset file not found: {ds_path}")

    model_dir.mkdir(parents=True, exist_ok=True)

    external_report = _download_external_datasets(download_dir) if fetch_external else {"status": "skipped"}

    df = _normalize_columns(pd.read_csv(ds_path))
    if df.empty:
        raise ValueError("Dataset is empty.")

    cols = list(df.columns)
    sent_col = _find_col(cols, "sent tnx")
    recv_col = _find_col(cols, "received tnx")
    total_col = _find_col(cols, "total transactions")
    balance_col = _find_col(cols, "total ether balance")
    contract_col = _find_col(cols, "created contracts")

    X_num = _numeric_features(df)

    summary: dict[str, Any] = {
        "dataset_path": str(ds_path),
        "rows": int(len(df)),
        "numeric_features": int(X_num.shape[1]),
        "external_data": external_report,
        "models": {},
    }

    # 1) Wallet risk classifier (supervised)
    wallet_model_path = model_dir / "wallet_risk_model.joblib"
    wallet_metrics = train_wallet_risk_model(
        dataset_path=str(ds_path),
        model_path=str(wallet_model_path),
        random_state=random_state,
    )
    summary["models"]["wallet_risk_classifier"] = wallet_metrics

    # 2) Transaction anomaly detector (unsupervised)
    anomaly_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("clf", IsolationForest(n_estimators=300, contamination=0.08, random_state=random_state)),
    ])
    anomaly_pipe.fit(X_num)
    anomaly_scores = anomaly_pipe.named_steps["clf"].decision_function(anomaly_pipe[:-1].transform(X_num))
    anomaly_preds = anomaly_pipe.named_steps["clf"].predict(anomaly_pipe[:-1].transform(X_num))
    anomaly_rate = float((anomaly_preds == -1).mean())
    anomaly_bundle = {
        "model": anomaly_pipe,
        "feature_columns": list(X_num.columns),
        "metadata": {"contamination": 0.08, "rows": int(len(X_num))},
    }
    anomaly_path = model_dir / "transaction_anomaly_model.joblib"
    joblib.dump(anomaly_bundle, anomaly_path)
    summary["models"]["transaction_anomaly_detector"] = {
        "model_path": str(anomaly_path),
        "anomaly_rate": anomaly_rate,
        "score_mean": float(pd.Series(anomaly_scores).mean()),
        "score_std": float(pd.Series(anomaly_scores).std()),
    }

    # 3) Counterparty contagion regressor (synthetic supervision)
    contagion_target = pd.Series(0.0, index=df.index)
    if sent_col:
        contagion_target += pd.to_numeric(df[sent_col], errors="coerce").fillna(0) * 0.04
    if recv_col:
        contagion_target += pd.to_numeric(df[recv_col], errors="coerce").fillna(0) * 0.03
    if balance_col:
        contagion_target += pd.to_numeric(df[balance_col], errors="coerce").fillna(0).abs() * 0.01
    contagion_target = contagion_target.clip(0, 100)

    X_train, X_test, y_train, y_test = train_test_split(X_num, contagion_target, test_size=0.2, random_state=random_state)
    contagion_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("reg", RandomForestRegressor(n_estimators=250, max_depth=12, random_state=random_state, n_jobs=-1)),
    ])
    contagion_pipe.fit(X_train, y_train)
    y_pred = contagion_pipe.predict(X_test)
    contagion_path = model_dir / "counterparty_contagion_model.joblib"
    joblib.dump({"model": contagion_pipe, "feature_columns": list(X_num.columns)}, contagion_path)
    summary["models"]["counterparty_contagion_regressor"] = {
        "model_path": str(contagion_path),
        "mae": float(mean_absolute_error(y_test, y_pred)),
        "r2": float(r2_score(y_test, y_pred)),
    }

    # 4) Behavioral shift detector (unsupervised)
    shift_df = pd.DataFrame(index=df.index)
    if sent_col and recv_col:
        sent = pd.to_numeric(df[sent_col], errors="coerce").fillna(0)
        recv = pd.to_numeric(df[recv_col], errors="coerce").fillna(0)
        shift_df["sent_recv_ratio"] = sent / (recv + 1)
        shift_df["activity_delta"] = (sent - recv).abs()
    if total_col:
        total = pd.to_numeric(df[total_col], errors="coerce").fillna(0)
        shift_df["total_tnx"] = total
        shift_df["rolling_jump"] = (total - total.rolling(window=12, min_periods=1).mean()).abs()
    if shift_df.empty:
        shift_df = X_num.iloc[:, : min(6, X_num.shape[1])].copy()

    shift_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("clf", IsolationForest(n_estimators=220, contamination=0.1, random_state=random_state)),
    ])
    shift_pipe.fit(shift_df)
    shift_preds = shift_pipe.named_steps["clf"].predict(shift_pipe[:-1].transform(shift_df))
    shift_path = model_dir / "behavior_shift_model.joblib"
    joblib.dump({"model": shift_pipe, "feature_columns": list(shift_df.columns)}, shift_path)
    summary["models"]["behavior_shift_detector"] = {
        "model_path": str(shift_path),
        "shift_rate": float((shift_preds == -1).mean()),
        "features": list(shift_df.columns),
    }

    # 5) Entity type classifier (pseudo labels for now)
    entity_labels = df.apply(lambda r: _derive_entity_label(r, sent_col, recv_col, contract_col), axis=1)
    X_train, X_test, y_train, y_test = _split(X_num, entity_labels, random_state=random_state)
    entity_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("clf", RandomForestClassifier(n_estimators=220, max_depth=11, random_state=random_state, class_weight="balanced", n_jobs=-1)),
    ])
    entity_pipe.fit(X_train, y_train)
    entity_pred = entity_pipe.predict(X_test)
    entity_path = model_dir / "entity_type_model.joblib"
    joblib.dump({"model": entity_pipe, "feature_columns": list(X_num.columns), "classes": sorted(entity_labels.unique().tolist())}, entity_path)
    summary["models"]["entity_type_classifier"] = {
        "model_path": str(entity_path),
        "accuracy": float(accuracy_score(y_test, entity_pred)),
        "f1_macro": float(f1_score(y_test, entity_pred, average="macro")),
        "classes": sorted(entity_labels.unique().tolist()),
    }

    # 6) Alert prioritization model (synthetic supervision)
    alert_priority = pd.Series(0.0, index=df.index)
    if TARGET_COLUMN in df.columns:
        alert_priority += pd.to_numeric(df[TARGET_COLUMN], errors="coerce").fillna(0) * 40
    if total_col:
        alert_priority += pd.to_numeric(df[total_col], errors="coerce").fillna(0).clip(0, 1000) * 0.03
    if balance_col:
        alert_priority += pd.to_numeric(df[balance_col], errors="coerce").fillna(0).abs().clip(0, 10000) * 0.01
    alert_priority = alert_priority.clip(0, 100)

    X_train, X_test, y_train, y_test = train_test_split(X_num, alert_priority, test_size=0.2, random_state=random_state)
    alert_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("reg", GradientBoostingRegressor(random_state=random_state)),
    ])
    alert_pipe.fit(X_train, y_train)
    alert_pred = alert_pipe.predict(X_test)
    alert_path = model_dir / "alert_prioritizer_model.joblib"
    joblib.dump({"model": alert_pipe, "feature_columns": list(X_num.columns)}, alert_path)
    summary["models"]["alert_prioritizer"] = {
        "model_path": str(alert_path),
        "mae": float(mean_absolute_error(y_test, alert_pred)),
        "r2": float(r2_score(y_test, alert_pred)),
    }

    # Retraining changes both dataset usage and model artifacts.
    _invalidate_caches()

    return summary


def _read_wallet_row(wallet_address: str, dataset_path: str | None = None) -> dict[str, Any]:
    ds_path = Path(dataset_path or _require_env("TRANSACTION_DATASET_PATH"))
    if not ds_path.exists():
        raise FileNotFoundError(f"Dataset file not found: {ds_path}")

    df = _get_dataset_df(ds_path)
    address_col = _find_col(list(df.columns), "address")
    if not address_col:
        raise ValueError("Dataset missing Address column.")

    key = wallet_address.strip().lower()
    matches = df[df[address_col].astype(str).str.lower().str.strip() == key]
    if matches.empty:
        raise ValueError(f"Wallet address {key} not found in dataset.")

    row = matches.iloc[0].to_dict()
    row.pop(address_col, None)
    return row


def _row_to_numeric_features(row: dict[str, Any], feature_columns: list[str]) -> pd.DataFrame:
    payload: dict[str, Any] = {}

    sent = pd.to_numeric(row.get("Sent tnx"), errors="coerce")
    recv = pd.to_numeric(row.get("Received Tnx"), errors="coerce")
    total = pd.to_numeric(row.get("total transactions (including tnx to create contract"), errors="coerce")

    for col in feature_columns:
        if col in row:
            payload[col] = pd.to_numeric(row.get(col), errors="coerce")
            continue

        # Derived feature fallback for behavior-shift model.
        if col == "sent_recv_ratio":
            s = 0.0 if pd.isna(sent) else float(sent)
            r = 0.0 if pd.isna(recv) else float(recv)
            payload[col] = s / (r + 1.0)
        elif col == "activity_delta":
            s = 0.0 if pd.isna(sent) else float(sent)
            r = 0.0 if pd.isna(recv) else float(recv)
            payload[col] = abs(s - r)
        elif col == "total_tnx":
            payload[col] = 0.0 if pd.isna(total) else float(total)
        elif col == "rolling_jump":
            payload[col] = 0.0
        else:
            payload[col] = None

    return pd.DataFrame([payload], columns=feature_columns)


def _load_bundle(model_dir: Path, key: str) -> dict[str, Any]:
    if key not in MODEL_FILES:
        raise ValueError(f"Unknown model key: {key}")

    path = model_dir / MODEL_FILES[key]
    if not path.exists():
        raise FileNotFoundError(f"Model artifact not found: {path}")

    cache_key = str(path.resolve())
    mtime = path.stat().st_mtime
    cached = _BUNDLE_CACHE.get(cache_key)
    if cached and cached[0] == mtime:
        return cached[1]

    bundle = joblib.load(path)
    if not isinstance(bundle, dict) or "model" not in bundle:
        raise ValueError(f"Invalid model bundle at {path}")
    _BUNDLE_CACHE[cache_key] = (mtime, bundle)
    return bundle


def _build_model_explainability(models: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []

    risk = models.get("wallet_risk_classifier", {})
    risk_score = float(risk.get("risk_score", 0.0) or 0.0)
    if risk_score >= 70:
        reasons.append(f"Wallet risk classifier is high ({risk_score:.1f}/100)")
    elif risk_score >= 45:
        reasons.append(f"Wallet risk classifier indicates moderate risk ({risk_score:.1f}/100)")

    anomaly = models.get("transaction_anomaly_detector", {})
    if bool(anomaly.get("is_anomaly")):
        reasons.append("Transaction pattern is anomalous compared to baseline behavior")

    shift = models.get("behavior_shift_detector", {})
    if bool(shift.get("behavior_shift_detected")):
        reasons.append("Behavior shift detector found an abrupt change in activity profile")

    contagion = models.get("counterparty_contagion_regressor", {})
    contagion_score = float(contagion.get("contagion_score", 0.0) or 0.0)
    if contagion_score >= 60:
        reasons.append(f"Counterparty contagion risk is elevated ({contagion_score:.1f}/100)")

    priority = models.get("alert_prioritizer", {})
    priority_score = float(priority.get("priority_score", 0.0) or 0.0)
    if priority_score >= 70:
        reasons.append(f"Alert prioritizer recommends urgent handling ({priority_score:.1f}/100)")

    entity_type = str(models.get("entity_type_classifier", {}).get("entity_type", "") or "")
    if entity_type in {"mixer_like", "contract_heavy"}:
        reasons.append(f"Entity profile classified as {entity_type.replace('_', ' ')}")

    if not reasons:
        reasons.append("AI models show low-risk baseline behavior")

    decision = "flagged" if any(
        [
            risk_score >= 70,
            bool(anomaly.get("is_anomaly")),
            bool(shift.get("behavior_shift_detected")),
            contagion_score >= 60,
            priority_score >= 70,
        ]
    ) else "monitor" if risk_score >= 45 or priority_score >= 45 else "low_risk"

    return {
        "decision": decision,
        "summary": f"AI decision: {decision.replace('_', ' ')}",
        "reasons": reasons,
    }


def predict_all_models_for_wallet(
    wallet_address: str,
    dataset_path: str | None = None,
    artifact_dir: str | None = None,
) -> dict[str, Any]:
    batch = predict_all_models_for_wallets(
        wallet_addresses=[wallet_address],
        dataset_path=dataset_path,
        artifact_dir=artifact_dir,
    )
    if not batch:
        raise ValueError(f"Wallet address {wallet_address.strip().lower()} not found in dataset.")
    return batch[0]


def predict_all_models_for_wallets(
    wallet_addresses: list[str],
    dataset_path: str | None = None,
    artifact_dir: str | None = None,
) -> list[dict[str, Any]]:
    ds_path = Path(dataset_path or _require_env("TRANSACTION_DATASET_PATH"))
    if not ds_path.exists():
        raise FileNotFoundError(f"Dataset file not found: {ds_path}")

    df = _get_dataset_df(ds_path)
    address_col = _find_col(list(df.columns), "address")
    if not address_col:
        raise ValueError("Dataset missing Address column.")

    wanted = {str(addr).strip().lower() for addr in wallet_addresses if str(addr).strip()}
    if not wanted:
        return []

    model_dir = Path(artifact_dir or _require_env("WALLET_ML_MODEL_DIR"))
    model_paths = [model_dir / name for name in MODEL_FILES.values()]
    for path in model_paths:
        if not path.exists():
            raise FileNotFoundError(f"Model artifact not found: {path}")

    dataset_mtime = ds_path.stat().st_mtime
    model_mtimes = tuple((name, path.stat().st_mtime) for name, path in zip(MODEL_FILES.keys(), model_paths))
    cache_key = (
        str(ds_path.resolve()),
        dataset_mtime,
        str(model_dir.resolve()),
        model_mtimes,
        tuple(sorted(wanted)),
    )

    now = time.monotonic()
    _cleanup_result_cache(now)
    cached_result = _RESULT_CACHE.get(cache_key)
    if cached_result and now - cached_result[0] <= _RESULT_CACHE_TTL_SECONDS:
        return cached_result[1]

    matches = df[df[address_col].astype(str).str.lower().str.strip().isin(wanted)]
    if matches.empty:
        return []

    bundles = {key: _load_bundle(model_dir, key) for key in MODEL_FILES.keys()}

    outputs: list[dict[str, Any]] = []
    for _, row_series in matches.iterrows():
        wallet_address = str(row_series[address_col]).strip().lower()
        row = row_series.to_dict()
        row.pop(address_col, None)

        out: dict[str, Any] = {
            "wallet_address": wallet_address,
            "models": {},
        }

        risk_bundle = bundles["wallet_risk_classifier"]
        X_risk = _row_to_numeric_features(row, risk_bundle.get("feature_columns", []))
        risk_model = risk_bundle["model"]
        risk_pred = int(risk_model.predict(X_risk)[0])
        risk_prob = float(risk_model.predict_proba(X_risk)[0][1]) if hasattr(risk_model, "predict_proba") else float(risk_pred)
        out["models"]["wallet_risk_classifier"] = {
            "prediction": risk_pred,
            "risk_probability": round(risk_prob, 6),
            "risk_score": round(risk_prob * 100, 2),
        }

        anomaly_bundle = bundles["transaction_anomaly_detector"]
        X_an = _row_to_numeric_features(row, anomaly_bundle.get("feature_columns", []))
        anomaly_model = anomaly_bundle["model"]
        anomaly_label = int(anomaly_model.predict(X_an)[0])
        anomaly_score = float(anomaly_model.decision_function(X_an)[0]) if hasattr(anomaly_model, "decision_function") else float(anomaly_label)
        out["models"]["transaction_anomaly_detector"] = {
            "is_anomaly": anomaly_label == -1,
            "raw_label": anomaly_label,
            "anomaly_score": round(anomaly_score, 6),
        }

        contagion_bundle = bundles["counterparty_contagion_regressor"]
        X_cont = _row_to_numeric_features(row, contagion_bundle.get("feature_columns", []))
        contagion_model = contagion_bundle["model"]
        contagion_score = float(contagion_model.predict(X_cont)[0])
        out["models"]["counterparty_contagion_regressor"] = {
            "contagion_score": round(max(0.0, min(100.0, contagion_score)), 4),
        }

        shift_bundle = bundles["behavior_shift_detector"]
        X_shift = _row_to_numeric_features(row, shift_bundle.get("feature_columns", []))
        shift_model = shift_bundle["model"]
        shift_label = int(shift_model.predict(X_shift)[0])
        shift_score = float(shift_model.decision_function(X_shift)[0]) if hasattr(shift_model, "decision_function") else float(shift_label)
        out["models"]["behavior_shift_detector"] = {
            "behavior_shift_detected": shift_label == -1,
            "raw_label": shift_label,
            "shift_score": round(shift_score, 6),
        }

        entity_bundle = bundles["entity_type_classifier"]
        X_ent = _row_to_numeric_features(row, entity_bundle.get("feature_columns", []))
        entity_model = entity_bundle["model"]
        out["models"]["entity_type_classifier"] = {
            "entity_type": str(entity_model.predict(X_ent)[0]),
        }

        alert_bundle = bundles["alert_prioritizer"]
        X_alert = _row_to_numeric_features(row, alert_bundle.get("feature_columns", []))
        alert_model = alert_bundle["model"]
        alert_score = float(alert_model.predict(X_alert)[0])
        out["models"]["alert_prioritizer"] = {
            "priority_score": round(max(0.0, min(100.0, alert_score)), 4),
        }

        out["explainability"] = _build_model_explainability(out["models"])

        outputs.append(out)

    _RESULT_CACHE[cache_key] = (now, outputs)
    _cleanup_result_cache(now)
    return outputs
