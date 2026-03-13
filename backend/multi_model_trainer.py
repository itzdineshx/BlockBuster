"""Train separate ML models for multiple AI features in the fraud analytics stack."""

from __future__ import annotations

import os
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


def _default_dataset_path() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "transaction_dataset.csv"


def _default_artifact_dir() -> Path:
    return Path(__file__).resolve().parent / "models"


def _default_download_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "external"


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
    ds_path = Path(dataset_path or os.environ.get("TRANSACTION_DATASET_PATH", _default_dataset_path()))
    model_dir = Path(artifact_dir or os.environ.get("WALLET_ML_MODEL_DIR", _default_artifact_dir()))
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

    return summary
