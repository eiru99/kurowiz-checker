#!/usr/bin/env python3
"""GameWith チェッカー HTML から精霊を取り込み、Supabase Storage にアップロードする。"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import uuid
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data-from-gamewith" / "data-from-gamewith-code.html"

SUPABASE_URL = "https://lwddylqiyhnubeakrner.supabase.co"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3ZGR5bHFpeWhudWJlYWtybmVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTQxNjksImV4cCI6MjA5NTczMDE2OX0."
    "PZs50EuI78GoXMBe-1cX16FNA8ddZ708l0_sob3AWko"
)
STORAGE_BUCKET = "spirit-images"
SPIRIT_IMAGE_SIZE = 128

EVENT_BLOCK_RE = re.compile(
    r'<h3 class="event-title[^"]*">\s*(?P<abbr>[^<]+?)<a[^>]*>.*?</a>\s*</h3>\s*'
    r'<p>\s*<span class=[\'"]bolder[\'"]>(?P<title>[^<]+)</span>\s*</p>\s*'
    r'<ol class="w-checker-group">(?P<spirits>.*?)</ol>',
    re.DOTALL,
)
SPIRIT_IMG_RE = re.compile(
    r"data-original='(?P<url>[^']+)'[^>]*alt='(?P<name>[^']*)'",
    re.DOTALL,
)


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return (value[:48] or "item")


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


def upload_spirit_image(webp_bytes: bytes) -> str:
    path = f"{uuid.uuid4()}.webp"
    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}/{path}"
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            "apikey": SUPABASE_ANON_KEY,
            "Content-Type": "image/webp",
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


def find_event_block(html: str, abbr: str) -> re.Match[str]:
    for match in EVENT_BLOCK_RE.finditer(html):
        if match.group("abbr").strip() == abbr:
            return match
    raise SystemExit(f"イベント '{abbr}' が見つかりません")


def parse_spirits(spirits_html: str) -> list[dict[str, str]]:
    spirits = []
    for match in SPIRIT_IMG_RE.finditer(spirits_html):
        spirits.append(
            {
                "name": match.group("name").strip(),
                "image_url": match.group("url").strip(),
            }
        )
    if not spirits:
        raise SystemExit("精霊画像が見つかりません")
    return spirits


def save_local_png(local_dir: Path, file_stem: str, png_bytes: bytes) -> Path:
    local_dir.mkdir(parents=True, exist_ok=True)
    path = local_dir / f"{file_stem}.png"
    path.write_bytes(png_bytes)
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--abbr", required=True, help="イベント略称 (例: かみさんぽっ3)")
    parser.add_argument("--event-id", required=True, help="イベント ID (例: kamisanpo3)")
    parser.add_argument("--section-id", default="latest")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--local-dir", type=Path, default=ROOT / "images" / "spirits")
    parser.add_argument(
        "--attrs",
        type=Path,
        help='属性 JSON。例: {"カヌエ":["火","光"],"ソラ":["水","闇"]}',
    )
    parser.add_argument(
        "--id-slugs",
        type=Path,
        help='精霊 ID 用スラッグ JSON。例: {"カヌエ":"kanue","ソラ":"sora"}',
    )
    parser.add_argument("--upload", action="store_true", help="Supabase Storage にアップロード")
    parser.add_argument("--json-out", type=Path, help="取り込み結果を JSON で出力")
    args = parser.parse_args()

    html = args.source.read_text(encoding="utf-8")
    block = find_event_block(html, args.abbr)
    title = block.group("title").strip()
    spirits = parse_spirits(block.group("spirits"))
    attrs = json.loads(args.attrs.read_text(encoding="utf-8")) if args.attrs else {}
    id_slugs = json.loads(args.id_slugs.read_text(encoding="utf-8")) if args.id_slugs else {}

    result = {
        "event": {
            "id": args.event_id,
            "section_id": args.section_id,
            "abbr": args.abbr.strip(),
            "title": title,
            "sort_order": 1,
        },
        "spirits": [],
    }

    for index, spirit in enumerate(spirits, start=1):
        name = spirit["name"]
        slug = id_slugs.get(name) or slugify(name)
        spirit_id = f"{args.event_id}-{slug}"
        file_stem = f"{args.event_id}-{slug}"
        png_bytes = download_image(spirit["image_url"])
        local_path = save_local_png(args.local_dir, file_stem, png_bytes)
        main, sub = attrs.get(name, ["火", "火"])
        image_path = f"images/spirits/{file_stem}.png"

        if args.upload:
            webp_bytes = normalize_spirit_image(png_bytes)
            image_path = upload_spirit_image(webp_bytes)

        result["spirits"].append(
            {
                "id": spirit_id,
                "event_id": args.event_id,
                "name": name,
                "main": main,
                "sub": sub,
                "image_path": image_path,
                "local_path": str(local_path.relative_to(ROOT)).replace("\\", "/"),
                "sort_order": index,
            }
        )
        print(f"[{index}] {name} -> {image_path}")

    if args.json_out:
        args.json_out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {args.json_out}")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
