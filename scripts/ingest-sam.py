#!/usr/bin/env python3
"""Download SAM.gov bulk Contract Opportunities CSV and build local map data.

Outputs:
  data/sam/ContractOpportunitiesFullCSV.csv         raw cached bulk CSV
  data/sam/bulk-opportunities.json                  normalized active opportunities for server API
  public/data/bulk-summary.json                     lightweight ingest metadata for the browser

No third-party dependencies. Designed for air-gap-friendly cached reruns.
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

    PUBLIC_SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_SUMMARY.write_text(json.dumps({k: v for k, v in payload.items() if k != "opportunities"}, indent=2), encoding="utf-8")
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
        "output": str(OUT_JSON),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
