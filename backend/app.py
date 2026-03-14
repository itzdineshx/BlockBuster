"""
CryptoFlow Analyzer — Flask API
"""

import os
import re
from datetime import datetime, timezone
from pathlib import Path
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

from analytics_data import build_analytics_dataset
from fraud_model import ModelNotTrainedError, predict_from_features, predict_from_wallet_address, train_wallet_risk_model
from multi_model_trainer import MODEL_FILES, predict_all_models_for_wallet, predict_all_models_for_wallets, train_all_models
from report_generator import build_investigation_report_payload
from threat_intel import lookup_addresses
from wallet_analyzer import analyze_transactions

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)

# Load env from both backend/.env and project-root/.env (if present).
load_dotenv(os.path.join(BACKEND_DIR, ".env"))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

app = Flask(__name__)

# Allow the React dev server (and any other origin in development).
# In production, restrict origins to your actual frontend domain:
#   CORS(app, origins=["https://yourapp.example.com"])
CORS(app, origins="*")

def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if value is None or not str(value).strip():
        raise RuntimeError(f"Missing required environment variable: {name}")
    return str(value).strip()


BLOCKSCOUT_BASE_URL = (os.environ.get("BLOCKSCOUT_BASE_URL") or "https://eth.blockscout.com/api/v2").strip().rstrip("/")
BLOCKSCOUT_PAGE_SIZE = max(10, min(200, int((os.environ.get("BLOCKSCOUT_PAGE_SIZE") or "100").strip())))
BLOCKSCOUT_MAX_TX = max(50, min(20000, int((os.environ.get("BLOCKSCOUT_MAX_TX") or "5000").strip())))

# Optional fallback provider (used only when Blockscout fails).
ETHERSCAN_API_KEY = (os.environ.get("ETHERSCAN_API_KEY") or "").strip()
ETHERSCAN_BASE_URL = (os.environ.get("ETHERSCAN_BASE_URL") or "https://api.etherscan.io/v2/api").strip()
ETHERSCAN_CHAIN_ID = (os.environ.get("ETHERSCAN_CHAIN_ID") or "1").strip()

# Basic Ethereum address pattern (0x followed by 40 hex chars)
_ETH_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "CryptoFlow Analyzer"}), 200


@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "CryptoFlow Analyzer",
        "status": "running",
        "endpoints": [
            "/health",
            "/api/analytics",
            "/api/suspicious",
            "/api/alerts",
            "/analyze_wallet",
            "/api/ml/status",
            "/api/ml/train",
            "/api/ml/predict",
            "/api/ml/train-all",
            "/api/ml/models",
            "/api/ml/predict-all",
        ],
    }), 200


@app.route("/favicon.ico", methods=["GET"])
def favicon():
    return "", 204


@app.route("/api/analytics", methods=["GET"])
def analytics():
    """
    GET /api/analytics

    Returns a complete frontend-ready analytics dataset:
    {
      walletNodes: [...],
      transactions: [...],
      alerts: [...],
      volumeData: [...],
      riskDistData: [...],
      hourlyAlerts: [...]
    }
    """
    include_ai = (request.args.get("include_ai", "false") or "false").strip().lower() in {"1", "true", "yes"}
    ai_limit = max(1, min(200, int(request.args.get("ai_limit", default=20, type=int))))

    try:
        payload = build_analytics_dataset()
        if include_ai:
            model_errors = []
            addresses = [
                str(node.get("address", "")).strip().lower()
                for node in payload.get("walletNodes", [])
                if str(node.get("address", "")).strip()
            ][:ai_limit]

            dataset_path = os.environ.get("TRANSACTION_DATASET_PATH") or "../data/transaction_dataset.csv"
            model_dir = os.environ.get("WALLET_ML_MODEL_DIR") or "./models"
            dataset_path = str((Path(BACKEND_DIR) / dataset_path).resolve()) if not Path(dataset_path).is_absolute() else dataset_path
            model_dir = str((Path(BACKEND_DIR) / model_dir).resolve()) if not Path(model_dir).is_absolute() else model_dir

            try:
                batch_results = predict_all_models_for_wallets(
                    addresses,
                    dataset_path=dataset_path,
                    artifact_dir=model_dir,
                )
                insights = {item["wallet_address"]: item for item in batch_results}

                missing = [addr for addr in addresses if addr not in insights]
                for addr in missing:
                    model_errors.append({"address": addr, "error": "Wallet not found in model dataset"})

                payload["aiInsights"] = insights
                payload["aiIntegration"] = {
                    "enabled": True,
                    "scored_wallets": len(insights),
                    "scored_limit": ai_limit,
                    "errors": model_errors,
                }
            except Exception as exc:
                error_message = str(exc)
                if "_fill_dtype" in error_message and "SimpleImputer" in error_message:
                    error_message = (
                        "AI model artifacts are incompatible with the current scikit-learn runtime. "
                        "Retrain models via /api/ml/train-all and redeploy updated artifacts."
                    )
                payload["aiInsights"] = {}
                payload["aiIntegration"] = {
                    "enabled": False,
                    "scored_wallets": 0,
                    "scored_limit": ai_limit,
                    "errors": [{"address": "*", "error": f"AI enrichment unavailable: {error_message}"}],
                }
        return jsonify(payload), 200
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500
    except ValueError as exc:
        return jsonify({"error": f"Invalid analytics dataset: {exc}"}), 500
    except Exception as exc:
        return jsonify({"error": f"Failed to build analytics dataset: {exc}"}), 500


@app.route("/api/suspicious", methods=["GET"])
def suspicious_transactions():
    """
    GET /api/suspicious?limit=200

    Returns suspicious transactions extracted from the analytics dataset.
    """
    limit = request.args.get("limit", default=200, type=int)
    limit = max(1, min(1000, limit))

    try:
        payload = build_analytics_dataset()
    except Exception as exc:
        return jsonify({"error": f"Failed to build analytics dataset: {exc}"}), 500

    suspicious = [tx for tx in payload.get("transactions", []) if tx.get("suspicious")]
    return jsonify({"count": len(suspicious), "items": suspicious[:limit]}), 200


@app.route("/api/alerts", methods=["GET"])
def alerts_feed():
    """
    GET /api/alerts?severity=critical|high|medium|low

    Returns alerts from the analytics dataset with optional severity filter.
    """
    severity = (request.args.get("severity") or "").strip().lower()
    allowed = {"critical", "high", "medium", "low"}

    if severity and severity not in allowed:
        return jsonify({"error": "severity must be one of: critical, high, medium, low"}), 400

    try:
        payload = build_analytics_dataset()
    except Exception as exc:
        return jsonify({"error": f"Failed to build analytics dataset: {exc}"}), 500

    alerts = payload.get("alerts", [])
    if severity:
        alerts = [a for a in alerts if str(a.get("severity", "")).lower() == severity]

    return jsonify({"count": len(alerts), "items": alerts}), 200


@app.route("/api/ml/train", methods=["POST"])
def train_ml_model():
    """
    POST /api/ml/train
    Optional JSON body:
    {
      "test_size": 0.2,
      "random_state": 42,
      "dataset_path": "...",
      "model_path": "..."
    }
    """
    body = request.get_json(silent=True) or {}

    test_size = body.get("test_size", 0.2)
    random_state = body.get("random_state", 42)
    dataset_path = body.get("dataset_path")
    model_path = body.get("model_path")

    try:
        metrics = train_wallet_risk_model(
            dataset_path=dataset_path,
            model_path=model_path,
            test_size=float(test_size),
            random_state=int(random_state),
        )
        return jsonify({"message": "Model trained successfully", "metrics": metrics}), 200
    except (FileNotFoundError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Model training failed: {exc}"}), 500


@app.route("/api/ml/predict", methods=["POST"])
def ml_predict():
    """
    POST /api/ml/predict
    Body supports either:
    {
      "wallet_address": "0x..."
    }
    or
    {
      "features": {"Sent tnx": 10, "Received Tnx": 12, ...}
    }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Request body must be JSON"}), 400

    wallet_address = (body.get("wallet_address") or "").strip()
    features = body.get("features")
    dataset_path = body.get("dataset_path")
    model_path = body.get("model_path")

    try:
        if wallet_address:
            if not _ETH_ADDRESS_RE.match(wallet_address):
                return jsonify({"error": "Invalid Ethereum wallet address format"}), 400
            result = predict_from_wallet_address(
                wallet_address=wallet_address,
                model_path=model_path,
                dataset_path=dataset_path,
            )
            return jsonify(result), 200

        if isinstance(features, dict):
            result = predict_from_features(features=features, model_path=model_path)
            return jsonify(result), 200

        return jsonify({"error": "Provide either wallet_address or features in request body"}), 400
    except ModelNotTrainedError as exc:
        return jsonify({"error": str(exc)}), 409
    except (FileNotFoundError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Prediction failed: {exc}"}), 500


@app.route("/api/ml/status", methods=["GET"])
def ml_status():
    model_path = _require_env("WALLET_ML_MODEL_PATH")
    return jsonify({
        "model_path": model_path,
        "model_available": os.path.exists(model_path),
    }), 200


@app.route("/api/ml/train-all", methods=["POST"])
def ml_train_all():
    """
    POST /api/ml/train-all
    Optional JSON body:
    {
      "dataset_path": "...",
      "artifact_dir": "...",
      "fetch_external": true,
      "random_state": 42
    }
    """
    body = request.get_json(silent=True) or {}

    try:
        result = train_all_models(
            dataset_path=body.get("dataset_path"),
            artifact_dir=body.get("artifact_dir"),
            fetch_external=bool(body.get("fetch_external", True)),
            random_state=int(body.get("random_state", 42)),
        )
        return jsonify({"message": "All ML models trained successfully", "result": result}), 200
    except (FileNotFoundError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"Multi-model training failed: {exc}"}), 500


@app.route("/api/ml/models", methods=["GET"])
def ml_models_status():
    model_dir = _require_env("WALLET_ML_MODEL_DIR")
    payload = []
    for _, name in MODEL_FILES.items():
        path = os.path.join(model_dir, name)
        payload.append({
            "name": name,
            "path": path,
            "available": os.path.exists(path),
        })
    return jsonify({"model_dir": model_dir, "models": payload}), 200


@app.route("/api/ml/predict-all", methods=["POST"])
def ml_predict_all():
    """
    POST /api/ml/predict-all
    Body:
    {
      "wallet_address": "0x...",
      "dataset_path": "...",   # optional
      "artifact_dir": "..."    # optional
    }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Request body must be JSON"}), 400

    wallet_address = (body.get("wallet_address") or "").strip()
    if not wallet_address:
        return jsonify({"error": "wallet_address is required"}), 400
    if not _ETH_ADDRESS_RE.match(wallet_address):
        return jsonify({"error": "Invalid Ethereum wallet address format"}), 400

    try:
        result = predict_all_models_for_wallet(
            wallet_address=wallet_address,
            dataset_path=body.get("dataset_path"),
            artifact_dir=body.get("artifact_dir"),
        )
        return jsonify(result), 200
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 400
    except ValueError as exc:
        # If a valid wallet is missing from the ML dataset, don't hard-fail the request.
        # The frontend can still render analysis with heuristic signals and partial AI data.
        message = str(exc)
        if "not found in dataset" in message.lower():
            return jsonify({
                "wallet_address": wallet_address.lower(),
                "models": {},
                "explainability": {
                    "decision": "monitor",
                    "summary": "AI features unavailable for this wallet in the current training dataset.",
                    "reasons": [
                        "Wallet address is not present in the ML training dataset.",
                        "Rule-based analysis is still available from the wallet analyzer.",
                    ],
                },
                "warning": message,
            }), 200
        return jsonify({"error": message}), 400
    except Exception as exc:
        return jsonify({"error": f"Predict-all failed: {exc}"}), 500


@app.route("/api/ml/predict-batch", methods=["POST"])
def ml_predict_batch():
    """
    POST /api/ml/predict-batch
    Body:
    {
      "wallet_addresses": ["0x...", "0x..."],
      "dataset_path": "...",   # optional
      "artifact_dir": "..."    # optional
    }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Request body must be JSON"}), 400

    wallet_addresses = body.get("wallet_addresses")
    if not isinstance(wallet_addresses, list) or not wallet_addresses:
        return jsonify({"error": "wallet_addresses must be a non-empty array"}), 400

    dataset_path = body.get("dataset_path")
    artifact_dir = body.get("artifact_dir")

    valid_addresses = []
    errors = []
    for raw in wallet_addresses:
        wallet_address = str(raw or "").strip()
        if not _ETH_ADDRESS_RE.match(wallet_address):
            errors.append({"wallet_address": wallet_address, "error": "Invalid Ethereum wallet address format"})
            continue
        valid_addresses.append(wallet_address)

    try:
        results = predict_all_models_for_wallets(
            wallet_addresses=valid_addresses,
            dataset_path=dataset_path,
            artifact_dir=artifact_dir,
        )
        found = {item.get("wallet_address") for item in results}
        for wallet_address in valid_addresses:
            if wallet_address.lower() not in found:
                errors.append({"wallet_address": wallet_address, "error": "Wallet not found in model dataset"})
    except Exception as exc:
        return jsonify({"error": f"Batch prediction failed: {exc}"}), 500

    return jsonify({
        "count": len(results),
        "results": results,
        "errors": errors,
    }), 200


@app.route("/analyze_wallet", methods=["POST"])
def analyze_wallet():
    """
    POST /analyze_wallet
    Body (JSON): { "wallet_address": "0x..." }

    Returns:
    {
        "wallet_address":          str,
        "total_transactions":      int,
        "suspicious_transactions": list[dict],
        "risk_score":              int,   // 0-100
        "transaction_flow":        list[dict]
    }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Request body must be JSON"}), 400

    wallet_address = (body.get("wallet_address") or "").strip()

    # Input validation — reject anything that doesn't look like an ETH address
    if not wallet_address:
        return jsonify({"error": "wallet_address is required"}), 400

    if not _ETH_ADDRESS_RE.match(wallet_address):
        return jsonify({"error": "Invalid Ethereum wallet address format"}), 400

    # Fetch transactions from Blockscout (with Etherscan fallback if configured).
    raw_transactions, provider, fetch_error = _fetch_transactions(wallet_address)
    if fetch_error:
        return jsonify({"error": fetch_error}), 502

    # Run analysis
    analysis = analyze_transactions(raw_transactions, wallet_address=wallet_address)

    # Threat-intel verification for analyzed wallet + suspicious counterparties.
    related_addresses = {wallet_address.strip().lower()}
    for tx in analysis.get("suspicious_transactions", []):
        frm = str(tx.get("from", "")).strip().lower()
        to = str(tx.get("to", "")).strip().lower()
        if frm:
            related_addresses.add(frm)
        if to:
            related_addresses.add(to)

    intel_map = lookup_addresses(sorted(related_addresses))
    high_conf_hits = [item for item in intel_map.values() if bool(item.get("is_flagged"))]
    score_boost = sum(int(item.get("score_boost", 0) or 0) for item in high_conf_hits)
    adjusted_risk = min(100, int(analysis["risk_score"]) + min(30, score_boost))

    reasons = list(analysis.get("explainability", {}).get("reasons", []))
    if high_conf_hits:
        reasons.insert(0, f"Threat-intel matched {len(high_conf_hits)} wallet(s) in external/watchlist datasets")

    explainability = {
        **analysis.get("explainability", {}),
        "reasons": reasons,
        "summary": f"Wallet {'flagged' if adjusted_risk >= 70 else 'under monitoring' if adjusted_risk >= 40 else 'low risk'} with adjusted risk score {adjusted_risk}/100",
    }

    # Generate full report for medium/high-risk wallets.
    unknown_wallets = len(
        {
            str(tx.get("from", "")).strip().lower()
            for tx in analysis.get("transaction_flow", [])
            if str(tx.get("from", "")).strip().lower() and str(tx.get("from", "")).strip().lower() != wallet_address.lower()
        }
        | {
            str(tx.get("to", "")).strip().lower()
            for tx in analysis.get("transaction_flow", [])
            if str(tx.get("to", "")).strip().lower() and str(tx.get("to", "")).strip().lower() != wallet_address.lower()
        }
    )
    suspicious_tx = len(analysis.get("suspicious_transactions", []))
    total_volume = float(sum(float(tx.get("value_eth", 0.0) or 0.0) for tx in analysis.get("transaction_flow", [])))

    flow = analysis.get("transaction_flow", [])
    first_tx_ts = flow[-1].get("timestamp") if flow else None
    last_tx_ts = flow[0].get("timestamp") if flow else None

    suspicious_examples = []
    for item in analysis.get("suspicious_transactions", [])[:3]:
        suspicious_examples.append(
            {
                "transaction_hash": str(item.get("hash") or ""),
                "amount_eth": float(item.get("value_eth") or 0.0),
                "date": str(item.get("timestamp") or ""),
            }
        )

    flow_addresses = [wallet_address.lower()]
    for tx in flow[:20]:
        src = str(tx.get("from", "")).strip().lower()
        dst = str(tx.get("to", "")).strip().lower()
        for addr in [src, dst]:
            if addr and addr not in flow_addresses:
                flow_addresses.append(addr)
            if len(flow_addresses) >= 4:
                break
        if len(flow_addresses) >= 4:
            break

    report_payload = None
    if adjusted_risk >= 40:
        report_payload = build_investigation_report_payload(
            wallet_address=wallet_address,
            risk_score=float(adjusted_risk),
            suspicious_tx=suspicious_tx,
            unknown_wallets=unknown_wallets,
            total_volume=total_volume,
            total_transactions=int(analysis.get("total_transactions", 0)),
            first_transaction=str(first_tx_ts) if first_tx_ts else None,
            last_transaction=str(last_tx_ts) if last_tx_ts else None,
            suspicious_examples=suspicious_examples,
            flow_addresses=flow_addresses,
            network="Ethereum",
            generated_by="BlockBuster",
        )

    return jsonify({
        "wallet_address": wallet_address,
        "total_transactions": analysis["total_transactions"],
        "scraped_transaction_count": len(raw_transactions),
        "data_provider": provider,
        "suspicious_transactions": analysis["suspicious_transactions"],
        "risk_score": adjusted_risk,
        "transaction_flow": analysis["transaction_flow"],
        "explainability": explainability,
        "investigation_report": report_payload,
        "threat_intelligence": {
            "checked_addresses": len(related_addresses),
            "flagged_addresses": len(high_conf_hits),
            "sources": ["local_scam_datasets", "bitcoin_abuse", "chainabuse"],
            "matches": high_conf_hits,
            "results": intel_map,
        },
    }), 200


# ---------------------------------------------------------------------------
# Transaction scraping helpers
# ---------------------------------------------------------------------------

def _to_unix_seconds(timestamp: str) -> int:
    if not timestamp:
        return 0
    text = str(timestamp).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except ValueError:
        return 0


def _extract_address(node: object) -> str:
    if isinstance(node, dict):
        return str(node.get("hash") or node.get("address") or "").strip().lower()
    return str(node or "").strip().lower()


def _extract_wei_value(raw: object) -> str:
    if isinstance(raw, dict):
        value = raw.get("value")
        if value is None:
            return "0"
        return str(value)
    return str(raw or "0")


def _normalize_blockscout_tx(item: dict) -> dict:
    status_raw = str(item.get("status") or "").strip().lower()
    is_error = "0" if status_raw in {"ok", "success", "confirmed", "completed"} else "1"

    return {
        "hash": str(item.get("hash") or ""),
        "from": _extract_address(item.get("from")),
        "to": _extract_address(item.get("to")),
        "value": _extract_wei_value(item.get("value")),
        "timeStamp": str(_to_unix_seconds(str(item.get("timestamp") or ""))),
        "gas": str(item.get("gas_used") or item.get("gas_limit") or 0),
        "gasPrice": str(item.get("gas_price") or 0),
        "isError": is_error,
    }


def _fetch_transactions_blockscout(address: str) -> tuple[list[dict], str | None]:
    endpoint = f"{BLOCKSCOUT_BASE_URL}/addresses/{address}/transactions"
    out: list[dict] = []
    next_params: dict | None = None

    try:
        while len(out) < BLOCKSCOUT_MAX_TX:
            params: dict[str, object] = {"items_count": BLOCKSCOUT_PAGE_SIZE}
            if next_params:
                for key, value in next_params.items():
                    if isinstance(value, (str, int, float, bool)):
                        params[key] = value

            resp = requests.get(endpoint, params=params, timeout=15)
            resp.raise_for_status()
            payload = resp.json()

            items = payload.get("items", []) if isinstance(payload, dict) else []
            if not isinstance(items, list) or not items:
                break

            for item in items:
                if not isinstance(item, dict):
                    continue
                out.append(_normalize_blockscout_tx(item))
                if len(out) >= BLOCKSCOUT_MAX_TX:
                    break

            np = payload.get("next_page_params") if isinstance(payload, dict) else None
            if not isinstance(np, dict) or not np:
                break
            next_params = np

    except requests.exceptions.Timeout:
        return [], "Blockscout API request timed out"
    except requests.exceptions.RequestException as exc:
        return [], f"Blockscout API request failed: {exc}"
    except ValueError:
        return [], "Blockscout returned a non-JSON response"
    except Exception as exc:
        return [], f"Blockscout parsing failed: {exc}"

    # Deduplicate by hash while preserving order.
    deduped = []
    seen_hashes = set()
    for tx in out:
        tx_hash = str(tx.get("hash") or "")
        if tx_hash in seen_hashes:
            continue
        seen_hashes.add(tx_hash)
        deduped.append(tx)

    return deduped, None


def _fetch_transactions_etherscan(address: str) -> tuple[list[dict], str | None]:
    if not ETHERSCAN_API_KEY:
        return [], "Etherscan fallback not configured"

    params = {
        "chainid": ETHERSCAN_CHAIN_ID,
        "module": "account",
        "action": "txlist",
        "address": address,
        "startblock": 0,
        "endblock": 99999999,
        "page": 1,
        "offset": 10000,
        "sort": "asc",
        "apikey": ETHERSCAN_API_KEY,
    }

    try:
        resp = requests.get(ETHERSCAN_BASE_URL, params=params, timeout=15)
        resp.raise_for_status()
    except requests.exceptions.Timeout:
        return [], "Etherscan API request timed out"
    except requests.exceptions.RequestException as exc:
        return [], f"Etherscan API request failed: {exc}"

    try:
        data = resp.json()
    except ValueError:
        return [], "Etherscan returned a non-JSON response"

    # Etherscan returns status "0" with message "No transactions found" for
    # valid addresses that simply have no history — treat that as empty, not error.
    if data.get("status") == "0":
        message = data.get("message", "")
        result = str(data.get("result", ""))
        if "no transactions" in message.lower() or "no transactions" in result.lower():
            return [], None
        return [], f"Etherscan error: {result or message}"

    transactions = data.get("result", [])
    if not isinstance(transactions, list):
        return [], "Unexpected response format from Etherscan"

    return transactions, None


def _fetch_transactions(address: str) -> tuple[list[dict], str, str | None]:
    """Fetch transactions with Blockscout first and fallback to Etherscan if available."""
    txs, err = _fetch_transactions_blockscout(address)
    if not err:
        return txs, "blockscout", None

    fallback_txs, fallback_err = _fetch_transactions_etherscan(address)
    if not fallback_err:
        return fallback_txs, "etherscan", None

    return [], "none", f"Primary source failed ({err}); fallback failed ({fallback_err})"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(_require_env("PORT"))
    debug = _require_env("FLASK_DEBUG").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
