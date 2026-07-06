#!/usr/bin/env python3
"""続編・番号付きイベントで初回シリーズに誤マッチした開催月を検出。"""

from __future__ import annotations

import importlib.util
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("fill_held_months", ROOT / "scripts" / "fill-held-months.py")
_fill = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fill)

CONFIG = (ROOT / "js" / "config.js").read_text(encoding="utf-8")
SUPABASE_URL = re.search(r"SUPABASE_URL = '([^']+)'", CONFIG).group(1)
SUPABASE_KEY = re.search(r"SUPABASE_ANON_KEY = '([^']+)'", CONFIG).group(1)
CHRONOLOGY = _fill.parse_chronology(
    (ROOT / "scripts" / "data" / "gamewith-chronology.txt").read_text(encoding="utf-8")
)


def load_events() -> list[dict]:
    url = (
        f"{SUPABASE_URL}/rest/v1/catalog_events"
        "?select=id,abbr,title,section_id,held_year,held_month,category"
    )
    req = urllib.request.Request(
        url,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def roman_to_int(s: str) -> int | None:
    mapping = {"ⅰ": 1, "ⅱ": 2, "ⅲ": 3, "ⅳ": 4, "ⅴ": 5, "ⅵ": 6, "ⅶ": 7, "ⅷ": 8, "ⅸ": 9, "ⅹ": 10}
    s = s.lower()
    if s in mapping:
        return mapping[s]
    if s.isdigit():
        return int(s)
    return None


def extract_seq(text: str) -> int | None:
    text = text or ""
    if m := re.search(r"(\d+)\s*$", text):
        return int(m.group(1))
    if m := re.search(r"([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)\s*$", text):
        return roman_to_int(m.group(1).lower())
    if m := re.search(r"ep(?:isode)?\s*([ⅡⅢⅣⅤⅥⅦⅧⅨⅩ\d]+)", text, re.I):
        return roman_to_int(m.group(1).lower()) or (int(m.group(1)) if m.group(1).isdigit() else None)
    return None


def find_chrono_entries(abbr: str, title: str) -> list[dict]:
    hits = []
    for name, y, mo in CHRONOLOGY:
        nn = _fill.normalize(name)
        for cand in [_fill.normalize(abbr), _fill.normalize(title)]:
            if not cand:
                continue
            if cand in nn or nn in cand:
                hits.append({"name": name, "year": y, "month": mo, "score": _fill.score_match(cand, nn)})
    hits.sort(key=lambda h: -h["score"])
    # dedupe by name
    seen = set()
    out = []
    for h in hits:
        if h["name"] in seen:
            continue
        seen.add(h["name"])
        out.append(h)
    return out


def main() -> None:
    events = [e for e in load_events() if e.get("category") in ("通常", "コラボ")]
    issues = []

    for e in events:
        abbr_seq = extract_seq(e["abbr"])
        title_seq = extract_seq(e["title"])
        seq = abbr_seq or title_seq
        hits = find_chrono_entries(e["abbr"], e["title"])
        hy, hm = e.get("held_year"), e.get("held_month")

        # 続編なのに DB が初回シリーズの年月と一致
        if seq and seq >= 2 and hits:
            for h in hits:
                h_seq = extract_seq(h["name"])
                if h_seq is None and hy == h["year"] and hm == h["month"]:
                    better = [x for x in hits if extract_seq(x["name"]) == seq]
                    issues.append(
                        {
                            "id": e["id"],
                            "abbr": e["abbr"],
                            "title": e["title"],
                            "db": f"{hy}/{hm:02d}",
                            "wrong_match": h["name"],
                            "suggested": better[0] if better else None,
                            "reason": f"続編(番号{seq})が初回「{h['name']}」の開催月にマッチ",
                        }
                    )
                    break

        # 続編の年表エントリがあり DB と不一致
        if seq and seq >= 2:
            seq_hits = [h for h in hits if extract_seq(h["name"]) == seq]
            if seq_hits and hy and hm:
                sh = seq_hits[0]
                if hy != sh["year"] or hm != sh["month"]:
                    issues.append(
                        {
                            "id": e["id"],
                            "abbr": e["abbr"],
                            "title": e["title"],
                            "db": f"{hy}/{hm:02d}",
                            "chrono": f"{sh['year']}/{sh['month']:02d}",
                            "chrono_name": sh["name"],
                            "reason": "続編の年表エントリと DB が不一致",
                        }
                    )

    # dedupe by id+reason
    seen = set()
    unique = []
    for item in issues:
        key = (item["id"], item.get("reason", ""))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)

    out = ROOT / "scripts" / "held-month-sequel-issues.json"
    out.write_text(json.dumps(unique, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(unique)} issues to {out}")


if __name__ == "__main__":
    main()
