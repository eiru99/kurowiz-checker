#!/usr/bin/env python3
"""Storage 上の精霊画像を event_id フォルダ配下へ移動し、image_path を更新する。"""

from __future__ import annotations

import argparse
import json
from pathlib import PurePosixPath
from urllib.parse import quote

import requests

SUPABASE_URL = "https://lwddylqiyhnubeakrner.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3ZGR5bHFpeWhudWJlYWtybmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTQxNjksImV4cCI6MjA5NTczMDE2OX0."
    "PZs50EuI78GoXMBe-1cX16FNA8ddZ708l0_sob3AWko"
)
STORAGE_BUCKET = "spirit-images"


def headers(*, content_type: str = "application/json") -> dict[str, str]:
    return {
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": content_type,
    }


def fetch_flat_spirits(event_id: str | None = None) -> list[dict]:
    params = {"select": "id,event_id,name,image_path"}
    if event_id:
        params["event_id"] = f"eq.{event_id}"
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/catalog_spirits",
        headers=headers(),
        params=params,
        timeout=60,
    )
    response.raise_for_status()
    rows = response.json()
    return [
        row
        for row in rows
        if row.get("image_path")
        and not str(row["image_path"]).startswith("images/")
        and "/" not in str(row["image_path"])
    ]


def move_storage_object(source_key: str, destination_key: str) -> None:
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
        return

    public_url = (
        f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/"
        f"{quote(source_key, safe='/')}"
    )
    download = requests.get(public_url, timeout=60)
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
    delete.raise_for_status()


def update_image_path(spirit_id: str, image_path: str) -> None:
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/catalog_spirits",
        headers=headers(),
        params={"id": f"eq.{spirit_id}"},
        json={"image_path": image_path},
        timeout=60,
    )
    response.raise_for_status()


def migrate(event_id: str | None = None, dry_run: bool = False) -> list[dict]:
    spirits = fetch_flat_spirits(event_id)
    changes = []

    for spirit in spirits:
        source_key = spirit["image_path"]
        destination_key = str(PurePosixPath(spirit["event_id"]) / PurePosixPath(source_key).name)
        change = {
            "id": spirit["id"],
            "name": spirit["name"],
            "event_id": spirit["event_id"],
            "from": source_key,
            "to": destination_key,
        }
        changes.append(change)

        if dry_run:
            continue

        move_storage_object(source_key, destination_key)
        update_image_path(spirit["id"], destination_key)

    return changes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-id", help="特定イベントのみ移行 (例: kamisanpo3)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    changes = migrate(args.event_id, dry_run=args.dry_run)
    print(json.dumps(changes, ensure_ascii=False, indent=2))
    print(f"{'Would migrate' if args.dry_run else 'Migrated'} {len(changes)} file(s)")


if __name__ == "__main__":
    main()
