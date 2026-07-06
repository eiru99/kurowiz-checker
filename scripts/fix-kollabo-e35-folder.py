#!/usr/bin/env python3
"""kollabo-e35 の Storage フォルダを seeraamuunkorabo → shingekinokyojinkorabo に修正。"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
CONFIG = (ROOT / "js" / "config.js").read_text(encoding="utf-8")
SUPABASE_URL = re.search(r"SUPABASE_URL = '([^']+)'", CONFIG).group(1)
SUPABASE_KEY = re.search(r"SUPABASE_ANON_KEY = '([^']+)'", CONFIG).group(1)
STORAGE_BUCKET = "spirit-images"

EVENT_ID = "kollabo-e35"
OLD_FOLDER = "seeraamuunkorabo"
NEW_FOLDER = "shingekinokyojinkorabo"


def headers(*, content_type: str = "application/json") -> dict[str, str]:
    return {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "apikey": SUPABASE_KEY,
        "Content-Type": content_type,
    }


def api_request(method: str, url: str, data: bytes | None = None, extra: dict | None = None) -> None:
    h = headers()
    if extra:
        h.update(extra)
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"{method} {url} -> {resp.status}")


def fetch_spirits() -> list[dict]:
    url = (
        f"{SUPABASE_URL}/rest/v1/catalog_spirits"
        f"?event_id=eq.{EVENT_ID}&select=id,name,image_path"
    )
    req = urllib.request.Request(url, headers=headers())
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def move_storage_object(source_key: str, destination_key: str) -> None:
    body = json.dumps(
        {"bucketId": STORAGE_BUCKET, "sourceKey": source_key, "destinationKey": destination_key}
    ).encode()
    move_url = f"{SUPABASE_URL}/storage/v1/object/move"
    req = urllib.request.Request(move_url, data=body, method="POST", headers=headers())
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            if resp.status < 400:
                return
    except urllib.error.HTTPError:
        pass

    public_url = (
        f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/"
        f"{urllib.parse.quote(source_key, safe='/')}"
    )
    with urllib.request.urlopen(public_url, timeout=60) as resp:
        content = resp.read()
        content_type = resp.headers.get("Content-Type", "image/webp")

    dest_url = (
        f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/"
        f"{urllib.parse.quote(destination_key, safe='/')}"
    )
    upload_req = urllib.request.Request(
        dest_url,
        data=content,
        method="POST",
        headers={**headers(content_type=content_type), "x-upsert": "true"},
    )
    with urllib.request.urlopen(upload_req, timeout=60):
        pass

    delete_url = (
        f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/"
        f"{urllib.parse.quote(source_key, safe='/')}"
    )
    delete_req = urllib.request.Request(delete_url, method="DELETE", headers=headers())
    with urllib.request.urlopen(delete_req, timeout=60):
        pass


def main() -> None:
    spirits = fetch_spirits()
    moved = 0
    for spirit in spirits:
        path = spirit.get("image_path") or ""
        if not path.startswith(f"{OLD_FOLDER}/"):
            print(f"skip {spirit['id']}: {path}")
            continue
        filename = PurePosixPath(path).name
        new_path = f"{NEW_FOLDER}/{filename}"
        print(f"{spirit['name']}: {path} -> {new_path}")
        move_storage_object(path, new_path)

        patch_url = (
            f"{SUPABASE_URL}/rest/v1/catalog_spirits?id=eq."
            f"{urllib.parse.quote(spirit['id'], safe='')}"
        )
        body = json.dumps({"image_path": new_path}).encode()
        req = urllib.request.Request(patch_url, data=body, method="PATCH", headers=headers())
        with urllib.request.urlopen(req, timeout=60):
            pass
        moved += 1

    patch_event_url = (
        f"{SUPABASE_URL}/rest/v1/catalog_events?id=eq.{EVENT_ID}"
    )
    body = json.dumps({"storage_folder": NEW_FOLDER}).encode()
    req = urllib.request.Request(patch_event_url, data=body, method="PATCH", headers=headers())
    with urllib.request.urlopen(req, timeout=60):
        pass

    print(f"Done: moved {moved} spirit image(s), updated event storage_folder -> {NEW_FOLDER}")


if __name__ == "__main__":
    main()
