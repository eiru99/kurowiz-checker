#!/usr/bin/env python3
"""GameWith HTML から abbr / title を再取得し catalog_events を修正する。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from parse_gamewith_events import DEFAULT_SOURCE, normalize_event_names, parse_events

ROOT = Path(__file__).resolve().parents[1]

SUPABASE_URL = "https://lwddylqiyhnubeakrner.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3ZGR5bHFpeWhudWJlYWtybmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTQxNjksImV4cCI6MjA5NTczMDE2OX0."
    "PZs50EuI78GoXMBe-1cX16FNA8ddZ708l0_sob3AWko"
)

KNOWN_EVENT_IDS = {"latest-e313": "kamisanpo3", "かみさんぽっ3": "kamisanpo3"}


def supabase_headers(*, prefer: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def resolve_event_id(event: dict) -> str:
    return KNOWN_EVENT_IDS.get(event["id"], KNOWN_EVENT_IDS.get(event["abbr"], event["id"]))


def main() -> None:
    html = DEFAULT_SOURCE.read_text(encoding="utf-8")
    events, _issues = parse_events(html)

    names_by_id: dict[str, dict[str, str]] = {}
    for event in events:
        event_id = resolve_event_id(event)
        abbr, title = normalize_event_names(event["abbr"], event["title"])
        names_by_id[event_id] = {"abbr": abbr, "title": title}

    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/catalog_events",
        headers=supabase_headers(),
        params={"select": "id,abbr,title"},
        timeout=60,
    )
    response.raise_for_status()
    rows = response.json()

    fixed: list[dict] = []
    missing_source: list[str] = []
    for row in rows:
        source = names_by_id.get(row["id"])
        if not source:
            missing_source.append(row["id"])
            continue
        if source["abbr"] == row.get("abbr") and source["title"] == row.get("title"):
            continue
        patch = requests.patch(
            f"{SUPABASE_URL}/rest/v1/catalog_events",
            headers=supabase_headers(prefer="return=minimal"),
            params={"id": f"eq.{row['id']}"},
            json={"abbr": source["abbr"], "title": source["title"]},
            timeout=60,
        )
        patch.raise_for_status()
        fixed.append(
            {
                "id": row["id"],
                "before": {"abbr": row.get("abbr"), "title": row.get("title")},
                "after": source,
            }
        )

    report = {
        "source_events": len(names_by_id),
        "db_events": len(rows),
        "fixed_count": len(fixed),
        "missing_source_count": len(missing_source),
        "missing_source_ids": missing_source,
        "fixed": fixed,
    }
    out_path = ROOT / "scripts" / "fix-event-names-report.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"source={len(names_by_id)} db={len(rows)} fixed={len(fixed)} "
        f"missing_source={len(missing_source)} -> {out_path}"
    )


if __name__ == "__main__":
    main()
