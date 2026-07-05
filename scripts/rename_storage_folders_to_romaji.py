#!/usr/bin/env python3
"""Storage 上のイベントフォルダを、略称ローマ字名へ rename する。

Supabase Storage にフォルダ rename API はないため、同一バケット内 move API で
`old-folder/file.webp` -> `new-folder/file.webp` とパスを付け替える（サーバー側処理）。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from romaji_slug import abbr_to_storage_folder

SUPABASE_URL = "https://lwddylqiyhnubeakrner.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3ZGR5bHFpeWhudWJlYWtybmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTQxNjksImV4cCI6MjA5NTczMDE2OX0."
    "PZs50EuI78GoXMBe-1cX16FNA8ddZ708l0_sob3AWko"
)
STORAGE_BUCKET = "spirit-images"
PAGE_SIZE = 1000


def headers(*, content_type: str = "application/json") -> dict[str, str]:
    return {
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": content_type,
    }


def fetch_all_rows(table: str, select: str, order: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        batch_headers = headers()
        batch_headers["Range"] = f"{offset}-{offset + PAGE_SIZE - 1}"
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=batch_headers,
            params={"select": select, "order": order},
            timeout=60,
        )
        response.raise_for_status()
        batch = response.json()
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def public_url(object_key: str) -> str:
    return (
        f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/"
        f"{quote(object_key, safe='/')}"
    )


def storage_object_exists(object_key: str) -> bool:
    response = requests.head(public_url(object_key), timeout=60)
    return response.status_code == 200


def relocate_storage_object(source_key: str, destination_key: str) -> str:
    if source_key == destination_key:
        return "already_done"

    if storage_object_exists(destination_key):
        return "destination_exists"

    response = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/move",
        headers=headers(),
        json={
            "bucketId": STORAGE_BUCKET,
            "sourceKey": source_key,
            "destinationKey": destination_key,
        },
        timeout=60,
    )
    if response.status_code < 400:
        return "moved"

    if not storage_object_exists(source_key):
        if storage_object_exists(destination_key):
            return "destination_exists"
        raise RuntimeError(f"source missing: {source_key}")

    download = requests.get(public_url(source_key), timeout=60)
    download.raise_for_status()

    upload = requests.post(
        f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{quote(destination_key, safe='/')}",
        headers={
            **headers(content_type=download.headers.get("Content-Type", "image/webp")),
            "x-upsert": "true",
        },
        data=download.content,
        timeout=60,
    )
    upload.raise_for_status()

    delete = requests.delete(
        f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{quote(source_key, safe='/')}",
        headers=headers(),
        timeout=60,
    )
    if delete.status_code >= 400 and delete.status_code != 404:
        delete.raise_for_status()

    return "copied"


def update_spirit_image_path(spirit_id: str, image_path: str) -> None:
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/catalog_spirits",
        headers=headers(),
        params={"id": f"eq.{spirit_id}"},
        json={"image_path": image_path},
        timeout=60,
    )
    response.raise_for_status()


def update_event_storage_folder(event_id: str, storage_folder: str) -> None:
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/catalog_events",
        headers=headers(),
        params={"id": f"eq.{event_id}"},
        json={"storage_folder": storage_folder},
        timeout=60,
    )
    response.raise_for_status()


def build_folder_map(events: list[dict]) -> dict[str, str]:
    folder_map: dict[str, str] = {}
    slug_counts: dict[str, list[str]] = {}

    for event in events:
        folder = abbr_to_storage_folder(event["abbr"], event_id=event["id"])
        slug_counts.setdefault(folder, []).append(event["id"])
        folder_map[event["id"]] = folder

    collisions = {slug: ids for slug, ids in slug_counts.items() if len(ids) > 1}
    if collisions:
        raise RuntimeError(f"storage folder slug collision: {collisions}")

    return folder_map


def rename_folders(*, dry_run: bool = False) -> dict:
    events = fetch_all_rows("catalog_events", "id,abbr", "sort_order,id")
    spirits = fetch_all_rows("catalog_spirits", "id,event_id,image_path", "sort_order,id")
    folder_map = build_folder_map(events)

    folder_renames: dict[str, str] = {}
    file_renames: list[dict] = []

    for spirit in spirits:
        image_path = spirit.get("image_path")
        if not image_path or str(image_path).startswith("images/"):
            continue
        if "/" not in str(image_path):
            continue

        source_key = str(image_path)
        current_folder = PurePosixPath(source_key).parts[0]
        target_folder = folder_map.get(spirit["event_id"])
        if not target_folder:
            continue

        folder_renames[current_folder] = target_folder
        destination_key = str(PurePosixPath(target_folder) / PurePosixPath(source_key).name)
        if source_key == destination_key:
            continue

        file_renames.append(
            {
                "spirit_id": spirit["id"],
                "event_id": spirit["event_id"],
                "from": source_key,
                "to": destination_key,
            }
        )

    unique_folder_renames = {
        old: new for old, new in folder_renames.items() if old != new
    }

    if not dry_run:
        stats: dict[str, int] = defaultdict(int)
        failures: list[dict] = []

        for index, change in enumerate(file_renames, start=1):
            try:
                method = relocate_storage_object(change["from"], change["to"])
                stats[method] += 1
                update_spirit_image_path(change["spirit_id"], change["to"])
            except Exception as error:  # noqa: BLE001 - batch report
                failures.append(
                    {
                        "spirit_id": change["spirit_id"],
                        "from": change["from"],
                        "to": change["to"],
                        "error": str(error),
                    }
                )
            if index % 50 == 0:
                print(f"processed {index}/{len(file_renames)} files...", flush=True)
            time.sleep(0.02)

        for event in events:
            update_event_storage_folder(event["id"], folder_map[event["id"]])
            time.sleep(0.01)
    else:
        stats = {}
        failures = []

    folder_rename_preview = []
    grouped: dict[tuple[str, str], int] = defaultdict(int)
    for change in file_renames:
        old_folder = PurePosixPath(change["from"]).parts[0]
        new_folder = PurePosixPath(change["to"]).parts[0]
        grouped[(old_folder, new_folder)] += 1
    for (old_folder, new_folder), count in sorted(grouped.items())[:30]:
        folder_rename_preview.append({"from": old_folder, "to": new_folder, "files": count})

    return {
        "events": len(events),
        "folder_renames": len(unique_folder_renames),
        "file_renames": len(file_renames),
        "stats": dict(stats),
        "failures": failures[:20],
        "failure_count": len(failures),
        "folder_rename_preview": folder_rename_preview,
        "dry_run": dry_run,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    report = rename_folders(dry_run=args.dry_run)
    out_path = SCRIPTS_DIR / "rename-romaji-folders-report.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"report -> {out_path}")


if __name__ == "__main__":
    main()
