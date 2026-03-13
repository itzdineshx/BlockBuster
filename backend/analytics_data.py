"""Analytics dataset builder for dashboard, flow, suspicious activity, and alerts."""

from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
BACKEND_DIR = Path(__file__).resolve().parent


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if value is None or not str(value).strip():
        raise RuntimeError(f"Missing required environment variable: {name}")
    return str(value).strip()


def _env_or_default(name: str, default: str) -> str:
    value = os.environ.get(name)
    if value is None or not str(value).strip():
        return default
    return str(value).strip()


def _resolve_dataset_path(raw_path: str) -> Path:
    dataset_path = Path(raw_path).expanduser()
    if not dataset_path.is_absolute():
        dataset_path = (BACKEND_DIR / dataset_path).resolve()
    return dataset_path


def _clamp(value: float, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, int(round(value))))


def _as_float(value: object, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if text == "" or text.lower() == "nan":
        return default
    try:
        return float(text)
    except ValueError:
        return default


def _find_col(columns: list[str], needle: str) -> str | None:
    needle_lower = needle.lower()
    for col in columns:
        if needle_lower in col.lower():
            return col
    return None


def _wallet_type(risk: int, tx_count: int) -> str:
    if risk >= 90:
        return "darkweb"
    if risk >= 80:
        return "mixer"
    if tx_count >= 500:
        return "exchange"
    if tx_count >= 150:
        return "defi"
    return "wallet"


def build_analytics_dataset() -> dict:
    """Build a complete analytics payload from a wallet-level CSV dataset."""
    dataset_path = _resolve_dataset_path(_env_or_default("TRANSACTION_DATASET_PATH", "../data/transaction_dataset.csv"))
    sample_size = max(20, int(_env_or_default("ANALYTICS_SAMPLE_SIZE", "140")))
    eth_usd_price = max(500.0, _as_float(_env_or_default("ETH_USD_PRICE", "3500"), 3500.0))

    if not dataset_path.exists():
        raise FileNotFoundError(
            f"Dataset file not found at '{dataset_path}'. Set TRANSACTION_DATASET_PATH in your environment."
        )

    df = pd.read_csv(dataset_path)
    if df.empty:
        return {
            "walletNodes": [],
            "transactions": [],
            "alerts": [],
            "volumeData": [],
            "riskDistData": [],
            "hourlyAlerts": [],
        }

    columns = list(df.columns)
    address_col = _find_col(columns, "address")
    flag_col = _find_col(columns, "flag")
    sent_col = _find_col(columns, "sent tnx")
    received_col = _find_col(columns, "received tnx")
    total_tx_col = _find_col(columns, "total transactions")
    avg_sent_col = _find_col(columns, "avg val sent")
    total_sent_col = _find_col(columns, "total ether sent")
    total_received_col = _find_col(columns, "total ether received")
    balance_col = _find_col(columns, "total ether balance")
    token_sent_col = _find_col(columns, "most sent token type")
    token_recv_col = _find_col(columns, "most rec token")

    if not address_col:
        raise ValueError("Dataset is missing an address column.")

    now = datetime.now(timezone.utc)

    wallet_nodes: list[dict] = []
    for _, row in df.head(sample_size).iterrows():
        address = str(row.get(address_col, "")).strip().lower()
        if not _ADDRESS_RE.match(address):
            continue

        is_flagged = int(_as_float(row.get(flag_col, 0))) == 1 if flag_col else False
        sent_tnx = int(_as_float(row.get(sent_col, 0))) if sent_col else 0
        recv_tnx = int(_as_float(row.get(received_col, 0))) if received_col else 0
        total_tnx = int(_as_float(row.get(total_tx_col, sent_tnx + recv_tnx)))
        total_sent = _as_float(row.get(total_sent_col, 0)) if total_sent_col else 0.0
        total_received = _as_float(row.get(total_received_col, 0)) if total_received_col else 0.0
        avg_sent = _as_float(row.get(avg_sent_col, 0)) if avg_sent_col else 0.0
        balance = _as_float(row.get(balance_col, total_received - total_sent)) if balance_col else total_received - total_sent
        token_sent = str(row.get(token_sent_col, "ETH")).strip() if token_sent_col else "ETH"
        token_recv = str(row.get(token_recv_col, "ETH")).strip() if token_recv_col else "ETH"

        activity_boost = min(28, (sent_tnx + recv_tnx) / 35)
        balance_penalty = 10 if balance < 0 else 0
        base_risk = 72 if is_flagged else 15
        risk = _clamp(base_risk + activity_boost + balance_penalty)

        wallet_nodes.append(
            {
                "id": f"wallet_{len(wallet_nodes) + 1}",
                "address": address,
                "label": f"Wallet {len(wallet_nodes) + 1}",
                "risk": risk,
                "type": _wallet_type(risk, total_tnx),
                "flagged": bool(is_flagged or risk >= 80),
                "balance": round(balance, 6),
                "currency": "ETH",
                "transactionCount": total_tnx,
                "firstSeen": (now - timedelta(days=360 - (len(wallet_nodes) % 150))).strftime("%Y-%m-%d"),
                "lastActive": (now - timedelta(hours=len(wallet_nodes) % 96)).strftime("%Y-%m-%d"),
                "country": "Unknown",
                "tags": [
                    "dataset",
                    token_sent if token_sent else "ETH",
                    token_recv if token_recv else "ETH",
                    "flagged" if is_flagged else "normal",
                ],
                "_sent_tnx": sent_tnx,
                "_avg_sent": avg_sent,
                "_total_sent": total_sent,
            }
        )

    if len(wallet_nodes) < 2:
        return {
            "walletNodes": [],
            "transactions": [],
            "alerts": [],
            "volumeData": [],
            "riskDistData": [],
            "hourlyAlerts": [],
        }

    transactions: list[dict] = []
    for idx, src in enumerate(wallet_nodes):
        sent_tnx = max(1, int(src["_sent_tnx"]))
        avg_sent = max(0.001, float(src["_avg_sent"]))
        tx_count = min(4, max(1, sent_tnx // 250 + 1))

        for hop in range(tx_count):
            dst_index = (idx + hop * 7 + 3) % len(wallet_nodes)
            if dst_index == idx:
                dst_index = (dst_index + 1) % len(wallet_nodes)
            dst = wallet_nodes[dst_index]

            multiplier = 0.7 + (hop * 0.35)
            amount = round(max(0.0005, avg_sent * multiplier), 6)
            usd_value = round(amount * eth_usd_price, 2)
            timestamp = (now - timedelta(hours=(idx * 2 + hop * 5) % 240, minutes=(idx * 7) % 60)).isoformat()
            suspicious = bool(src["flagged"] or dst["flagged"] or amount > 10)

            if src["type"] in {"mixer", "darkweb"} or dst["type"] in {"mixer", "darkweb"}:
                reason = "Mixer to dark web transfer"
            elif amount > 20:
                reason = "Large transfer"
            elif suspicious:
                reason = "High-risk counterparty interaction"
            else:
                reason = "Normal"

            tx_hash = hashlib.sha1(f"{src['address']}-{dst['address']}-{hop}".encode("utf-8")).hexdigest()[:24]
            risk_score = _clamp((src["risk"] + dst["risk"]) / 2 + (25 if suspicious else 0))

            transactions.append(
                {
                    "id": f"tx_{len(transactions) + 1}",
                    "from": src["id"],
                    "to": dst["id"],
                    "amount": amount,
                    "currency": "ETH",
                    "usdValue": usd_value,
                    "timestamp": timestamp,
                    "suspicious": suspicious,
                    "reason": reason,
                    "gasPrice": round(10 + ((idx + hop) % 60), 2),
                    "blockNumber": 19_800_000 + idx * 10 + hop,
                    "hash": f"0x{tx_hash}",
                    "riskScore": risk_score,
                }
            )

    transactions.sort(key=lambda tx: tx["timestamp"], reverse=True)

    alerts: list[dict] = []
    suspicious_transactions = [tx for tx in transactions if tx["suspicious"]]
    for idx, tx in enumerate(suspicious_transactions[:120], start=1):
        severity = "critical" if tx["riskScore"] >= 90 else "high" if tx["riskScore"] >= 75 else "medium"

        if "mixer" in (tx.get("reason") or "").lower() or tx["riskScore"] >= 90:
            alert_type = "darkweb_wallet"
        elif tx["amount"] > 20:
            alert_type = "large_transaction"
        elif tx["amount"] > 8:
            alert_type = "rapid_transactions"
        else:
            alert_type = "phishing"

        alerts.append(
            {
                "id": f"alert_{idx}",
                "type": alert_type,
                "severity": severity,
                "walletAddress": tx["hash"],
                "description": f"{tx['reason']} between {tx['from']} and {tx['to']}",
                "amount": tx["amount"],
                "currency": tx["currency"],
                "timestamp": tx["timestamp"],
                "read": idx % 4 == 0,
                "resolved": idx % 9 == 0,
            }
        )

    # Volume chart uses 7-day buckets.
    daily_totals: dict[str, dict[str, int]] = {}
    for tx in transactions:
        day = tx["timestamp"][:10]
        if day not in daily_totals:
            daily_totals[day] = {"volume": 0, "suspicious": 0}
        daily_totals[day]["volume"] += 1
        if tx["suspicious"]:
            daily_totals[day]["suspicious"] += 1

    volume_data = [
        {
            "date": day,
            "volume": values["volume"],
            "suspicious": values["suspicious"],
        }
        for day, values in sorted(daily_totals.items())[-7:]
    ]

    buckets = [(0, 20), (20, 40), (40, 60), (60, 80), (80, 101)]
    risk_dist_data = []
    for low, high in buckets:
        count = sum(1 for w in wallet_nodes if low <= int(w["risk"]) < high)
        risk_dist_data.append(
            {
                "range": f"{low}-{high - 1}",
                "count": count,
                "label": f"Risk {low}-{high - 1}",
            }
        )

    hourly_map = {f"{hour:02d}": 0 for hour in range(24)}
    for alert in alerts:
        ts = datetime.fromisoformat(alert["timestamp"])
        hourly_map[f"{ts.hour:02d}"] += 1

    hourly_alerts = [
        {
            "hour": hour,
            "alerts": count,
        }
        for hour, count in hourly_map.items()
    ]

    # Remove internal helper fields before returning.
    clean_wallet_nodes = []
    for wallet in wallet_nodes:
        clean_wallet = {k: v for k, v in wallet.items() if not k.startswith("_")}
        clean_wallet_nodes.append(clean_wallet)

    return {
        "walletNodes": clean_wallet_nodes,
        "transactions": transactions,
        "alerts": alerts,
        "volumeData": volume_data,
        "riskDistData": risk_dist_data,
        "hourlyAlerts": hourly_alerts,
    }