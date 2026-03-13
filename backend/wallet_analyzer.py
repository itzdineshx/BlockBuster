"""
CryptoFlow Analyzer — wallet analysis engine.
Receives a list of raw Etherscan transactions and returns
suspicious-pattern detection results plus a risk score.
"""

import pandas as pd
from datetime import datetime, timedelta
from typing import Any

# -----------------------------------------------------------------
# Known high-risk address sets (Ethereum mainnet examples)
# In production, replace / extend these from a threat-intel feed.
# -----------------------------------------------------------------
KNOWN_MIXERS = {
    "0x722122df12d4e14e13ac3b6895a86e84145b6967",  # Tornado Cash Router
    "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",  # Tornado Cash Proxy
    "0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936",  # Tornado Cash 0.1 ETH
    "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf",  # Tornado Cash 1 ETH
    "0xa160cdab225685da1d56aa342ad8841c3b53f291",  # Tornado Cash 10 ETH
    "0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144",  # Tornado Cash 100 ETH
}

KNOWN_DARKWEB = {
    "0x7f367cc41522ce07553e823bf3be79a889debe1b",  # OFAC-sanctioned
    "0xd882cfc20f52f2599d84b8e8d58c7fb62cfe344b",
}

WEI_TO_ETH = 1e-18


# -----------------------------------------------------------------
# Core analysis function
# -----------------------------------------------------------------

def analyze_transactions(raw_transactions: list[dict], wallet_address: str | None = None) -> dict:
    """
    Analyse a list of Etherscan transaction dicts.

    Returns a dict with:
      - total_transactions
      - suspicious_transactions  (list of flagged tx hashes + reasons)
      - risk_score               (0–100)
      - transaction_flow         (list of simplified tx objects)
    """

    if not raw_transactions:
        return {
            "total_transactions": 0,
            "suspicious_transactions": [],
            "risk_score": 0,
            "transaction_flow": [],
            "explainability": {
                "decision": "low_risk",
                "summary": "No transactions found for this wallet",
                "reasons": ["No on-chain activity available for analysis"],
                "signals": {
                    "high_risk_counterparties": 0,
                    "suspicious_transaction_ratio": 0.0,
                    "large_transactions": 0,
                },
            },
        }

    df = _build_dataframe(raw_transactions)
    suspicious = _detect_suspicious(df)
    risk_score = _calculate_risk_score(df, suspicious)
    transaction_flow = _build_flow(df)
    explainability = _build_explainability(df, suspicious, risk_score, wallet_address)

    return {
        "total_transactions": len(df),
        "suspicious_transactions": suspicious,
        "risk_score": risk_score,
        "transaction_flow": transaction_flow,
        "explainability": explainability,
    }


# -----------------------------------------------------------------
# Internal helpers
# -----------------------------------------------------------------

def _build_dataframe(txs: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(txs)

    # Normalise types
    df["value_eth"] = pd.to_numeric(df.get("value", 0), errors="coerce").fillna(0) * WEI_TO_ETH
    df["timeStamp"] = pd.to_numeric(df.get("timeStamp", 0), errors="coerce").fillna(0)
    df["datetime"] = pd.to_datetime(df["timeStamp"], unit="s", utc=True)
    df["from"] = df.get("from", "").str.lower()
    df["to"] = df.get("to", "").str.lower()
    df["hash"] = df.get("hash", "")
    df["gas"] = pd.to_numeric(df.get("gas", 0), errors="coerce").fillna(0)
    df["gasPrice"] = pd.to_numeric(df.get("gasPrice", 0), errors="coerce").fillna(0)
    df["isError"] = df.get("isError", "0")

    return df.sort_values("datetime").reset_index(drop=True)


def _detect_suspicious(df: pd.DataFrame) -> list[dict]:
    """Return a list of {hash, reason, value_eth, timestamp} for flagged txs."""
    flagged: dict[str, dict] = {}  # keyed by tx hash to avoid duplicates

    def _flag(row, reason: str):
        h = row["hash"]
        if h not in flagged:
            flagged[h] = {
                "hash": h,
                "from": row["from"],
                "to": row["to"],
                "value_eth": round(row["value_eth"], 6),
                "timestamp": row["datetime"].isoformat(),
                "reasons": [],
            }
        flagged[h]["reasons"].append(reason)

    mixer_addresses = KNOWN_MIXERS | KNOWN_DARKWEB

    for _, row in df.iterrows():
        # 1. Interaction with known mixer / dark-web address
        if row["from"] in mixer_addresses or row["to"] in mixer_addresses:
            _flag(row, "Interaction with known mixer or sanctioned address")

        # 2. Very large single transfer (> 10 ETH)
        if row["value_eth"] > 10:
            _flag(row, f"Large transfer: {row['value_eth']:.4f} ETH")

        # 3. Round-number transfer (common in layering) — only for values > 0.1 ETH
        if row["value_eth"] > 0.1:
            remainder = row["value_eth"] % 1.0
            if remainder < 0.001 or remainder > 0.999:
                _flag(row, "Suspiciously round transaction amount")

        # 4. Failed transactions with non-zero value (probing attack)
        if row["isError"] == "1" and row["value_eth"] > 0:
            _flag(row, "Failed transaction with non-zero value")

    # 5. Rapid burst: > 5 transactions within any 10-minute window
    if len(df) >= 5:
        window = timedelta(minutes=10)
        times = df["datetime"].tolist()
        for i in range(len(times)):
            burst = [j for j in range(len(times)) if abs((times[j] - times[i]).total_seconds()) <= window.total_seconds()]
            if len(burst) > 5:
                for j in burst:
                    _flag(df.iloc[j], "Part of rapid transaction burst (>5 txs in 10 min)")

    # 6. Circular flow: funds sent and received between same address pair
    sent = set(zip(df["from"], df["to"]))
    received = set(zip(df["to"], df["from"]))
    circular_pairs = sent & received
    if circular_pairs:
        for _, row in df.iterrows():
            pair = (row["from"], row["to"])
            if pair in circular_pairs:
                _flag(row, "Circular transaction pattern detected")

    return list(flagged.values())


def _calculate_risk_score(df: pd.DataFrame, suspicious: list[dict]) -> int:
    """Produce a 0–100 risk score."""
    score = 0.0
    total = len(df)

    if total == 0:
        return 0

    # Proportion of suspicious transactions
    sus_ratio = len(suspicious) / total
    score += sus_ratio * 55  # up to 55 points
    if sus_ratio >= 0.5:
        score += 15
    elif sus_ratio >= 0.3:
        score += 8

    if len(suspicious) >= 5:
        score += 10

    # Mixer / dark-web involvement → immediate high score
    mixer_addresses = KNOWN_MIXERS | KNOWN_DARKWEB
    has_mixer = df["from"].isin(mixer_addresses) | df["to"].isin(mixer_addresses)
    if has_mixer.any():
        score += 35

    # Large volume
    total_eth = df["value_eth"].sum()
    if total_eth > 1000:
        score += 20
    elif total_eth > 100:
        score += 12
    elif total_eth > 10:
        score += 6

    # Single-transfer outlier detection (important for scam drain patterns)
    max_tx_eth = float(df["value_eth"].max()) if total else 0.0
    if max_tx_eth > 10_000:
        score += 25
    elif max_tx_eth > 1_000:
        score += 18
    elif max_tx_eth > 100:
        score += 12
    elif max_tx_eth > 10:
        score += 6

    # High tx count in short time
    if total > 0:
        timespan = (df["datetime"].max() - df["datetime"].min()).total_seconds()
        if timespan > 0:
            rate = total / (timespan / 3600)  # txs per hour
            if rate > 60:
                score += 10
            elif rate > 20:
                score += 5

    # Boost when suspicious reasons indicate structural laundering patterns.
    all_reasons = " ".join(
        reason.lower()
        for tx in suspicious
        for reason in tx.get("reasons", [])
        if isinstance(reason, str)
    )
    if "circular transaction pattern" in all_reasons:
        score += 8
    if "rapid transaction burst" in all_reasons:
        score += 8
    if "failed transaction with non-zero value" in all_reasons:
        score += 5

    return min(100, round(score))


def _build_flow(df: pd.DataFrame) -> list[dict]:
    """Simplified transaction list for the frontend flow visualiser."""
    return [
        {
            "hash": row["hash"],
            "from": row["from"],
            "to": row["to"],
            "value_eth": round(row["value_eth"], 6),
            "timestamp": row["datetime"].isoformat(),
            "is_error": row["isError"] == "1",
        }
        for _, row in df.iterrows()
    ]


def _build_explainability(
    df: pd.DataFrame,
    suspicious: list[dict[str, Any]],
    risk_score: int,
    wallet_address: str | None,
) -> dict[str, Any]:
    total = len(df)
    suspicious_ratio = (len(suspicious) / total) if total else 0.0

    wallet = (wallet_address or "").strip().lower()
    mixer_addresses = KNOWN_MIXERS | KNOWN_DARKWEB
    high_risk_counterparties = set()
    for _, row in df.iterrows():
        frm = str(row.get("from", "")).lower()
        to = str(row.get("to", "")).lower()
        if frm in mixer_addresses and frm != wallet:
            high_risk_counterparties.add(frm)
        if to in mixer_addresses and to != wallet:
            high_risk_counterparties.add(to)

    reasons: list[str] = []
    if high_risk_counterparties:
        reasons.append(f"Interacts with {len(high_risk_counterparties)} known high-risk wallets")

    if suspicious_ratio >= 0.4:
        reasons.append(f"High suspicious transaction ratio ({suspicious_ratio * 100:.1f}%)")

    if total >= 10:
        hours = max(1.0, (df["datetime"].max() - df["datetime"].min()).total_seconds() / 3600)
        tx_per_hour = total / hours
        if tx_per_hour > 30:
            reasons.append(f"Abnormal transaction frequency ({tx_per_hour:.1f} tx/hour)")

    large_tx_count = int((df["value_eth"] > 10).sum())
    if large_tx_count > 0:
        reasons.append(f"Contains {large_tx_count} large-value transfers (>10 ETH)")

    if not reasons:
        reasons.append("No dominant high-risk pattern detected; monitoring suggested")

    decision = "flagged" if risk_score >= 70 else "monitor" if risk_score >= 40 else "low_risk"
    summary = f"Wallet {decision.replace('_', ' ')} with risk score {risk_score}/100"

    return {
        "decision": decision,
        "summary": summary,
        "reasons": reasons,
        "signals": {
            "high_risk_counterparties": len(high_risk_counterparties),
            "suspicious_transaction_ratio": round(suspicious_ratio, 4),
            "large_transactions": large_tx_count,
        },
    }
