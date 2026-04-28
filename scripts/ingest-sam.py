#!/usr/bin/env python3
"""Download SAM.gov bulk Contract Opportunities CSV and build local map data.

Outputs:
  data/sam/ContractOpportunitiesFullCSV.csv         raw cached bulk CSV
  data/sam/bulk-opportunities.json                  normalized active opportunities for local inspection
  public/data/bulk-summary.json                     lightweight ingest metadata for the browser
  public/data/map-tiles.json                        compact static payload used by the app

No third-party dependencies. Designed for air-gap-friendly cached reruns and
GitHub Actions scheduled refreshes.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BULK_URL = "https://s3.amazonaws.com/falextracts/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv"
RAW_DIR = Path("data/sam")
RAW_CSV = RAW_DIR / "ContractOpportunitiesFullCSV.csv"
OUT_JSON = RAW_DIR / "bulk-opportunities.json"
PUBLIC_SUMMARY = Path("public/data/bulk-summary.json")
PUBLIC_MAP_TILES = Path("public/data/map-tiles.json")
TOP_AGENCIES = 12
TOP_THEMES_PER_AGENCY = 18
TOP_OPPORTUNITIES_PER_THEME = 36

THEMES = {
    "11": "Agriculture",
    "21": "Energy",
    "22": "Utilities",
    "23": "Construction",
    "31": "Manufacturing",
    "32": "Manufacturing",
    "33": "Manufacturing",
    "42": "Wholesale",
    "48": "Transport",
    "49": "Transport",
    "51": "Digital",
    "52": "Finance",
    "53": "Real Estate",
    "54": "Professional",
    "56": "Admin",
    "61": "Training",
    "62": "Health",
    "71": "Arts",
    "72": "Food",
    "81": "Other Services",
    "92": "Public Sector",
}


def clean(value: Any, default: str = "Unknown") -> str:
    text = str(value or "").strip()
    return text if text else default


def first(row: dict[str, str], *keys: str, default: str = "Unknown") -> str:
    for key in keys:
        value = clean(row.get(key), "")
        if value:
            return value
    return default


def short_agency(agency: str) -> str:
    text = agency.replace("DEPARTMENT OF THE", "").replace("DEPARTMENT OF", "").replace("DEPT OF", "").strip()
    return text.split(",")[0].split(".")[0].strip() or "Federal"


def stable_coord(seed: str, salt: int) -> int:
    digest = hashlib.sha256(f"{salt}:{seed}".encode("utf-8", "ignore")).digest()
    value = int.from_bytes(digest[:4], "big")
    return 8 + (value % 84)


def urgency(deadline: str) -> str:
    if not deadline or deadline == "Unknown":
        return "watch"
    # Examples: 2026-05-05T11:00:00+09:00, 2026-05-20
    try:
        normalized = deadline.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        days = math.ceil((dt - datetime.now(timezone.utc)).total_seconds() / 86400)
        if days <= 14:
            return "hot"
        if days <= 35:
            return "soon"
    except Exception:
        pass
    return "watch"


def theme_for(row: dict[str, str], title: str, description: str, agency: str, naics: str) -> str:
    prefix = (naics or "")[:2]
    if prefix in THEMES:
        return THEMES[prefix]
    text = f"{title} {description} {agency} {naics}".lower()
    if any(w in text for w in ["cyber", "software", "cloud", "data", "ai", "artificial", "network", "devsecops"]):
        return "Digital"
    if any(w in text for w in ["army", "navy", "air force", "defense", "missile", "tactical", "space"]):
        return "Defense"
    if any(w in text for w in ["medical", "health", "veterans", "hospital", "clinical"]):
        return "Health"
    if any(w in text for w in ["construction", "facility", "building", "repair", "hvac", "renovation"]):
        return "Facilities"
    if any(w in text for w in ["logistics", "transport", "shipping", "warehouse", "vehicle", "parts"]):
        return "Logistics"
    return "Other"


def market_value_for(item: dict[str, Any]) -> int:
    """Create a stable market-gravity estimate for map ranking.

    SAM.gov opportunity notices usually do not publish a reliable value in the
    public bulk CSV. The app intentionally presents approximate gravity, not an
    official award value, so keep this deterministic and easy to reason about.
    """
    theme_base = {
        "Construction": 5_200_000,
        "Facilities": 3_400_000,
        "Digital": 2_800_000,
        "Professional": 2_400_000,
        "Manufacturing": 1_800_000,
        "Health": 1_600_000,
        "Transport": 1_250_000,
        "Energy": 1_100_000,
        "Training": 950_000,
        "Admin": 650_000,
    }
    notice_multiplier = {
        "Solicitation": 1.2,
        "Combined Synopsis/Solicitation": 1.0,
        "Sources Sought": 0.75,
        "Presolicitation": 0.85,
        "Special Notice": 0.45,
    }
    seed = f"{item.get('id')}:{item.get('title')}:{item.get('agency')}:{item.get('naics')}"
    digest = hashlib.sha256(seed.encode("utf-8", "ignore")).digest()
    variance = 0.55 + (int.from_bytes(digest[:2], "big") / 65535) * 1.1
    base = theme_base.get(str(item.get("theme", "")), 900_000)
    multiplier = notice_multiplier.get(str(item.get("noticeType", "")), 0.9)
    if item.get("urgency") == "hot":
        multiplier *= 1.12
    elif item.get("urgency") == "soon":
        multiplier *= 1.04
    return int(round((base * multiplier * variance) / 50_000) * 50_000)


def tile_key(level: int, agency: str = "", theme: str = "") -> str:
    return f"{level}|{agency}|{theme}"


def node_sort_key(node: dict[str, Any]) -> tuple[int, int, str]:
    return (-int(node["marketValue"]), -int(node["count"]), str(node["label"]))


def summarize_group(items: list[dict[str, Any]], *, node_id: str, label: str, agency: str | None = None, theme: str | None = None, rank: int = 0) -> dict[str, Any]:
    hot_count = sum(1 for item in items if item.get("urgency") == "hot")
    soon_count = sum(1 for item in items if item.get("urgency") == "soon")
    market_value = sum(int(item["marketValue"]) for item in items)
    node: dict[str, Any] = {
        "id": node_id,
        "label": label,
        "sublabel": f"{hot_count} hot · {soon_count} soon",
        "count": len(items),
        "marketValue": market_value,
        "hotCount": hot_count,
        "soonCount": soon_count,
        "x": float(18 + ((rank * 37) % 64)),
        "y": float(18 + ((rank * 23) % 64)),
        "urgency": "hot" if hot_count else "soon" if soon_count else "watch",
    }
    if agency:
        node["agency"] = agency
    if theme:
        node["theme"] = theme
    return node


def build_map_tiles(payload: dict[str, Any]) -> dict[str, Any]:
    opportunities = payload["opportunities"]
    for item in opportunities:
        item["marketValue"] = market_value_for(item)

    tiles: dict[str, Any] = {}
    by_agency: dict[str, list[dict[str, Any]]] = {}
    for item in opportunities:
        by_agency.setdefault(item["shortAgency"], []).append(item)

    agency_nodes = [
        summarize_group(items, node_id=agency, label=agency, agency=agency, rank=index)
        for index, (agency, items) in enumerate(by_agency.items())
    ]
    agency_nodes.sort(key=node_sort_key)
    agency_nodes = agency_nodes[:TOP_AGENCIES]
    tiles[tile_key(1)] = {
        "level": 1,
        "agency": None,
        "theme": None,
        "scopedCount": payload["activeRows"],
        "nodes": agency_nodes,
    }

    for agency_node in agency_nodes:
        agency = agency_node["agency"]
        agency_items = by_agency[agency]
        by_theme: dict[str, list[dict[str, Any]]] = {}
        for item in agency_items:
            by_theme.setdefault(item["theme"], []).append(item)

        theme_nodes = [
            summarize_group(items, node_id=theme, label=theme, agency=agency, theme=theme, rank=index)
            for index, (theme, items) in enumerate(by_theme.items())
        ]
        theme_nodes.sort(key=node_sort_key)
        theme_nodes = theme_nodes[:TOP_THEMES_PER_AGENCY]
        tiles[tile_key(2, agency)] = {
            "level": 2,
            "agency": agency,
            "theme": None,
            "scopedCount": len(agency_items),
            "nodes": theme_nodes,
        }

        for theme_node in theme_nodes:
            theme = theme_node["theme"]
            theme_items = sorted(by_theme[theme], key=lambda item: (-int(item["marketValue"]), str(item["title"])))[:TOP_OPPORTUNITIES_PER_THEME]
            opp_nodes = []
            for item in theme_items:
                public_item = {k: v for k, v in item.items() if k != "marketValue"}
                opp_nodes.append({
                    "id": item["id"],
                    "label": item["title"],
                    "sublabel": f"{agency} · {theme}",
                    "count": 1,
                    "marketValue": item["marketValue"],
                    "hotCount": 1 if item.get("urgency") == "hot" else 0,
                    "soonCount": 1 if item.get("urgency") == "soon" else 0,
                    "x": item["x"],
                    "y": item["y"],
                    "urgency": item["urgency"],
                    "agency": agency,
                    "theme": theme,
                    "opportunity": public_item,
                })
            tiles[tile_key(3, agency, theme)] = {
                "level": 3,
                "agency": agency,
                "theme": theme,
                "scopedCount": len(by_theme[theme]),
                "nodes": opp_nodes,
            }

    return {
        "source": payload["source"],
        "generatedAt": payload["generatedAt"],
        "totalRows": payload["totalRows"],
        "activeRows": payload["activeRows"],
        "tiles": tiles,
    }


def normalize(row: dict[str, str]) -> dict[str, Any] | None:
    title = first(row, "Title")
    if title == "Unknown":
        return None
    notice_id = first(row, "NoticeId", "Sol#", "Link", "Title")
    agency = first(row, "Department/Ind.Agency", "Sub-Tier", "Office")
    office = first(row, "Office", "Sub-Tier")
    naics = first(row, "NaicsCode", "ClassificationCode", default="")
    description = first(row, "Description", default="Open SAM.gov opportunity.")
    if len(description) > 360:
        description = description[:357].rstrip() + "..."
    deadline = first(row, "ResponseDeadLine", "ArchiveDate", default="No deadline posted")
    seed = f"{agency}:{office}:{naics}:{title}:{notice_id}"
    return {
        "id": notice_id,
        "title": title,
        "agency": agency,
        "office": office,
        "noticeType": first(row, "Type", "BaseType"),
        "setAside": first(row, "SetASide", "SetASideCode"),
        "naics": naics,
        "postedDate": first(row, "PostedDate"),
        "responseDeadline": deadline,
        "placeOfPerformance": ", ".join(part for part in [clean(row.get("PopCity"), ""), clean(row.get("PopState"), ""), clean(row.get("PopCountry"), "")] if part) or "Unknown",
        "description": description,
        "url": first(row, "Link", "AdditionalInfoLink", default="https://sam.gov"),
        "x": stable_coord(seed, 17),
        "y": stable_coord(seed, 83),
        "urgency": urgency(deadline),
        "theme": theme_for(row, title, description, agency, naics),
        "shortAgency": short_agency(agency),
    }


def download(url: str, dest: Path, force: bool = False) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1024 and not force:
        print(f"Using cached CSV: {dest} ({dest.stat().st_size / 1_000_000:.1f} MB)")
        return

    print(f"Downloading {url}")
    tmp_fd, tmp_name = tempfile.mkstemp(prefix=dest.name, suffix=".tmp", dir=str(dest.parent))
    os.close(tmp_fd)
    tmp = Path(tmp_name)
    try:
        with urllib.request.urlopen(url, timeout=60) as response, tmp.open("wb") as fh:
            total = int(response.headers.get("Content-Length", "0") or 0)
            seen = 0
            last = time.time()
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
                seen += len(chunk)
                now = time.time()
                if now - last > 2:
                    if total:
                        print(f"  {seen / 1_000_000:.1f}/{total / 1_000_000:.1f} MB", flush=True)
                    else:
                        print(f"  {seen / 1_000_000:.1f} MB", flush=True)
                    last = now
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)


def ingest(csv_path: Path, out_path: Path, max_records: int | None) -> dict[str, Any]:
    total = 0
    active = 0
    kept = 0
    records: list[dict[str, Any]] = []
    theme_counts: dict[str, int] = {}
    agency_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}

    with csv_path.open("r", encoding="utf-8-sig", errors="replace", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            total += 1
            if clean(row.get("Active"), "").lower() not in {"yes", "true", "1"}:
                continue
            active += 1
            normalized = normalize(row)
            if not normalized:
                continue
            theme_counts[normalized["theme"]] = theme_counts.get(normalized["theme"], 0) + 1
            agency_counts[normalized["shortAgency"]] = agency_counts.get(normalized["shortAgency"], 0) + 1
            type_counts[normalized["noticeType"]] = type_counts.get(normalized["noticeType"], 0) + 1
            if max_records is None or kept < max_records:
                records.append(normalized)
                kept += 1

    generated_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "source": "sam.gov-bulk-csv",
        "generatedAt": generated_at,
        "csv": {
            "url": BULK_URL,
            "path": str(csv_path),
            "bytes": csv_path.stat().st_size,
        },
        "totalRows": total,
        "activeRows": active,
        "opportunitiesReturned": len(records),
        "isSampled": max_records is not None and active > len(records),
        "themeCounts": dict(sorted(theme_counts.items(), key=lambda kv: kv[1], reverse=True)),
        "agencyCounts": dict(sorted(agency_counts.items(), key=lambda kv: kv[1], reverse=True)[:50]),
        "noticeTypeCounts": dict(sorted(type_counts.items(), key=lambda kv: kv[1], reverse=True)),
        "opportunities": records,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    map_tiles = build_map_tiles(payload)
    PUBLIC_MAP_TILES.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_MAP_TILES.write_text(json.dumps(map_tiles, separators=(",", ":")), encoding="utf-8")

    PUBLIC_SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    summary = {k: v for k, v in payload.items() if k != "opportunities"}
    summary["mapTiles"] = {
        "path": str(PUBLIC_MAP_TILES),
        "bytes": PUBLIC_MAP_TILES.stat().st_size,
        "tileCount": len(map_tiles["tiles"]),
        "topAgencyCount": len(map_tiles["tiles"][tile_key(1)]["nodes"]),
    }
    PUBLIC_SUMMARY.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="redownload the CSV even if cached")
    parser.add_argument("--max-records", type=int, default=0, help="cap browser payload records; counts still use all active rows. Default 0 keeps all active rows.")
    args = parser.parse_args()
    max_records = None if args.max_records == 0 else args.max_records

    download(BULK_URL, RAW_CSV, force=args.force)
    payload = ingest(RAW_CSV, OUT_JSON, max_records=max_records)
    print(json.dumps({
        "source": payload["source"],
        "totalRows": payload["totalRows"],
        "activeRows": payload["activeRows"],
        "opportunitiesReturned": payload["opportunitiesReturned"],
        "isSampled": payload["isSampled"],
        "topThemes": list(payload["themeCounts"].items())[:8],
        "opportunitiesOutput": str(OUT_JSON),
        "mapTilesOutput": str(PUBLIC_MAP_TILES),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
