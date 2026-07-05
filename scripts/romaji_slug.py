#!/usr/bin/env python3
"""イベント略称から Storage フォルダ名（ローマ字スラッグ）を生成する。"""

from __future__ import annotations

import re

from pykakasi import kakasi

STORAGE_FOLDER_OVERRIDES: dict[str, str] = {
    "kamisanpo3": "kamisanpo3",
    "charapre-wizsele": "wizselection",
}

_kakasi = kakasi()


def abbr_to_storage_folder(abbr: str, *, event_id: str | None = None) -> str:
    abbr = (abbr or "").strip()
    if not abbr:
        raise ValueError("abbr is empty")

    if event_id and event_id in STORAGE_FOLDER_OVERRIDES:
        return STORAGE_FOLDER_OVERRIDES[event_id]

    romaji = "".join(item["hepburn"] for item in _kakasi.convert(abbr))
    slug = re.sub(r"[^a-z0-9]+", "-", romaji.lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:48] or "event"
