#!/usr/bin/env python3
"""catalog_events_corrections.sql を Supabase に適用する。"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL_FILE = ROOT / "supabase" / "catalog_events_corrections.sql"


def main() -> None:
    config = (ROOT / "js" / "config.js").read_text(encoding="utf-8")
    url = re.search(r"SUPABASE_URL = '([^']+)'", config).group(1)
    key = re.search(r"SUPABASE_ANON_KEY = '([^']+)'", config).group(1)
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    held = 0
    meta = 0
    for line in SQL_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line.startswith("UPDATE"):
            continue

        m = re.search(
            r"held_year = (\d+), held_month = (\d+) WHERE id = '([^']+)'",
            line,
        )
        if m:
            year, month, event_id = int(m.group(1)), int(m.group(2)), m.group(3)
            patch_url = (
                f"{url}/rest/v1/catalog_events?id=eq."
                f"{urllib.parse.quote(event_id, safe='')}"
            )
            body = json.dumps({"held_year": year, "held_month": month}).encode()
            req = urllib.request.Request(patch_url, data=body, method="PATCH", headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status not in (200, 204):
                    raise RuntimeError(f"held_month failed {event_id}: {resp.status}")
            held += 1
            continue

        m = re.search(r"SET title = '([^']+)' WHERE id = '([^']+)'", line)
        if m:
            title, event_id = m.group(1), m.group(2)
            patch_url = (
                f"{url}/rest/v1/catalog_events?id=eq."
                f"{urllib.parse.quote(event_id, safe='')}"
            )
            body = json.dumps({"title": title}).encode()
            req = urllib.request.Request(patch_url, data=body, method="PATCH", headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status not in (200, 204):
                    raise RuntimeError(f"title failed {event_id}: {resp.status}")
            meta += 1
            continue

        m = re.search(r"SET abbr = '([^']+)' WHERE id = '([^']+)'", line)
        if m:
            abbr, event_id = m.group(1), m.group(2)
            patch_url = (
                f"{url}/rest/v1/catalog_events?id=eq."
                f"{urllib.parse.quote(event_id, safe='')}"
            )
            body = json.dumps({"abbr": abbr}).encode()
            req = urllib.request.Request(patch_url, data=body, method="PATCH", headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status not in (200, 204):
                    raise RuntimeError(f"abbr failed {event_id}: {resp.status}")
            meta += 1
            continue

        raise ValueError(f"Unparsed SQL: {line}")

    print(f"Done: held_month={held}, metadata={meta}")


if __name__ == "__main__":
    main()
