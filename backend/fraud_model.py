"""ML model utilities for wallet risk classification."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, classification_report, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


TARGET_COLUMN = "FLAG"
NON_FEATURE_COLUMNS = {"Index", "Address", TARGET_COLUMN}


class ModelNotTrainedError(RuntimeError):
    """Raised when a prediction is requested before model training."""


def _default_dataset_path() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "transaction_dataset.csv"


def _default_model_path() -> Path:
    return Path(__file__).resolve().parent / "models" / "wallet_risk_model.joblib"


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(col).strip() for col in df.columns]
    return df


def _find_target_column(columns: list[str]) -> str:
    for col in columns:
        if col.strip().lower() == TARGET_COLUMN.lower():
            return col
    raise ValueError("Dataset missing target column 'FLAG'.")


def _build_features(df: pd.DataFrame, target_col: str) -> tuple[pd.DataFrame, pd.Series, list[str]]:
    numeric_df = df.copy()

    # Convert everything to numeric where possible and keep only useful feature columns.
    for col in numeric_df.columns:
        if col not in {"Address", target_col}:
            numeric_df[col] = pd.to_numeric(numeric_df[col], errors="coerce")

    feature_candidates = [
        c for c in numeric_df.columns
        if c not in NON_FEATURE_COLUMNS
        and c != target_col
        and not str(c).strip().lower().startswith("unnamed")
        and pd.api.types.is_numeric_dtype(numeric_df[c])
    ]

    if not feature_candidates:
        raise ValueError("No numeric feature columns found for training.")

    # Drop columns that are completely empty.
    feature_columns = [c for c in feature_candidates if not numeric_df[c].isna().all()]
    if not feature_columns:
        raise ValueError("All numeric feature columns are empty after cleaning.")

    X = numeric_df[feature_columns]
    y = pd.to_numeric(numeric_df[target_col], errors="coerce").fillna(0).astype(int)
    return X, y, feature_columns


def train_wallet_risk_model(
    dataset_path: str | None = None,
    model_path: str | None = None,
    test_size: float = 0.2,
    random_state: int = 42,
) -> dict[str, Any]:
    """Train a wallet-risk classifier and persist the model bundle to disk."""
    ds_path = Path(dataset_path or os.environ.get("TRANSACTION_DATASET_PATH", _default_dataset_path()))
    out_path = Path(model_path or os.environ.get("WALLET_ML_MODEL_PATH", _default_model_path()))

    if not ds_path.exists():
        raise FileNotFoundError(f"Dataset file not found: {ds_path}")

    df = pd.read_csv(ds_path)
    if df.empty:
        raise ValueError("Dataset is empty.")

    df = _normalize_columns(df)
    target_col = _find_target_column(list(df.columns))

    X, y, feature_columns = _build_features(df, target_col)

    if y.nunique() < 2:
        raise ValueError("Training requires at least two classes in FLAG.")

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=test_size,
        random_state=random_state,
        stratify=y,
    )

    model = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("clf", RandomForestClassifier(
            n_estimators=250,
            max_depth=12,
            random_state=random_state,
            class_weight="balanced",
            n_jobs=-1,
        )),
    ])

    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    if hasattr(model, "predict_proba"):
        y_prob = model.predict_proba(X_test)[:, 1]
        auc = float(roc_auc_score(y_test, y_prob))
    else:
        auc = None

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bundle = {
        "model": model,
        "feature_columns": feature_columns,
        "target_column": target_col,
        "metadata": {
            "dataset_path": str(ds_path),
            "rows": int(len(df)),
            "features": len(feature_columns),
            "test_size": test_size,
            "random_state": random_state,
        },
    }
    joblib.dump(bundle, out_path)

    report = classification_report(y_test, y_pred, output_dict=True, zero_division=0)

    return {
        "model_path": str(out_path),
        "dataset_path": str(ds_path),
        "rows": int(len(df)),
        "features": len(feature_columns),
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
        "roc_auc": auc,
        "class_distribution": {
            "label_0": int((y == 0).sum()),
            "label_1": int((y == 1).sum()),
        },
        "classification_report": report,
    }


def load_model_bundle(model_path: str | None = None) -> dict[str, Any]:
    path = Path(model_path or os.environ.get("WALLET_ML_MODEL_PATH", _default_model_path()))
    if not path.exists():
        raise ModelNotTrainedError(
            f"Model file not found at {path}. Train the model first via /api/ml/train."
        )
    bundle = joblib.load(path)
    if "model" not in bundle or "feature_columns" not in bundle:
        raise ValueError("Invalid model bundle format.")
    return bundle


def _coerce_features(input_features: dict[str, Any], feature_columns: list[str]) -> pd.DataFrame:
    row = {}
    for col in feature_columns:
        row[col] = pd.to_numeric(input_features.get(col), errors="coerce")
    return pd.DataFrame([row], columns=feature_columns)


def predict_from_features(features: dict[str, Any], model_path: str | None = None) -> dict[str, Any]:
    bundle = load_model_bundle(model_path)
    model: Pipeline = bundle["model"]
    feature_columns: list[str] = bundle["feature_columns"]

    X = _coerce_features(features, feature_columns)
    pred = int(model.predict(X)[0])

    if hasattr(model, "predict_proba"):
        prob = float(model.predict_proba(X)[0][1])
    else:
        prob = float(pred)

    return {
        "prediction": pred,
        "risk_probability": round(prob, 6),
        "risk_score": round(prob * 100, 2),
        "used_features": feature_columns,
    }


def _get_address_column(columns: list[str]) -> str:
    for col in columns:
        if col.strip().lower() == "address":
            return col
    raise ValueError("Dataset missing Address column.")


def _get_wallet_row_features(wallet_address: str, dataset_path: str | None = None) -> dict[str, Any]:
    ds_path = Path(dataset_path or os.environ.get("TRANSACTION_DATASET_PATH", _default_dataset_path()))
    if not ds_path.exists():
        raise FileNotFoundError(f"Dataset file not found: {ds_path}")

    df = _normalize_columns(pd.read_csv(ds_path))
    address_col = _get_address_column(list(df.columns))

    wallet_address = wallet_address.strip().lower()
    matches = df[df[address_col].astype(str).str.lower().str.strip() == wallet_address]
    if matches.empty:
        raise ValueError(f"Wallet address {wallet_address} not found in dataset.")

    row = matches.iloc[0].to_dict()
    row.pop(address_col, None)
    return row


def predict_from_wallet_address(wallet_address: str, model_path: str | None = None, dataset_path: str | None = None) -> dict[str, Any]:
    features = _get_wallet_row_features(wallet_address=wallet_address, dataset_path=dataset_path)
    prediction = predict_from_features(features, model_path=model_path)
    prediction["wallet_address"] = wallet_address.lower().strip()
    return prediction
