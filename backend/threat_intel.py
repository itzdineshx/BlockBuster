"""Threat intelligence enrichment for wallet risk analysis."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import requests


_ETH_RE = re.compile(r"0x[a-fA-F0-9]{40}")
_BTC_RE = re.compile(r"\b(?:bc1[a-zA-HJ-NP-Z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b")
_MAX_LOCAL_TEXT_BYTES = 2_000_000
_LOCAL_CACHE: dict[str, tuple[float, set[str]]] = {}


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    return [part.strip() for part in raw.split(",") if part.strip()]


def _dig(obj: Any, path: str) -> Any:
    if not path:
        return None
    cur = obj
    for token in path.split("."):
        token = token.strip()
        if token == "":
            continue
        if isinstance(cur, dict):
            cur = cur.get(token)
            continue
        if isinstance(cur, list):
            if token.isdigit():
                idx = int(token)
                if idx < 0 or idx >= len(cur):
                    return None
                cur = cur[idx]
                continue
            return None
        return None
    return cur


def _iter_dict_nodes(obj: Any):
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from _iter_dict_nodes(value)
    elif isinstance(obj, list):
        for item in obj:
            yield from _iter_dict_nodes(item)


def _collect_addresses_from_text(text: str) -> set[str]:
    eth = {m.group(0).lower() for m in _ETH_RE.finditer(text)}
    btc = {m.group(0) for m in _BTC_RE.finditer(text)}
    return eth | btc


def _safe_read_text(path: Path) -> str:
    raw = path.read_bytes()
    if len(raw) > _MAX_LOCAL_TEXT_BYTES:
        raw = raw[:_MAX_LOCAL_TEXT_BYTES]
    return raw.decode("utf-8", errors="ignore")


def _extract_addresses_from_file(path: Path) -> set[str]:
    cache_key = str(path.resolve())
    mtime = path.stat().st_mtime
    cached = _LOCAL_CACHE.get(cache_key)
    if cached and cached[0] == mtime:
        return cached[1]

    text = _safe_read_text(path)
    extracted: set[str]

    if path.suffix.lower() == ".json":
        try:
            payload = json.loads(text)
            flattened = json.dumps(payload)
            extracted = _collect_addresses_from_text(flattened)
        except json.JSONDecodeError:
            extracted = _collect_addresses_from_text(text)
    else:
        extracted = _collect_addresses_from_text(text)

    _LOCAL_CACHE[cache_key] = (mtime, extracted)
    return extracted


def _local_watchlist_hits(address: str, external_dir: Path) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    if not external_dir.exists() or not external_dir.is_dir():
        return hits

    scan_suffixes = {".json", ".csv", ".txt", ".tsv"}
    for item in external_dir.iterdir():
        if not item.is_file() or item.suffix.lower() not in scan_suffixes:
            continue
        try:
            addrs = _extract_addresses_from_file(item)
        except Exception:
            continue
        if address in addrs:
            hits.append(
                {
                    "source": "local_dataset",
                    "dataset": item.name,
                    "match_type": "exact_address",
                    "confidence": "high",
                }
            )
    return hits


def _bitcoin_abuse_hits(address: str) -> list[dict[str, Any]]:
    if not _BTC_RE.fullmatch(address):
        return []

    endpoint = (os.environ.get("BITCOIN_ABUSE_API_URL") or "https://www.bitcoinabuse.com/api/reports/check").strip()
    api_key = (os.environ.get("BITCOIN_ABUSE_API_KEY") or "").strip()

    params = {"address": address}
    if api_key:
        params["api_token"] = api_key

    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        resp = requests.get(endpoint, params=params, headers=headers, timeout=8)
        if resp.status_code >= 400:
            return []
        data = resp.json()
    except Exception:
        return []

    count = 0
    if isinstance(data, dict):
        if "count" in data:
            count = int(data.get("count") or 0)
        elif "total" in data:
            count = int(data.get("total") or 0)
        elif "recent" in data and isinstance(data.get("recent"), list):
            count = len(data["recent"])

    if count <= 0:
        return []

    return [
        {
            "source": "bitcoin_abuse",
            "dataset": "bitcoinabuse_api",
            "match_type": "reported_address",
            "report_count": count,
            "confidence": "medium" if count < 3 else "high",
        }
    ]


def _chainabuse_hits(address: str) -> list[dict[str, Any]]:
    endpoint = (os.environ.get("CHAINABUSE_API_URL") or "").strip()
    if not endpoint:
        return []

    api_key = (os.environ.get("CHAINABUSE_API_KEY") or "").strip()
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        if "{address}" in endpoint:
            url = endpoint.format(address=address)
            resp = requests.get(url, headers=headers, timeout=8)
        else:
            resp = requests.get(endpoint, params={"address": address}, headers=headers, timeout=8)
        if resp.status_code >= 400:
            return []
        data = resp.json()
    except Exception:
        return []

    reports_path = (os.environ.get("CHAINABUSE_REPORTS_PATH") or "").strip()
    count_path = (os.environ.get("CHAINABUSE_COUNT_PATH") or "").strip()
    address_fields = _env_list("CHAINABUSE_ADDRESS_FIELDS", ["address", "walletAddress", "wallet_address", "identifier", "value"])

    report_count = 0
    report_rows: list[dict[str, Any]] = []

    if reports_path:
        reports_obj = _dig(data, reports_path)
        if isinstance(reports_obj, list):
            report_rows = [item for item in reports_obj if isinstance(item, dict)]

    if not report_rows:
        if isinstance(data, dict):
            for key in ["reports", "data", "results", "items"]:
                if isinstance(data.get(key), list):
                    report_rows = [item for item in data[key] if isinstance(item, dict)]
                    if report_rows:
                        break
        elif isinstance(data, list):
            report_rows = [item for item in data if isinstance(item, dict)]

    if report_rows:
        addr_lower = address.lower()
        matched = []
        for row in report_rows:
            row_address = ""
            for field in address_fields:
                value = row.get(field)
                if isinstance(value, str) and value.strip():
                    row_address = value.strip().lower()
                    break
            if not row_address or row_address == addr_lower:
                matched.append(row)

        effective_rows = matched if matched else report_rows
        report_count = len(effective_rows)
        report_rows = effective_rows
    elif count_path:
        raw_count = _dig(data, count_path)
        try:
            report_count = int(raw_count or 0)
        except Exception:
            report_count = 0
    elif isinstance(data, dict):
        if "count" in data:
            report_count = int(data.get("count") or 0)
        elif "total" in data:
            report_count = int(data.get("total") or 0)

    if report_count <= 0:
        return []

    categories = []
    for row in report_rows[:3]:
        for key in ["category", "abuse_type", "fraud_type", "type", "title"]:
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                categories.append(value.strip())
                break

    notes = []
    for row in report_rows[:2]:
        for key in ["description", "summary", "details"]:
            value = row.get(key)
            if isinstance(value, str) and value.strip():
                notes.append(value.strip()[:180])
                break

    return [
        {
            "source": "chainabuse",
            "dataset": "chainabuse_api",
            "match_type": "reported_address",
            "report_count": report_count,
            "confidence": "medium" if report_count < 3 else "high",
            "evidence": {
                "categories": categories,
                "notes": notes,
            },
        }
    ]


def _risk_level(hit_count: int) -> str:
    if hit_count >= 3:
        return "critical"
    if hit_count == 2:
        return "high"
    if hit_count == 1:
        return "medium"
    return "none"


def lookup_addresses(addresses: list[str]) -> dict[str, dict[str, Any]]:
    """Lookup wallet addresses in threat intelligence sources."""
    external_dir = Path(__file__).resolve().parent.parent / "data" / "external"
    unique = [str(a).strip() for a in addresses if str(a).strip()]

    results: dict[str, dict[str, Any]] = {}
    for raw in unique:
        address = raw.lower() if raw.startswith("0x") else raw

        hits: list[dict[str, Any]] = []
        hits.extend(_local_watchlist_hits(address, external_dir))
        hits.extend(_bitcoin_abuse_hits(address))
        hits.extend(_chainabuse_hits(address))

        level = _risk_level(len(hits))
        results[address] = {
            "address": address,
            "is_flagged": len(hits) > 0,
            "risk_level": level,
            "score_boost": min(25, len(hits) * 8),
            "hits": hits,
        }

    return results
