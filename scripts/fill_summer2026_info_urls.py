#!/usr/bin/env python3
"""Fill info_url for Summer Collection 2026 spirits (admin-added, not in checker HTML)."""
import json
import sys
from pathlib import Path

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

from fill_gamewith_info_urls import (  # noqa: E402
    ROOT,
    SUPABASE_URL,
    supabase_headers,
    update_local_spirits_json,
)

EVENT_ID = "サマーコレクション2026-mr84pzee"

SPIRITS = [
    {
        "sort_order": 1,
        "name": "しっとりガチ恋 ガトリン・G・U",
        "info_url": "https://gamewith.jp/kuronekowiz/article/show/566119",
    },
    {
        "sort_order": 2,
        "name": "ナイトプールの妖精 ルミスフィレス",
        "info_url": "https://gamewith.jp/kuronekowiz/article/show/566120",
    },
    {
        "sort_order": 3,
        "name": "海風に揺れる耳と尾 セリアル・ノト",
        "info_url": "https://gamewith.jp/kuronekowiz/article/show/566885",
    },
    {
        "sort_order": 4,
        "name": "久＆々の海遊び！ 阿由葉チオ",
        "info_url": "https://gamewith.jp/kuronekowiz/article/show/566886",
    },
    {
        "sort_order": 5,
        "name": "火花纏う夏の乙女 ツバキ・リンドウ",
        "info_url": "https://gamewith.jp/kuronekowiz/article/show/566887",
    },
]


def main() -> None:
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/catalog_spirits",
        headers=supabase_headers(),
        params={
            "select": "id,event_id,sort_order,main,sub,name",
            "event_id": f"eq.{EVENT_ID}",
            "order": "sort_order",
        },
        timeout=60,
    )
    resp.raise_for_status()
    rows = {int(r["sort_order"]): r for r in resp.json()}

    updates = []
    mapping_by_id: dict[str, dict[str, str]] = {}
    for spec in SPIRITS:
        row = rows.get(spec["sort_order"])
        if not row:
            raise SystemExit(f"missing spirit sort_order={spec['sort_order']}")
        updates.append(
            {
                "id": row["id"],
                "event_id": row["event_id"],
                "sort_order": row["sort_order"],
                "main": row["main"],
                "sub": row["sub"],
                "name": spec["name"],
                "info_url": spec["info_url"],
            }
        )
        mapping_by_id[row["id"]] = {
            "name": spec["name"],
            "infoUrl": spec["info_url"],
        }

    upsert = requests.post(
        f"{SUPABASE_URL}/rest/v1/catalog_spirits",
        headers=supabase_headers(prefer="resolution=merge-duplicates"),
        json=updates,
        timeout=60,
    )
    upsert.raise_for_status()

    local_path = ROOT / "data" / "spirits.json"
    local_updated = update_local_spirits_json(mapping_by_id, path=local_path)

    print(
        json.dumps(
            {
                "supabase_updated": len(updates),
                "local_json_updated": local_updated,
                "spirits": [
                    {"sort_order": s["sort_order"], "name": s["name"], "info_url": s["info_url"]}
                    for s in SPIRITS
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
