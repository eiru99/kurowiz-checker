#!/usr/bin/env python3
"""GameWith HTML から全イベント一覧を抽出する。"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data-from-gamewith" / "data-from-gamewith-code.html"

SECTION_MAP = {
    "new": ("latest", "最新ガチャ"),
    "recent": ("recent", "直近ガチャ"),
    "event": ("charapre", "キャラプレ対象のイベントガチャ"),
    "download": ("download", "DL記念ガチャ"),
    "other": ("other", "その他イベントガチャ"),
    "kollabo": ("kollabo", "コラボガチャ"),
}

EVENT_SECTION_OVERRIDES = {
    "DL限定(キャラプレ対象)": "download",
}

EVENT_BLOCK_RE = re.compile(
    r'<h3 class="event-title (?P<gw_id>e\d+)"[^>]*>\s*(?P<abbr>[^<]+?)<a[^>]*>.*?</a>\s*</h3>\s*'
    r'(?:<p>(?P<title_block>.*?)</p>\s*)?'
    r'<ol class="w-checker-group[^"]*">(?P<spirits>.*?)</ol>',
    re.DOTALL,
)
WIZSELE_BLOCK_RE = re.compile(
    r'<h3 id="wizsele"[^>]*>\s*(?P<abbr>[^<]+?)<a[^>]*>.*?</a>\s*</h3>\s*'
    r'<p class="sub-info">(?P<title>[^<]+)</p>\s*'
    r'<ol class="w-checker-group[^"]*">(?P<spirits>.*?)</ol>',
    re.DOTALL,
)
SPIRIT_IMG_RE = re.compile(
    r"data-original='(?P<url>[^']+)'[^>]*alt='(?P<name>[^']*)'",
    re.DOTALL,
)
H2_SPLIT_RE = re.compile(r'<h2 id="([^"]+)">([^<]+)</h2>')
BOLDER_SPAN_RE = re.compile(
    r"<span class=['\"]bolder['\"]>(?P<text>[^<]+)</span>",
    re.DOTALL,
)


def extract_title_from_block(title_block: str | None) -> str:
    if not title_block:
        return ""
    parts = [m.group("text").strip() for m in BOLDER_SPAN_RE.finditer(title_block)]
    return "/".join(part for part in parts if part)


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^\w\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf-]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value[:48] or "item"


def normalize_event_names(abbr: str, title: str) -> tuple[str, str]:
    abbr = (abbr or "").strip()
    title = (title or "").strip()
    if abbr and title:
        return abbr, title
    value = abbr or title
    return value, value


def iter_event_blocks(content: str) -> list[re.Match[str]]:
    blocks: list[re.Match[str]] = []
    for pattern in (EVENT_BLOCK_RE, WIZSELE_BLOCK_RE):
        blocks.extend(pattern.finditer(content))
    blocks.sort(key=lambda match: match.start())
    return blocks


def parse_events(html: str) -> tuple[list[dict], list[dict]]:
    events: list[dict] = []
    issues: list[dict] = []
    seen_abbr: dict[str, str] = {}

    parts = H2_SPLIT_RE.split(html)
    for index in range(1, len(parts), 3):
        sec_key = parts[index]
        sec_title = parts[index + 1].strip()
        content = parts[index + 2]
        if sec_key not in SECTION_MAP:
            issues.append({"type": "unknown_section", "section": sec_key, "title": sec_title})
            continue

        section_id, _ = SECTION_MAP[sec_key]
        sort_order = 0
        for match in iter_event_blocks(content):
            sort_order += 1
            gw_id = match.groupdict().get("gw_id") or "wizsele"
            abbr = match.group("abbr").strip()
            title = extract_title_from_block(match.groupdict().get("title_block"))
            abbr, title = normalize_event_names(abbr, title)
            target_section_id = EVENT_SECTION_OVERRIDES.get(abbr, section_id)
            if gw_id == "wizsele":
                target_section_id = "wizselection"
            spirits = [
                {
                    "name": spirit.group("name").strip(),
                    "image_url": spirit.group("url").strip(),
                }
                for spirit in SPIRIT_IMG_RE.finditer(match.group("spirits"))
            ]

            if not title and not abbr:
                issues.append(
                    {
                        "type": "missing_event_name",
                        "section_id": target_section_id,
                        "spirit_count": len(spirits),
                    }
                )
            if not spirits:
                issues.append(
                    {
                        "type": "missing_spirits",
                        "section_id": target_section_id,
                        "abbr": abbr,
                        "title": title,
                    }
                )
            if abbr in seen_abbr:
                issues.append(
                    {
                        "type": "duplicate_abbr",
                        "abbr": abbr,
                        "first_section": seen_abbr[abbr],
                        "again_section": target_section_id,
                    }
                )
            else:
                seen_abbr[abbr] = target_section_id

            event_id = f"{section_id}-{gw_id}"

            events.append(
                {
                    "id": event_id,
                    "gw_id": gw_id,
                    "section_id": target_section_id,
                    "section_h2": sec_title,
                    "sort_order": sort_order,
                    "abbr": abbr,
                    "title": title,
                    "spirits": spirits,
                }
            )

    return events, issues


def main() -> None:
    html = DEFAULT_SOURCE.read_text(encoding="utf-8")
    events, issues = parse_events(html)
    output = {"events": events, "issues": issues}
    out_path = ROOT / "scripts" / "gamewith-events-preview.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"events={len(events)} issues={len(issues)} -> {out_path}")


if __name__ == "__main__":
    main()
