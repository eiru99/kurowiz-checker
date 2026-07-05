#!/usr/bin/env python3
"""DB 未参照の Storage フォルダ一覧を出力する。"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import importlib.util

import requests

SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT = SCRIPTS_DIR.parent

IMPORT_SCRIPT = SCRIPTS_DIR / "import-all-gamewith-events.py"
spec = importlib.util.spec_from_file_location("import_all_gamewith_events", IMPORT_SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)
SUPABASE_URL = module.SUPABASE_URL
SUPABASE_ANON_KEY = module.SUPABASE_ANON_KEY

STORAGE_BUCKET = "spirit-images"
PAGE_SIZE = 1000
OLD_FOLDER_RE = re.compile(r"^(latest|recent|charapre|download|other|kollabo)-e\d+$")


def headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }


def fetch_used_folders() -> set[str]:
    used: set[str] = set()
    offset = 0
    while True:
        batch_headers = headers()
        batch_headers["Range"] = f"{offset}-{offset + PAGE_SIZE - 1}"
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/catalog_spirits",
            headers=batch_headers,
            params={"select": "image_path", "order": "id"},
            timeout=60,
        )
        response.raise_for_status()
        batch = response.json()
        if not batch:
            break
        for row in batch:
            image_path = row.get("image_path") or ""
            if "/" in image_path:
                used.add(image_path.split("/", 1)[0])
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return used


def fetch_storage_folders() -> dict[str, int]:
    folders: dict[str, int] = {}
    offset = 0
    while True:
        response = requests.post(
            f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}",
            headers=headers(),
            json={"prefix": "", "limit": PAGE_SIZE, "offset": offset},
            timeout=60,
        )
        response.raise_for_status()
        items = response.json()
        if not items:
            break
        for item in items:
            name = item.get("name", "")
            if "/" not in name:
                continue
            folder, _filename = name.split("/", 1)
            folders[folder] = folders.get(folder, 0) + 1
        if len(items) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return folders


def main() -> None:
    used = fetch_used_folders()
    storage = fetch_storage_folders()
    deletable = sorted(folder for folder in storage if folder not in used)
    old_style = [folder for folder in deletable if OLD_FOLDER_RE.match(folder)]
    other = [folder for folder in deletable if not OLD_FOLDER_RE.match(folder)]

    report = {
        "storage_folder_count": len(storage),
        "used_folder_count": len(used),
        "deletable_folder_count": len(deletable),
        "deletable_old_style_count": len(old_style),
        "deletable_other_count": len(other),
        "deletable_old_style": [
            {"folder": folder, "files": storage[folder]} for folder in old_style
        ],
        "deletable_other": [
            {"folder": folder, "files": storage[folder]} for folder in other
        ],
    }
    out_path = ROOT / "scripts" / "deletable-storage-folders.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"report -> {out_path}")


if __name__ == "__main__":
    main()
