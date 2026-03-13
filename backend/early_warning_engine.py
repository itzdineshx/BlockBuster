"""Early warning engine for crypto wallets.

This module detects leading risk signals from wallet transaction activity so
operators can respond before risk escalates into confirmed fraud.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from wallet_analyzer import KNOWN_DARKWEB, KNOWN_MIXERS

WEI_TO_ETH = 1e-18
_ETH_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

DEFAULT_WARNING_CONFIG: dict[str, float | int] = {
    "window_hours": 24,
    "tx_spike_factor": 2.5,
    "min_tx_for_spike": 8,
    "outflow_spike_factor": 3.0,
    "outflow_spike_min_eth": 8.0,
    "large_transfer_eth": 25.0,
    "failed_rate_threshold": 0.30,
    "failed_tx_min": 3,
    "drainage_ratio": 2.8,
    "drainage_min_outflow_eth": 12.0,
    "new_counterparty_ratio": 0.65,
    "counterparty_churn_min": 6,
    "burst_window_minutes": 10,
    "burst_tx_threshold": 10,
    "circular_counterparty_threshold": 3,
}

_CONFIG_LIMITS: dict[str, tuple[float, float]] = {
    "window_hours": (1, 168),
    "tx_spike_factor": (1.1, 20.0),
    "min_tx_for_spike": (2, 200),
    "outflow_spike_factor": (1.1, 30.0),
    "outflow_spike_min_eth": (0.001, 10_000.0),
    "large_transfer_eth": (0.01, 100_000.0),
    "failed_rate_threshold": (0.01, 1.0),
    "failed_tx_min": (1, 200),
    "drainage_ratio": (1.05, 50.0),
    "drainage_min_outflow_eth": (0.001, 10_000.0),
    "new_counterparty_ratio": (0.05, 1.0),
    "counterparty_churn_min": (2, 500),
    "burst_window_minutes": (1, 180),
    "burst_tx_threshold": (2, 500),
    "circular_counterparty_threshold": (1, 100),
}

_CONFIG_ENV_MAP: dict[str, str] = {
    "window_hours": "EWS_WINDOW_HOURS",
    "tx_spike_factor": "EWS_TX_SPIKE_FACTOR",
    "min_tx_for_spike": "EWS_MIN_TX_FOR_SPIKE",
    "outflow_spike_factor": "EWS_OUTFLOW_SPIKE_FACTOR",
    "outflow_spike_min_eth": "EWS_OUTFLOW_SPIKE_MIN_ETH",
    "large_transfer_eth": "EWS_LARGE_TRANSFER_ETH",
    "failed_rate_threshold": "EWS_FAILED_RATE_THRESHOLD",
    "failed_tx_min": "EWS_FAILED_TX_MIN",
    "drainage_ratio": "EWS_DRAINAGE_RATIO",
    "drainage_min_outflow_eth": "EWS_DRAINAGE_MIN_OUTFLOW_ETH",
    "new_counterparty_ratio": "EWS_NEW_COUNTERPARTY_RATIO",
    "counterparty_churn_min": "EWS_COUNTERPARTY_CHURN_MIN",
    "burst_window_minutes": "EWS_BURST_WINDOW_MINUTES",
    "burst_tx_threshold": "EWS_BURST_TX_THRESHOLD",
    "circular_counterparty_threshold": "EWS_CIRCULAR_COUNTERPARTY_THRESHOLD",
}

_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}
_SEVERITY_WEIGHT = {"low": 7.0, "medium": 14.0, "high": 23.0, "critical": 34.0}


def _to_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _to_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, int):
        return int(value)
    return int(round(_to_float(value, float(default))))


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _safe_ratio(num: float, den: float, den_floor: float = 1e-9) -> float:
    return num / max(den, den_floor)


def _coerce_config_value(key: str, value: Any) -> float | int:
    if key not in DEFAULT_WARNING_CONFIG:
        raise ValueError(f"Unsupported config key: {key}")

    default = DEFAULT_WARNING_CONFIG[key]
    casted: float | int
    if isinstance(default, int):
        casted = _to_int(value, default)
    else:
        casted = _to_float(value, float(default))

    low, high = _CONFIG_LIMITS[key]
    if casted < low or casted > high:
        raise ValueError(f"{key} must be between {low} and {high}")

    if isinstance(default, int):
        return int(casted)
    return float(casted)


def get_warning_config(overrides: dict[str, Any] | None = None) -> dict[str, float | int]:
    """Load warning thresholds from environment and apply optional overrides."""
    config: dict[str, float | int] = dict(DEFAULT_WARNING_CONFIG)

    for key, env_name in _CONFIG_ENV_MAP.items():
        text = os.environ.get(env_name)
        if text is None or not str(text).strip():
            continue
        config[key] = _coerce_config_value(key, text)

    if overrides:
        for key, value in overrides.items():
            config[key] = _coerce_config_value(key, value)

    return config


def _build_dataframe(raw_transactions: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(raw_transactions)
    if df.empty:
        return pd.DataFrame(
            {
                "hash": [],
                "from": [],
                "to": [],
                "value_eth": [],
                "datetime": [],
                "is_error": [],
            }
        )

    df["hash"] = df.get("hash", "").fillna("").astype(str)
    df["from"] = df.get("from", "").fillna("").astype(str).str.lower().str.strip()
    df["to"] = df.get("to", "").fillna("").astype(str).str.lower().str.strip()

    values = pd.to_numeric(df.get("value", 0), errors="coerce").fillna(0)
    df["value_eth"] = values * WEI_TO_ETH

    timestamps = pd.to_numeric(df.get("timeStamp", 0), errors="coerce").fillna(0)
    df["datetime"] = pd.to_datetime(timestamps, unit="s", utc=True)

    errors = df.get("isError", "0").fillna("0").astype(str)
    df["is_error"] = errors == "1"

    df = df.dropna(subset=["datetime"])
    return df.sort_values("datetime").reset_index(drop=True)


def _attach_wallet_context(df: pd.DataFrame, wallet_address: str) -> pd.DataFrame:
    wallet_df = df[(df["from"] == wallet_address) | (df["to"] == wallet_address)].copy()
    if wallet_df.empty:
        wallet_df["direction"] = []
        wallet_df["counterparty"] = []
        return wallet_df

    wallet_df["direction"] = "incoming"
    wallet_df.loc[wallet_df["from"] == wallet_address, "direction"] = "outgoing"

    wallet_df["counterparty"] = wallet_df["from"]
    incoming_mask = wallet_df["direction"] == "incoming"
    wallet_df.loc[incoming_mask, "counterparty"] = wallet_df.loc[incoming_mask, "from"]
    wallet_df.loc[~incoming_mask, "counterparty"] = wallet_df.loc[~incoming_mask, "to"]
    wallet_df["counterparty"] = wallet_df["counterparty"].fillna("").astype(str).str.lower().str.strip()

    return wallet_df


def _count_max_burst(wallet_df: pd.DataFrame, burst_window_minutes: int) -> tuple[int, str | None, str | None]:
    if wallet_df.empty:
        return 0, None, None

    timestamps = wallet_df["datetime"].tolist()
    if not timestamps:
        return 0, None, None

    max_count = 0
    max_left = 0
    max_right = 0
    left = 0
    window_seconds = burst_window_minutes * 60

    for right in range(len(timestamps)):
        while left <= right and (timestamps[right] - timestamps[left]).total_seconds() > window_seconds:
            left += 1
        count = right - left + 1
        if count > max_count:
            max_count = count
            max_left = left
            max_right = right

    return (
        max_count,
        timestamps[max_left].isoformat() if max_count > 0 else None,
        timestamps[max_right].isoformat() if max_count > 0 else None,
    )


def _alert_level(score: int) -> str:
    if score >= 75:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 25:
        return "medium"
    return "low"


def _build_warning(
    warning_id: str,
    category: str,
    severity: str,
    confidence: float,
    title: str,
    description: str,
    indicators: dict[str, Any],
    action: str,
    timestamp: datetime,
) -> dict[str, Any]:
    return {
        "id": warning_id,
        "category": category,
        "severity": severity,
        "confidence": round(float(_clamp(confidence, 0.01, 0.99)), 2),
        "title": title,
        "description": description,
        "indicators": indicators,
        "recommended_action": action,
        "timestamp": timestamp.isoformat(),
    }


def analyze_early_warnings(
    raw_transactions: list[dict],
    wallet_address: str,
    config_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Analyze wallet activity and produce early warning signals."""
    if not _ETH_ADDRESS_RE.match(wallet_address):
        raise ValueError("Invalid Ethereum wallet address format")

    if not isinstance(raw_transactions, list):
        raise ValueError("raw_transactions must be an array of transaction objects")

    config = get_warning_config(config_overrides)
    now = datetime.now(timezone.utc)

    tx_df = _build_dataframe(raw_transactions)
    wallet_df = _attach_wallet_context(tx_df, wallet_address.lower())

    if wallet_df.empty:
        return {
            "wallet_address": wallet_address.lower(),
            "generated_at": now.isoformat(),
            "summary": {
                "alert_level": "low",
                "risk_score": 0,
                "warning_count": 0,
                "critical_count": 0,
                "high_count": 0,
                "medium_count": 0,
                "low_count": 0,
            },
            "metrics": {
                "window_hours": int(config["window_hours"]),
                "transaction_count_recent": 0,
                "transaction_count_baseline": 0,
                "incoming_eth_recent": 0.0,
                "outgoing_eth_recent": 0.0,
                "net_flow_eth_recent": 0.0,
                "fail_rate_recent": 0.0,
                "counterparties_recent": 0,
                "new_counterparties": 0,
                "last_transaction_at": None,
            },
            "warnings": [],
            "config": config,
        }

    window_hours = int(config["window_hours"])
    window = timedelta(hours=window_hours)
    recent_start = now - window
    baseline_start = recent_start - window

    recent_df = wallet_df[(wallet_df["datetime"] >= recent_start) & (wallet_df["datetime"] <= now)].copy()
    baseline_df = wallet_df[(wallet_df["datetime"] >= baseline_start) & (wallet_df["datetime"] < recent_start)].copy()

    # Fallback so that old addresses with no very recent activity still receive
    # trend comparisons using latest available samples.
    if recent_df.empty and not wallet_df.empty:
        sample_size = min(max(10, int(config["min_tx_for_spike"]) * 2), len(wallet_df))
        recent_df = wallet_df.tail(sample_size).copy()
        baseline_df = wallet_df.iloc[max(0, len(wallet_df) - sample_size * 2) : len(wallet_df) - sample_size].copy()

    recent_in = recent_df[recent_df["direction"] == "incoming"]
    recent_out = recent_df[recent_df["direction"] == "outgoing"]
    baseline_in = baseline_df[baseline_df["direction"] == "incoming"]
    baseline_out = baseline_df[baseline_df["direction"] == "outgoing"]

    incoming_eth_recent = float(recent_in["value_eth"].sum()) if not recent_in.empty else 0.0
    outgoing_eth_recent = float(recent_out["value_eth"].sum()) if not recent_out.empty else 0.0
    incoming_eth_base = float(baseline_in["value_eth"].sum()) if not baseline_in.empty else 0.0
    outgoing_eth_base = float(baseline_out["value_eth"].sum()) if not baseline_out.empty else 0.0

    fail_count_recent = int(recent_df["is_error"].sum()) if not recent_df.empty else 0
    fail_rate_recent = _safe_ratio(float(fail_count_recent), float(len(recent_df))) if not recent_df.empty else 0.0

    counterparties_recent = set(recent_df["counterparty"].dropna().astype(str)) - {wallet_address.lower(), ""}
    counterparties_base = set(baseline_df["counterparty"].dropna().astype(str)) - {wallet_address.lower(), ""}
    new_counterparties = counterparties_recent - counterparties_base

    warnings: list[dict[str, Any]] = []

    def add_warning(
        category: str,
        severity: str,
        confidence: float,
        title: str,
        description: str,
        indicators: dict[str, Any],
        action: str,
    ) -> None:
        warnings.append(
            _build_warning(
                warning_id=f"warn_{len(warnings) + 1}",
                category=category,
                severity=severity,
                confidence=confidence,
                title=title,
                description=description,
                indicators=indicators,
                action=action,
                timestamp=now,
            )
        )

    high_risk_set = KNOWN_MIXERS | KNOWN_DARKWEB
    high_risk_hits = recent_df[recent_df["counterparty"].isin(high_risk_set)]
    if not high_risk_hits.empty:
        hit_addresses = sorted(set(high_risk_hits["counterparty"].tolist()))
        add_warning(
            category="sanctioned_interaction",
            severity="critical",
            confidence=0.96,
            title="Interaction with sanctioned or mixer address",
            description="Recent transactions touched known high-risk entities associated with sanctions or obfuscation.",
            indicators={
                "address_count": len(hit_addresses),
                "addresses": hit_addresses[:10],
                "tx_count": int(len(high_risk_hits)),
            },
            action="Escalate immediately, freeze automated payouts, and perform manual chain investigation.",
        )

    large_threshold = float(config["large_transfer_eth"])
    large_txs = recent_df[recent_df["value_eth"] >= large_threshold]
    if not large_txs.empty:
        max_eth = float(large_txs["value_eth"].max())
        severity = "critical" if max_eth >= large_threshold * 4 else "high"
        confidence = 0.62 if max_eth < large_threshold * 2 else 0.78
        add_warning(
            category="large_transfer",
            severity=severity,
            confidence=confidence,
            title="Unusually large transfer detected",
            description="Single-transfer size exceeded configured baseline and may indicate rapid fund movement.",
            indicators={
                "threshold_eth": round(large_threshold, 6),
                "max_transfer_eth": round(max_eth, 6),
                "tx_hashes": large_txs["hash"].head(5).tolist(),
            },
            action="Verify source of funds and destination ownership before allowing additional transfers.",
        )

    max_burst, burst_start, burst_end = _count_max_burst(recent_df, int(config["burst_window_minutes"]))
    burst_threshold = int(config["burst_tx_threshold"])
    if max_burst >= burst_threshold:
        burst_severity = "critical" if max_burst >= burst_threshold * 2 else "high"
        burst_confidence = 0.72 if max_burst < burst_threshold * 1.5 else 0.86
        add_warning(
            category="transaction_burst",
            severity=burst_severity,
            confidence=burst_confidence,
            title="Rapid transaction burst",
            description="Transaction frequency spiked sharply inside a short rolling window.",
            indicators={
                "burst_window_minutes": int(config["burst_window_minutes"]),
                "max_transactions_in_window": int(max_burst),
                "window_start": burst_start,
                "window_end": burst_end,
            },
            action="Temporarily rate-limit high-risk actions and investigate automated script behavior.",
        )

    min_tx_for_spike = int(config["min_tx_for_spike"])
    tx_spike_factor = float(config["tx_spike_factor"])
    recent_count = len(recent_df)
    baseline_count = len(baseline_df)

    activity_factor = float("inf") if baseline_count == 0 and recent_count > 0 else _safe_ratio(float(recent_count), float(baseline_count))
    if recent_count >= min_tx_for_spike and (baseline_count == 0 or activity_factor >= tx_spike_factor):
        severity = "high" if (baseline_count == 0 and recent_count >= min_tx_for_spike * 2) or activity_factor >= tx_spike_factor * 1.5 else "medium"
        confidence = 0.6 if severity == "medium" else 0.76
        add_warning(
            category="activity_spike",
            severity=severity,
            confidence=confidence,
            title="Activity spike versus baseline",
            description="Recent transaction throughput materially exceeded previous behavior.",
            indicators={
                "recent_tx_count": int(recent_count),
                "baseline_tx_count": int(baseline_count),
                "spike_factor": None if activity_factor == float("inf") else round(activity_factor, 3),
            },
            action="Increase monitoring frequency and require additional verification for high-value actions.",
        )

    outflow_spike_factor = float(config["outflow_spike_factor"])
    outflow_min_eth = float(config["outflow_spike_min_eth"])
    outflow_factor = float("inf") if outgoing_eth_base <= 0 and outgoing_eth_recent > 0 else _safe_ratio(outgoing_eth_recent, outgoing_eth_base)
    if outgoing_eth_recent >= outflow_min_eth and (
        (outgoing_eth_base == 0 and outgoing_eth_recent >= outflow_min_eth * 2) or outflow_factor >= outflow_spike_factor
    ):
        severity = "high" if outflow_factor < outflow_spike_factor * 1.5 else "critical"
        confidence = 0.67 if severity == "high" else 0.82
        add_warning(
            category="outflow_spike",
            severity=severity,
            confidence=confidence,
            title="Outflow velocity spike",
            description="Outgoing transfer volume increased faster than normal and may signal fund drainage.",
            indicators={
                "recent_outflow_eth": round(outgoing_eth_recent, 6),
                "baseline_outflow_eth": round(outgoing_eth_base, 6),
                "outflow_factor": None if outflow_factor == float("inf") else round(outflow_factor, 3),
            },
            action="Enable transfer holds for large outbound transactions until analyst approval.",
        )

    failed_rate_threshold = float(config["failed_rate_threshold"])
    failed_tx_min = int(config["failed_tx_min"])
    if fail_count_recent >= failed_tx_min and fail_rate_recent >= failed_rate_threshold:
        severity = "high" if fail_rate_recent >= failed_rate_threshold * 1.6 else "medium"
        confidence = _clamp(0.5 + fail_rate_recent, 0.55, 0.92)
        add_warning(
            category="failed_tx_spike",
            severity=severity,
            confidence=confidence,
            title="Failed transaction spike",
            description="Error rate increased, which can indicate probing, exploitation attempts, or nonce mismanagement.",
            indicators={
                "failed_tx_count": int(fail_count_recent),
                "recent_tx_count": int(recent_count),
                "fail_rate": round(fail_rate_recent, 3),
            },
            action="Inspect failure causes, nonce usage, and contract interactions before resuming normal throughput.",
        )

    drainage_ratio = float(config["drainage_ratio"])
    drainage_min_outflow = float(config["drainage_min_outflow_eth"])
    observed_ratio = _safe_ratio(outgoing_eth_recent, incoming_eth_recent, den_floor=0.01)
    if outgoing_eth_recent >= drainage_min_outflow and observed_ratio >= drainage_ratio:
        severity = "critical" if observed_ratio >= drainage_ratio * 1.5 else "high"
        confidence = 0.7 if severity == "high" else 0.88
        add_warning(
            category="fund_drainage",
            severity=severity,
            confidence=confidence,
            title="Potential wallet drainage pattern",
            description="Outflows dominated inflows in the recent window, consistent with liquidation or exfiltration behavior.",
            indicators={
                "incoming_eth_recent": round(incoming_eth_recent, 6),
                "outgoing_eth_recent": round(outgoing_eth_recent, 6),
                "outflow_to_inflow_ratio": round(observed_ratio, 3),
                "net_flow_eth": round(incoming_eth_recent - outgoing_eth_recent, 6),
            },
            action="Lock sensitive operations and require multi-party approval for further outbound transfers.",
        )

    churn_min = int(config["counterparty_churn_min"])
    churn_ratio = _safe_ratio(float(len(new_counterparties)), float(len(counterparties_recent))) if counterparties_recent else 0.0
    if len(counterparties_recent) >= churn_min and churn_ratio >= float(config["new_counterparty_ratio"]):
        severity = "high" if churn_ratio >= 0.85 else "medium"
        confidence = _clamp(0.5 + churn_ratio / 2, 0.55, 0.88)
        add_warning(
            category="counterparty_churn",
            severity=severity,
            confidence=confidence,
            title="Counterparty churn anomaly",
            description="Most counterparties in the recent window are new, which can indicate mule routing or evasive behavior.",
            indicators={
                "recent_counterparties": int(len(counterparties_recent)),
                "new_counterparties": int(len(new_counterparties)),
                "new_counterparty_ratio": round(churn_ratio, 3),
            },
            action="Expand KYC/attribution checks on newly contacted wallets before settlement.",
        )

    sent_to = set(recent_out["counterparty"].dropna().astype(str)) - {""}
    received_from = set(recent_in["counterparty"].dropna().astype(str)) - {""}
    circular_count = len(sent_to & received_from)
    circular_threshold = int(config["circular_counterparty_threshold"])
    if circular_count >= circular_threshold:
        circular_severity = "high" if circular_count >= circular_threshold * 2 else "medium"
        circular_confidence = 0.58 if circular_severity == "medium" else 0.74
        add_warning(
            category="circular_flow",
            severity=circular_severity,
            confidence=circular_confidence,
            title="Circular fund flow pattern",
            description="Bidirectional transfers with multiple counterparties were detected in a short horizon.",
            indicators={
                "circular_counterparty_count": int(circular_count),
                "sample_counterparties": sorted(list((sent_to & received_from)))[:10],
            },
            action="Review for layering behavior and correlate with external intelligence feeds.",
        )

    warnings.sort(key=lambda item: (_SEVERITY_RANK[item["severity"]], item["confidence"]), reverse=True)

    weighted_score = 0.0
    for warning in warnings:
        weighted_score += _SEVERITY_WEIGHT[warning["severity"]] * float(warning["confidence"])

    risk_score = int(min(100, round(weighted_score)))
    summary = {
        "alert_level": _alert_level(risk_score),
        "risk_score": risk_score,
        "warning_count": len(warnings),
        "critical_count": sum(1 for w in warnings if w["severity"] == "critical"),
        "high_count": sum(1 for w in warnings if w["severity"] == "high"),
        "medium_count": sum(1 for w in warnings if w["severity"] == "medium"),
        "low_count": sum(1 for w in warnings if w["severity"] == "low"),
    }

    metrics = {
        "window_hours": window_hours,
        "transaction_count_recent": int(recent_count),
        "transaction_count_baseline": int(baseline_count),
        "incoming_eth_recent": round(incoming_eth_recent, 6),
        "outgoing_eth_recent": round(outgoing_eth_recent, 6),
        "incoming_eth_baseline": round(incoming_eth_base, 6),
        "outgoing_eth_baseline": round(outgoing_eth_base, 6),
        "net_flow_eth_recent": round(incoming_eth_recent - outgoing_eth_recent, 6),
        "fail_rate_recent": round(float(fail_rate_recent), 4),
        "counterparties_recent": int(len(counterparties_recent)),
        "new_counterparties": int(len(new_counterparties)),
        "last_transaction_at": wallet_df["datetime"].max().isoformat() if not wallet_df.empty else None,
    }

    return {
        "wallet_address": wallet_address.lower(),
        "generated_at": now.isoformat(),
        "summary": summary,
        "metrics": metrics,
        "warnings": warnings,
        "config": config,
    }
