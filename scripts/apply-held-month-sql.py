#!/usr/bin/env python3
"""catalog_events_held_month_fill.sql を Supabase に適用する。"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL_FILE = ROOT / "supabase" / "catalog_events_held_month_fill.sql"


def main() -> None:
    config = (ROOT / "js" / "config.js").read_text(encoding="utf-8")
    url = re.search(r"SUPABASE_URL = '([^']+)'", config).group(1)
    key = re.search(r"SUPABASE_ANON_KEY = '([^']+)'", config).group(1)

    updates = [
        line.strip()
        for line in SQL_FILE.read_text(encoding="utf-8").splitlines()
        if line.startswith("UPDATE")
    ]

    rpc_url = f"{url}/rest/v1/rpc/execute_sql"
    # PostgREST には生 SQL がないので 1 件ずつ PATCH
    patched = 0
    for line in updates:
        m = re.search(
            r"held_year = (\d+), held_month = (\d+) WHERE id = '([^']+)'",
            line,
        )
        if not m:
            continue
        year, month, event_id = m.group(1), m.group(2), m.group(3)
        patch_url = (
            f"{url}/rest/v1/catalog_events?id=eq."
            f"{urllib.parse.quote(event_id, safe='')}"
        )
        body = json.dumps({"held_year": int(year), "held_month": int(month)}).encode()
        req = urllib.request.Request(
            patch_url,
            data=body,
            method="PATCH",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status not in (200, 204):
                raise RuntimeError(f"Failed {event_id}: {resp.status}")
        patched += 1
        if patched % 50 == 0:
            print(f"Patched {patched}/{len(updates)}")

    print(f"Done: {patched} events updated")


if __name__ == "__main__":
    main()
