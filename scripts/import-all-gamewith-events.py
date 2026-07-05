#!/usr/bin/env python3
"""GameWith HTML から全イベントを Supabase に取り込む。"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import uuid
from collections import Counter
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import requests
from PIL import Image
from parse_gamewith_events import DEFAULT_SOURCE, SECTION_MAP, normalize_event_names, parse_events, slugify
from romaji_slug import abbr_to_storage_folder
from spirit_attribute_detect import detect_spirit_attributes_from_bytes, normalize_attributes

ROOT = Path(__file__).resolve().parents[1]


def configure_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, OSError, ValueError):
                pass


def log_print(*args, **kwargs) -> None:
    kwargs.setdefault("flush", True)
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        text = " ".join(str(arg) for arg in args)
        sys.stdout.buffer.write((text + kwargs.get("end", "\n")).encode("utf-8", errors="replace"))
        if kwargs.get("flush", True):
            sys.stdout.buffer.flush()


SUPABASE_URL = "https://lwddylqiyhnubeakrner.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3ZGR5bHFpeWhudWJlYWtybmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTQxNjksImV4cCI6MjA5NTczMDE2OX0."
    "PZs50EuI78GoXMBe-1cX16FNA8ddZ708l0_sob3AWko"
)
STORAGE_BUCKET = "spirit-images"
SPIRIT_IMAGE_SIZE = 128

SKIP_ABBRS = {"かみさんぽっ3"}
KNOWN_EVENT_IDS = {"latest-e313": "kamisanpo3", "かみさんぽっ3": "kamisanpo3"}


def supabase_headers(*, prefer: str | None = None, content_type: str = "application/json") -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": content_type,
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def normalize_spirit_image(png_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(png_bytes)) as image:
        image = image.convert("RGBA")
        width, height = image.size
        size = min(width, height)
        left = (width - size) // 2
        top = (height - size) // 2
        cropped = image.crop((left, top, left + size, top + size))
        resized = cropped.resize((SPIRIT_IMAGE_SIZE, SPIRIT_IMAGE_SIZE), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        resized.save(out, format="WEBP", quality=90)
        return out.getvalue()


def upload_spirit_image(webp_bytes: bytes, storage_folder: str) -> str:
    path = f"{storage_folder.strip()}/{uuid.uuid4()}.webp"
    response = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{path}",
        headers={
            **supabase_headers(content_type="image/webp"),
            "x-upsert": "true",
        },
        data=webp_bytes,
        timeout=60,
    )
    response.raise_for_status()
    return path


def download_image(url: str) -> bytes:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return response.content


def fetch_existing_event_ids() -> set[str]:
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/catalog_events",
        headers=supabase_headers(),
        params={"select": "id"},
        timeout=60,
    )
    response.raise_for_status()
    return {row["id"] for row in response.json()}


def ensure_sections() -> None:
    rows = [
        {"id": section_id, "title": title, "sort_order": index + 1}
        for index, (_, (section_id, title)) in enumerate(SECTION_MAP.items())
    ]
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/catalog_sections",
        headers=supabase_headers(prefer="resolution=merge-duplicates"),
        json=rows,
        timeout=60,
    )
    response.raise_for_status()


def sync_event(result: dict) -> None:
    event = result["event"]
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/catalog_events",
        headers=supabase_headers(prefer="resolution=merge-duplicates"),
        json={
            "id": event["id"],
            "section_id": event["section_id"],
            "abbr": event["abbr"],
            "title": event["title"],
            "storage_folder": event["storage_folder"],
            "sort_order": event["sort_order"],
        },
        timeout=60,
    )
    response.raise_for_status()

    delete_response = requests.delete(
        f"{SUPABASE_URL}/rest/v1/catalog_spirits",
        headers=supabase_headers(),
        params={"event_id": f"eq.{event['id']}"},
        timeout=60,
    )
    delete_response.raise_for_status()

    if not result["spirits"]:
        return

    spirits_response = requests.post(
        f"{SUPABASE_URL}/rest/v1/catalog_spirits",
        headers=supabase_headers(),
        json=result["spirits"],
        timeout=60,
    )
    spirits_response.raise_for_status()


def build_spirit_ids(event_id: str, spirits: list[dict]) -> list[str]:
    used: Counter[str] = Counter()
    ids: list[str] = []
    for spirit in spirits:
        base = f"{event_id}-{slugify(spirit['name'])}"
        used[base] += 1
        spirit_id = base if used[base] == 1 else f"{base}-{used[base]}"
        ids.append(spirit_id)
    return ids


def import_event(event: dict, *, save_local: bool, local_dir: Path) -> dict:
    event_id = KNOWN_EVENT_IDS.get(event["id"], KNOWN_EVENT_IDS.get(event["abbr"], event["id"]))
    abbr, title = normalize_event_names(event["abbr"], event["title"])
    storage_folder = abbr_to_storage_folder(abbr, event_id=event_id)
    result = {
        "event": {
            "id": event_id,
            "section_id": event["section_id"],
            "abbr": abbr,
            "title": title,
            "storage_folder": storage_folder,
            "sort_order": event["sort_order"],
        },
        "spirits": [],
        "warnings": [],
    }

    spirit_ids = build_spirit_ids(event_id, event["spirits"])
    for index, (spirit, spirit_id) in enumerate(zip(event["spirits"], spirit_ids), start=1):
        name = spirit["name"]
        png_bytes = download_image(spirit["image_url"])
        try:
            main, sub = normalize_attributes(detect_spirit_attributes_from_bytes(png_bytes))
        except ValueError as error:
            main, sub = "火", "火"
            result["warnings"].append(f"{name}: {error}")

        if save_local:
            local_dir.mkdir(parents=True, exist_ok=True)
            (local_dir / f"{spirit_id}.png").write_bytes(png_bytes)

        webp_bytes = normalize_spirit_image(png_bytes)
        image_path = upload_spirit_image(webp_bytes, storage_folder)
        result["spirits"].append(
            {
                "id": spirit_id,
                "event_id": event_id,
                "name": name,
                "main": main,
                "sub": sub,
                "image_path": image_path,
                "sort_order": index,
            }
        )

    sync_event(result)
    return result


def fetch_all_rows(table: str, *, select: str, order: str) -> list[dict]:
    rows: list[dict] = []
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


def export_catalog_json(out_path: Path) -> None:
    sections = fetch_all_rows("catalog_sections", select="id,title,sort_order", order="sort_order")
    events = fetch_all_rows(
        "catalog_events",
        select="id,section_id,abbr,title,storage_folder,sort_order",
        order="sort_order",
    )
    spirits = fetch_all_rows(
        "catalog_spirits",
        select="id,event_id,name,main,sub,image_path,sort_order",
        order="sort_order",
    )

    spirits_by_event: dict[str, list[dict]] = {}
    for spirit in spirits:
        spirits_by_event.setdefault(spirit["event_id"], []).append(
            {
                "id": spirit["id"],
                "name": spirit["name"],
                "main": spirit["main"],
                "sub": spirit["sub"],
                "image": spirit["image_path"],
            }
        )

    events_by_section: dict[str, list[dict]] = {}
    for event in events:
        events_by_section.setdefault(event["section_id"], []).append(
            {
                "id": event["id"],
                "abbr": event["abbr"],
                "title": event["title"],
                "storageFolder": event.get("storage_folder"),
                "spirits": spirits_by_event.get(event["id"], []),
            }
        )

    catalog = {
        "version": 1,
        "sections": [
            {
                "id": section["id"],
                "title": section["title"],
                "events": events_by_section.get(section["id"], []),
            }
            for section in sections
        ],
    }
    out_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")


def resolve_event_id(event: dict) -> str:
    return KNOWN_EVENT_IDS.get(event["id"], KNOWN_EVENT_IDS.get(event["abbr"], event["id"]))


def main() -> None:
    configure_stdout()

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--local-dir", type=Path, default=ROOT / "images" / "spirits")
    parser.add_argument("--save-local", action="store_true")
    parser.add_argument("--limit", type=int, help="デバッグ用: 先頭 N イベントのみ")
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Supabase に既にある event id はスキップ",
    )
    parser.add_argument("--report-out", type=Path, default=ROOT / "scripts" / "gamewith-import-report.json")
    args = parser.parse_args()

    html = args.source.read_text(encoding="utf-8")
    events, issues = parse_events(html)
    ensure_sections()

    existing_ids: set[str] = set()
    if args.skip_existing:
        existing_ids = fetch_existing_event_ids()
        log_print(f"skip-existing: {len(existing_ids)} events in Supabase")

    imported: list[dict] = []
    failures: list[dict] = []
    skipped_existing: list[str] = []

    targets = [event for event in events if event["abbr"] not in SKIP_ABBRS]
    if args.limit:
        targets = targets[: args.limit]

    total = len(targets)
    for index, event in enumerate(targets, start=1):
        event_id = resolve_event_id(event)
        label = f"[{index}/{total}] {event['abbr']}"
        if args.skip_existing and event_id in existing_ids:
            skipped_existing.append(event_id)
            log_print(f"{label} skip (already imported)")
            continue
        log_print(f"{label} ...")
        try:
            result = import_event(event, save_local=args.save_local, local_dir=args.local_dir)
            imported.append(result)
            log_print(f"{label} ok ({len(result['spirits'])} spirits)")
        except Exception as error:  # noqa: BLE001 - batch import report
            failures.append({"abbr": event["abbr"], "event_id": event_id, "error": str(error)})
            log_print(f"{label} FAILED: {error}")
        time.sleep(0.2)

    report = {
        "imported_count": len(imported),
        "failed_count": len(failures),
        "skipped_existing_count": len(skipped_existing),
        "skipped_abbrs": sorted(SKIP_ABBRS),
        "issues": issues,
        "failures": failures,
        "warnings": [
            {"abbr": item["event"]["abbr"], "warnings": item.get("warnings", [])}
            for item in imported
            if item.get("warnings")
        ],
    }
    args.report_out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    export_catalog_json(ROOT / "data" / "spirits.json")
    log_print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
