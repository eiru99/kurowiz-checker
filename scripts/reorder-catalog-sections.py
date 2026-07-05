#!/usr/bin/env python3
"""spirits.json のセクション配置を正規化する。"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPIRITS_JSON = ROOT / "data" / "spirits.json"

DOWNLOAD_DL_CHARAPRE_EVENT_ID = "charapre-e97"
WIZSELECTION_EVENT_ID = "charapre-wizsele"
WIZSELECTION_SECTION = {
    "id": "wizselection",
    "title": "プラチナ/ウィズセレクション",
}
CATALOG_SECTION_ORDER = [
    "latest",
    "recent",
    "charapre",
    "other",
    "kollabo",
    "download",
    "wizselection",
]


def pop_event(sections: list[dict], event_id: str) -> dict | None:
    for section in sections:
        events = section.get("events", [])
        for index, event in enumerate(events):
            if event.get("id") == event_id:
                return events.pop(index)
    return None


def reorder_sections(sections: list[dict]) -> list[dict]:
    by_id = {section["id"]: section for section in sections}
    ordered: list[dict] = []
    used: set[str] = set()

    for section_id in CATALOG_SECTION_ORDER:
        section = by_id.get(section_id)
        if section is not None:
            ordered.append(section)
            used.add(section_id)

    for section in sections:
        if section["id"] not in used:
            ordered.append(section)

    return ordered


def normalize_catalog(catalog: dict) -> dict:
    sections = [
        {**section, "events": list(section.get("events", []))}
        for section in catalog.get("sections", [])
    ]

    dl_charapre_event = pop_event(sections, DOWNLOAD_DL_CHARAPRE_EVENT_ID)
    wizsele_event = pop_event(sections, WIZSELECTION_EVENT_ID)

    if dl_charapre_event:
        download_section = next((section for section in sections if section["id"] == "download"), None)
        if download_section is not None:
            download_section["events"].insert(0, dl_charapre_event)

    if wizsele_event:
        wiz_section = next((section for section in sections if section["id"] == WIZSELECTION_SECTION["id"]), None)
        if wiz_section is None:
            wiz_section = {**WIZSELECTION_SECTION, "events": []}
            sections.append(wiz_section)
        wiz_section["events"].append(wizsele_event)

    return {**catalog, "sections": reorder_sections(sections)}


def main() -> None:
    catalog = json.loads(SPIRITS_JSON.read_text(encoding="utf-8"))
    normalized = normalize_catalog(catalog)
    SPIRITS_JSON.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {SPIRITS_JSON}")
    print("Section order:", [section["id"] for section in normalized["sections"]])


if __name__ == "__main__":
    main()
