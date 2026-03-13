"""AI-style investigation report generator for suspicious blockchain wallets."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _risk_label(risk_score: float) -> str:
    if risk_score > 70:
        return "High Risk"
    if risk_score >= 40:
        return "Medium Risk"
    return "Low Risk"


def _possible_pattern(
    suspicious_tx: int,
    unknown_wallets: int,
    total_volume: float,
) -> str:
    # Build a compact behavior profile based on observed wallet traits.
    if suspicious_tx > 10 and unknown_wallets > 5 and total_volume > 10:
        return (
            "Likely layered laundering behavior with rapid fund movement across "
            "multiple unknown counterparties and unusually high volume."
        )
    if suspicious_tx > 10 and total_volume > 10:
        return "Potential rapid-distribution or wash-transfer activity."
    if unknown_wallets > 5 and total_volume > 10:
        return "Broad distribution pattern to unverified wallets with elevated value transfer."
    if suspicious_tx > 10:
        return "Rapid transaction cycling pattern."
    if unknown_wallets > 5:
        return "Network expansion toward unverified counterparties."
    if total_volume > 10:
        return "High-value movement pattern requiring closer monitoring."
    return "No dominant criminal pattern identified; continue routine monitoring."


def _recommendation(risk_score: float) -> str:
    if risk_score > 70:
        return (
            "Escalate immediately: freeze/monitor associated flows, run enhanced due diligence, "
            "and prepare evidence package for compliance/legal review."
        )
    if risk_score >= 40:
        return (
            "Maintain active monitoring: increase alert sensitivity, review counterparties, "
            "and perform periodic reassessment."
        )
    return "Keep under standard monitoring and re-evaluate if new suspicious indicators emerge."


def _risk_level(risk_score: float) -> str:
    if risk_score > 70:
        return "HIGH RISK"
    if risk_score >= 40:
        return "MEDIUM RISK"
    return "LOW RISK"


def _format_date(date_like: str | None) -> str:
    if not date_like:
        return "N/A"
    text = str(date_like).strip()
    if not text:
        return "N/A"
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return text
    return dt.strftime("%d-%b-%Y")


def _default_report_id() -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"CRYPTO-INV-{ts}"


def generate_investigation_report(
    wallet_address: str,
    risk_score: float,
    suspicious_tx: int,
    unknown_wallets: int,
    total_volume: float,
) -> str:
    """Generate a formatted AI-style investigation report for a wallet."""
    risk_class = _risk_label(risk_score)

    reasons: list[str] = []
    if suspicious_tx > 10:
        reasons.append("Rapid transaction bursts detected (suspicious_tx > 10).")
    if unknown_wallets > 5:
        reasons.append("Frequent interaction with unknown wallets (unknown_wallets > 5).")
    if total_volume > 10:
        reasons.append("High transaction volume observed (total_volume > 10 ETH).")
    if not reasons:
        reasons.append("No threshold-based red flags were triggered.")

    summary_line = (
        f"Wallet {wallet_address} is classified as {risk_class} "
        f"with an AI risk score of {risk_score:.2f}/100."
    )
    reasons_block = "\n".join(f"- {reason}" for reason in reasons)

    report = f"""
==============================
AI Investigation Report
==============================

1. AI Investigation Summary
{summary_line}

2. Risk Assessment
- Wallet Address: {wallet_address}
- Risk Score: {risk_score:.2f}/100
- Classification: {risk_class}
- Suspicious Transactions: {suspicious_tx}
- Unknown Counterparties: {unknown_wallets}
- Total Volume: {total_volume:.6f} ETH

3. Reasons for Suspicion
{reasons_block}

4. Possible Activity Pattern
{_possible_pattern(suspicious_tx, unknown_wallets, total_volume)}

5. Recommendation
{_recommendation(risk_score)}
""".strip()

    return report


def build_investigation_report_payload(
    wallet_address: str,
    risk_score: float,
    suspicious_tx: int,
    unknown_wallets: int,
    total_volume: float,
    total_transactions: int = 0,
    first_transaction: str | None = None,
    last_transaction: str | None = None,
    suspicious_examples: list[dict[str, Any]] | None = None,
    flow_addresses: list[str] | None = None,
    network: str = "Ethereum",
    system_name: str = "Dark Web Crypto Currency Flow Analyzer",
    generated_by: str = "BlockBuster",
    report_id: str | None = None,
) -> dict:
    """Build a structured report payload for UI rendering and PDF export."""
    risk_class = _risk_label(risk_score)
    risk_level = _risk_level(risk_score)

    indicators: list[str] = []
    if total_volume > 10:
        indicators.append("Large value transactions (>10 ETH)")
    if suspicious_tx > 10:
        indicators.append("Rapid transaction bursts")
    if unknown_wallets > 5:
        indicators.append("Interaction with multiple unknown wallets")
    if not indicators:
        indicators.append("No major anomaly threshold exceeded")

    examples = suspicious_examples or []
    normalized_examples: list[dict[str, Any]] = []
    for item in examples[:3]:
        tx_hash = str(item.get("transaction_hash") or item.get("hash") or "")
        amount_eth = float(item.get("amount_eth") or item.get("value_eth") or 0.0)
        tx_date = _format_date(str(item.get("date") or item.get("timestamp") or ""))
        normalized_examples.append(
            {
                "transaction_hash": tx_hash,
                "amount_eth": round(amount_eth, 6),
                "date": tx_date,
            }
        )

    if not normalized_examples:
        normalized_examples = [
            {"transaction_hash": "N/A", "amount_eth": 0.0, "date": "N/A"},
            {"transaction_hash": "N/A", "amount_eth": 0.0, "date": "N/A"},
        ]

    path_nodes = [addr for addr in (flow_addresses or []) if isinstance(addr, str) and addr.strip()]
    if len(path_nodes) < 4:
        letters = ["Wallet A", "Wallet B", "Wallet C", "Wallet D"]
        tx_path = " -> ".join(letters)
    else:
        tx_path = " -> ".join(path_nodes[:4])

    generated_date = datetime.now(timezone.utc).strftime("%d %B %Y")
    chosen_report_id = report_id or _default_report_id()

    ai_insight = (
        "The analyzed wallet demonstrates abnormal transaction behavior, including "
        "high-value transfers and interactions with unknown counterparties. "
        "These patterns may indicate potential laundering or illicit payment activity."
    )

    recommended_actions = [
        "Monitor associated wallet addresses",
        "Conduct further blockchain investigation",
        "Notify financial authorities if necessary",
    ]

    disclaimer = (
        "This report was generated automatically using blockchain transaction analysis "
        "algorithms and public blockchain data. Findings should be verified by "
        "cybersecurity investigators."
    )

    report_text = generate_investigation_report(
        wallet_address=wallet_address,
        risk_score=risk_score,
        suspicious_tx=suspicious_tx,
        unknown_wallets=unknown_wallets,
        total_volume=total_volume,
    )

    formatted_report = f"""
Cryptocurrency Investigation Report

System: {system_name}
Generated by: {generated_by}
Date: {generated_date}
Report ID: {chosen_report_id}

1. Executive Summary

This report analyzes blockchain transaction activity associated with the wallet address below. The analysis identifies suspicious transaction patterns including rapid wallet transfers and high-value transactions that may indicate potential money laundering or dark-web marketplace activity.

2. Wallet Information

Wallet Address
{wallet_address}

Blockchain Network
{network}

Total Transactions
{int(total_transactions)}

First Transaction
{_format_date(first_transaction)}

Last Transaction
{_format_date(last_transaction)}

3. Risk Assessment

Risk Score
{round(float(risk_score), 2)} / 100

Risk Level
{risk_level}

Indicators Detected
{chr(10).join(f"- {item}" for item in indicators)}

4. Suspicious Transaction Summary

Number of Suspicious Transactions
{int(suspicious_tx)}

Example Transactions
{chr(10).join(f"Transaction Hash: {tx['transaction_hash']} | Amount: {tx['amount_eth']} ETH | Date: {tx['date']}" for tx in normalized_examples[:2])}

5. Transaction Flow Analysis

Transaction Path
{tx_path}

Possible Pattern
{_possible_pattern(suspicious_tx, unknown_wallets, total_volume)}

6. AI Investigation Insight

{ai_insight}

7. Recommended Action

{chr(10).join(f"- {action}" for action in recommended_actions)}

8. Disclaimer

{disclaimer}
""".strip()

    return {
        "metadata": {
            "system": system_name,
            "generated_by": generated_by,
            "date": generated_date,
            "report_id": chosen_report_id,
            "network": network,
        },
        "wallet_information": {
            "wallet_address": wallet_address,
            "blockchain_network": network,
            "total_transactions": int(total_transactions),
            "first_transaction": _format_date(first_transaction),
            "last_transaction": _format_date(last_transaction),
        },
        "risk_assessment": {
            "risk_score": round(float(risk_score), 2),
            "risk_level": risk_level,
            "indicators_detected": indicators,
        },
        "suspicious_transaction_summary": {
            "suspicious_count": int(suspicious_tx),
            "example_transactions": normalized_examples,
        },
        "transaction_flow_analysis": {
            "transaction_path": tx_path,
            "possible_pattern": _possible_pattern(suspicious_tx, unknown_wallets, total_volume),
        },
        "executive_summary": (
            "This report analyzes blockchain transaction activity associated with the wallet address below. "
            "The analysis identifies suspicious transaction patterns including rapid wallet transfers and "
            "high-value transactions that may indicate potential money laundering or dark-web marketplace activity."
        ),
        "ai_investigation_insight": ai_insight,
        "recommended_actions": recommended_actions,
        "disclaimer": disclaimer,
        "classification": risk_class,
        "visuals": {
            "signal_breakdown": [
                {"name": "Suspicious Tx", "value": int(suspicious_tx)},
                {"name": "Unknown Wallets", "value": int(unknown_wallets)},
                {"name": "Volume (ETH)", "value": round(float(total_volume), 4)},
            ]
        },
        "report_text": formatted_report,
        "legacy_report_text": report_text,
    }
