#!/usr/bin/env python3
"""catalog_events の abbr / title を normalize_event_names で揃える。"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from parse_gamewith_events import normalize_event_names

ROOT = Path(__file__).resolve().parents[1]

SUPABASE_URL = "https://lwddylqiyhnubeakrner.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3ZGR5bHFpeWhudWJlYWtybmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTQxNjksImV4cCI6MjA5NTczMDE2OX0."
    "PZs50EuI78GoXMBe-1cX16FNA8ddZ708l0_sob3AWko"
)


def main() -> None:
    headers = {
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/catalog_events",
        headers={key: value for key, value in headers.items() if key != "Prefer"},
        params={"select": "id,abbr,title"},
        timeout=60,
    )
    response.raise_for_status()
    rows = response.json()

    fixed: list[dict] = []
    for row in rows:
        abbr, title = normalize_event_names(row.get("abbr") or "", row.get("title") or "")
        if abbr == (row.get("abbr") or "") and title == (row.get("title") or ""):
            continue
        patch = requests.patch(
            f"{SUPABASE_URL}/rest/v1/catalog_events",
            headers=headers,
            params={"id": f"eq.{row['id']}"},
            json={"abbr": abbr, "title": title},
            timeout=60,
        )
        patch.raise_for_status()
        fixed.append(
            {
                "id": row["id"],
                "before": {"abbr": row.get("abbr"), "title": row.get("title")},
                "after": {"abbr": abbr, "title": title},
            }
        )

    out_path = ROOT / "scripts" / "fix-event-names-report.json"
    report = {"event_count": len(rows), "fixed_count": len(fixed), "fixed": fixed}
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"event_count={len(rows)} fixed_count={len(fixed)} -> {out_path}")


if __name__ == "__main__":
    main()
