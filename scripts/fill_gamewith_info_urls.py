#!/usr/bin/env python3
"""
GameWith 所持率チェッカー HTML から各精霊の GameWith 記事 URL を推定し、
個別記事を取得して正式精霊名も抽出、Supabase と data/spirits.json に反映する。

前提:
- data-from-gamewith/data-from-gamewith-code.html は最新の GameWith チェッカー HTML
- Supabase の catalog_events / catalog_spirits が既に存在する
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from parse_gamewith_events import DEFAULT_SOURCE, parse_events  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]

SUPABASE_URL = "https://lwddylqiyhnubeakrner.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3ZGR5bHFpeWhudWJlYWtybmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTQxNjksImV4cCI6MjA5NTczMDE2OX0."
    "PZs50EuI78GoXMBe-1cX16FNA8ddZ708l0_sob3AWko"
)

ARTICLE_ID_RE = re.compile(r"/i_(?P<id>\d+)_small\.(?:png|jpg|jpeg|webp)(?:\?.*)?$", re.I)
META_DESC_RE = re.compile(
    r'<meta[^>]*name=["\\\']description["\\\'][^>]*content=["\\\'](?P<content>[^"\\\']+)["\\\']',
    re.I,
)


def supabase_headers(*, prefer: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def fetch_all_rows(table: str, *, select: str, order: str = "id") -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page_size = 1000
    offset = 0
    while True:
        headers = supabase_headers()
        headers["Range"] = f"{offset}-{offset + page_size - 1}"
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=headers,
            params={"select": select, "order": order},
            timeout=60,
        )
        response.raise_for_status()
        batch = response.json()
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def extract_article_id_from_image_url(image_url: str) -> str | None:
    m = ARTICLE_ID_RE.search(image_url.strip())
    if not m:
        return None
    return m.group("id")


def build_info_url(article_id: str) -> str:
    return f"https://gamewith.jp/kuronekowiz/article/show/{article_id}"


def extract_official_name_from_article_html(html: str) -> str | None:
    m = META_DESC_RE.search(html)
    if not m:
        return None
    content = html_lib.unescape(m.group("content"))
    content = content.replace("\\r", " ").replace("\\n", " ").strip()
    if not content:
        return None
    # 例: "聖母の微笑 ラシュリィ・ミスク(GA2025後半ザウィナーズ)の評価と..."
    if "(" in content:
        head = content.split("(", 1)[0].strip()
        return head or None
    # "(...)" が無いケースは、先頭が精霊名である可能性が高いのでそのまま返す
    return content


def fetch_official_name(info_url: str, *, session: requests.Session, sleep_sec: float) -> str | None:
    resp = session.get(info_url, timeout=60)
    resp.raise_for_status()
    name = extract_official_name_from_article_html(resp.text)
    if sleep_sec:
        time.sleep(sleep_sec)
    return name


def chunked(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def update_local_spirits_json(mapping_by_id: dict[str, dict[str, str]], *, path: Path) -> int:
    catalog = load_json(path)
    updated = 0
    for section in catalog.get("sections", []):
        for event in section.get("events", []):
            for spirit in event.get("spirits", []):
                spirit_id = spirit.get("id")
                if not spirit_id:
                    continue
                info = mapping_by_id.get(spirit_id)
                if not info:
                    continue
                if info.get("name"):
                    spirit["name"] = info["name"]
                if info.get("infoUrl"):
                    spirit["infoUrl"] = info["infoUrl"]
                updated += 1
    save_json(path, catalog)
    return updated


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--local-json", type=Path, default=ROOT / "data" / "spirits.json")
    parser.add_argument("--sleep-sec", type=float, default=0.1, help="GameWith へのアクセス間隔")
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument(
        "--skip-name-fetch",
        action="store_true",
        help="個別記事を取得せず、info_url のみ埋める（name は既存を維持）",
    )
    parser.add_argument("--limit", type=int, help="デバッグ: 先頭 N 精霊のみ")
    args = parser.parse_args()

    html = args.source.read_text(encoding="utf-8")
    events, _issues = parse_events(html)

    # Supabase 側のイベント略称 -> event_id を引けるようにする
    event_rows = fetch_all_rows("catalog_events", select="id,abbr", order="id")
    abbr_to_event_id = {row["abbr"]: row["id"] for row in event_rows}

    # (event_id, sort_order) -> existing spirit row (NOT NULL columns)
    spirit_rows = fetch_all_rows(
        "catalog_spirits",
        select="id,event_id,sort_order,name,main,sub,image_path",
        order="event_id,sort_order",
    )
    key_to_spirit_row: dict[tuple[str, int], dict[str, Any]] = {}
    for row in spirit_rows:
        key_to_spirit_row[(row["event_id"], int(row["sort_order"]))] = row

    session = requests.Session()
    updates: list[dict[str, Any]] = []
    mapping_by_id: dict[str, dict[str, str]] = {}
    stats = {"no_event_id": 0, "no_article_id": 0, "no_spirit_id": 0, "ok": 0}

    count = 0
    for event in events:
        abbr = event["abbr"]
        event_id = abbr_to_event_id.get(abbr)
        if not event_id:
            stats["no_event_id"] += 1
            continue
        for index, spirit in enumerate(event["spirits"], start=1):
            image_url = spirit["image_url"]
            article_id = extract_article_id_from_image_url(image_url)
            if not article_id:
                stats["no_article_id"] += 1
                continue
            info_url = build_info_url(article_id)
            existing = key_to_spirit_row.get((event_id, index))
            if not existing:
                stats["no_spirit_id"] += 1
                continue
            official_name = (
                existing["name"]
                if args.skip_name_fetch
                else (fetch_official_name(info_url, session=session, sleep_sec=args.sleep_sec) or spirit["name"])
            )

            # Upsert は INSERT 経路も通るため NOT NULL 列をすべて含める
            row = {
                "id": existing["id"],
                "event_id": existing["event_id"],
                "sort_order": existing["sort_order"],
                "main": existing["main"],
                "sub": existing["sub"],
                "name": official_name,
                "info_url": info_url,
            }
            updates.append(row)
            mapping_by_id[existing["id"]] = {"name": official_name, "infoUrl": info_url}

            stats["ok"] += 1
            count += 1
            if args.limit and count >= args.limit:
                break
        if args.limit and count >= args.limit:
            break

    # Supabase upsert（既存行に上書き）
    for batch in chunked(updates, args.batch_size):
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/catalog_spirits",
            headers=supabase_headers(prefer="resolution=merge-duplicates"),
            json=batch,
            timeout=120,
        )
        resp.raise_for_status()

    # ローカル JSON も同様に更新（フォールバック用）
    local_updated = update_local_spirits_json(mapping_by_id, path=args.local_json)

    print(
        json.dumps(
            {
                "updates": len(updates),
                "local_json_updated": local_updated,
                "events_seen": len(events),
                "stats": stats,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

