#!/usr/bin/env python3
"""GameWith 年表・コラボ一覧からイベント開催月を推定し SQL を生成する。"""

from __future__ import annotations

import json
import re
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHRONOLOGY_FILE = ROOT / "scripts" / "data" / "gamewith-chronology.txt"

# ガチャ初回開催日（コラボ一覧・公式情報）
COLLAB_OVERRIDES: dict[str, tuple[int, int]] = {
    "kollabo-e281": (2025, 1),   # マジルミエ
    "kollabo-e264": (2024, 4),   # ストリートファイター6
    "kollabo-e185": (2020, 11),  # 銀魂
    "kollabo-e150": (2019, 7),   # とある
    "kollabo-e134": (2018, 11),  # コードギアス
    "kollabo-e126": (2018, 7),   # まどか
    "kollabo-e124": (2018, 6),   # さくら（初回ガチャ）
    "kollabo-e76": (2016, 7),    # 真夏のグレートクイズウォー
    "kollabo-e75": (2016, 7),    # エヴァ2
    "kollabo-e68": (2016, 3),    # マクロス
    "kollabo-e63": (2016, 5),    # グリコ3
    "kollabo-e59": (2015, 12),   # コナン（初回）
    "kollabo-e50": (2015, 7),    # グリコ2
    "kollabo-e48": (2015, 6),    # 高橋留美子
    "kollabo-e44": (2015, 4),    # しょこたん
    "kollabo-e39": (2015, 2),    # エヴァ1
    "kollabo-e38": (2015, 2),    # 白猫
    "kollabo-e35": (2014, 8),    # 進撃の巨人（初回）
    "kollabo-sailormoon": (2015, 1),  # セーラームーン（初回ガチャ）
    "kollabo-e6": (2014, 6),     # 蒼穹のストライカー
    "kollabo-e1": (2014, 5),     # 黒ウィズPRIDE
    "kollabo-e26": (2013, 12),   # 蒼の三国志
}

# 年表に載らない／曖昧なものの手動補正（event_id -> (year, month)）
MANUAL_OVERRIDES: dict[str, tuple[int, int]] = {
    "kamisanpo3": (2026, 5),
    "ロックマンエグゼコラボ-mr8488jz": (2026, 5),
    "recent-e308": (2026, 3),    # 13周年（HEART of ART 同時期）
    "recent-e312": (2026, 4),    # シエオラ
    "recent-e311": (2026, 4),    # クロマグゼロ2
    "recent-e310": (2026, 3),    # オボロ・ダスト
    "recent-e309": (2026, 3),    # グロリアスメモリアル3
    "other-e46": (2016, 3),      # ウィズセレ ラグナロク（3月実装）
    "other-e43": (2015, 3),      # ウィズセレ 双星のアイ
    "charapre-e105": (2017, 10),
    "recent-e286": (2025, 3),
    "recent-e291": (2025, 6),
    "charapre-e133": (2018, 11),
    "charapre-e129": (2018, 10),
    "charapre-e4": (2014, 2),
    "charapre-e30": (2015, 1),
    "charapre-e15": (2015, 8),
    "other-e52": (2015, 9),
    "other-e16": (2014, 7),
    "other-e18": (2013, 12),
    "other-e29": (2013, 6),
    "other-e23": (2013, 8),
    "other-e28": (2013, 10),
    "recent-e261": (2024, 3),
    "other-e12": (2014, 7),
    "ソウルバンカー6-mr84gutc": (2026, 6),
    "サマーコレクション2026-mr84pzee": (2026, 7),
    "recent-e306": (2026, 1),    # 追憶のレディアント2
    "recent-e263": (2024, 4),    # エターナルクロノス4
    "charapre-e101": (2017, 7),  # エターナルクロノス3
    "charapre-e233": (2023, 1),  # サタ女4
    "charapre-e42": (2015, 4),   # エターナルクロノス2
}

# N周年記念 → (2013 + N) 年 3月（7周年=2020/3, 8周年=2021/3, …）
ANNIVERSARY_BASE_YEAR = 2013
ANNIVERSARY_MONTH = 3

GA_FRONT_MONTH = 9
GA_BACK_MONTH = 3


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFKC", text or "").lower()
    value = re.sub(r"[\s\u3000・･/\\&＆'\"''""()（）\[\]【】!?！？:：\-－—〜～・.]", "", value)
    return value


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "kurowiz-checker-script/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_start_date(period: str, default_year: int | None) -> tuple[int, int] | None:
    period = period.strip()
    m = re.search(r"(\d{4})/(\d{1,2})/(\d{1,2})", period)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r"(\d{1,2})/(\d{1,2})", period)
    if m and default_year:
        return default_year, int(m.group(1))
    return None


def parse_chronology(text: str) -> list[tuple[str, int, int]]:
    entries: list[tuple[str, int, int]] = []
    section_year: int | None = None
    rolling_year = 2024
    prev_month = 12

    for line in text.splitlines():
        if "## 最新イベント" in line:
            section_year = 2026
            rolling_year = 2026
            prev_month = 12
            continue
        if m := re.search(r"##\s*(\d{4})年開催のイベント", line):
            section_year = int(m.group(1))
            rolling_year = section_year
            prev_month = 12
            continue
        if "## 2024年以前のイベント" in line:
            section_year = None
            rolling_year = 2024
            prev_month = 12
            continue

        if not line.startswith("|") or "---" in line or "期間" in line:
            continue
        cols = [c.strip() for c in line.strip("|").split("|")]
        if len(cols) < 2:
            continue
        period, name = cols[0], cols[1]
        if not period or not name or period == "期間":
            continue

        if section_year is not None:
            year = section_year
        else:
            m = re.match(r"(\d{1,2})/", period)
            if not m:
                continue
            month = int(m.group(1))
            if month > prev_month and prev_month <= 3:
                rolling_year -= 1
            year = rolling_year
            prev_month = month

        parsed = parse_start_date(period, year)
        if not parsed:
            continue
        y, mo = parsed
        entries.append((name, y, mo))

    return entries


def parse_collab_gacha_dates(text: str) -> list[tuple[str, int, int]]:
    entries: list[tuple[str, int, int]] = []
    for m in re.finditer(
        r"\| 開催期間 \| ([^|]+) \|",
        text,
    ):
        raw = m.group(1)
        first = re.search(r"(\d{4})/(\d{1,2})/(\d{1,2})", raw)
        if first:
            entries.append((raw, int(first.group(1)), int(first.group(2))))
    return entries


def heuristic_from_abbr(abbr: str, title: str) -> tuple[int, int] | None:
    abbr = abbr or ""
    title = title or ""

    if m := re.search(r"正月(\d{4})", abbr):
        return int(m.group(1)), 1
    if m := re.search(r"バレンタイン(\d{4})", abbr):
        return int(m.group(1)), 2
    if m := re.search(r"クリスマス(\d{4})", abbr):
        return int(m.group(1)), 12
    if m := re.search(r"ハロウィン(\d{4})", abbr):
        return int(m.group(1)), 10
    if m := re.search(r"サマーコレクション(\d{4})", abbr):
        return int(m.group(1)), 7
    if m := re.search(r"謹賀新年\s*(\d{4})", title):
        return int(m.group(1)), 1
    if m := re.search(r"Christmas(\d{4})", title, re.I):
        return int(m.group(1)), 12
    if m := re.search(r"St\.Valentine\s*(\d{4})", title, re.I):
        return int(m.group(1)), 2
    if m := re.search(r"Summer Collection\s*(\d{4})", title, re.I):
        return int(m.group(1)), 7
    if m := re.search(r"(\d+)周年", abbr):
        return ANNIVERSARY_BASE_YEAR + int(m.group(1)), ANNIVERSARY_MONTH
    if m := re.search(r"GA(\d{4})前半", abbr):
        return int(m.group(1)), GA_FRONT_MONTH
    if m := re.search(r"GA(\d{4})後半", abbr):
        y = int(m.group(1))
        return y + 1, GA_BACK_MONTH
    if m := re.search(r"ゴールデン(\d{4})", abbr):
        return int(m.group(1)), 5
    if m := re.search(r"GP(\d{4})", abbr):
        return int(m.group(1)), 8
    if m := re.search(r"新人王(\d{4})", abbr):
        return int(m.group(1)), 12
    if "GW限定" in title or "ゴールデン201" in title:
        m = re.search(r"(\d{4})", title)
        if m:
            return int(m.group(1)), 5
    return None


def score_match(event_norm: str, entry_norm: str) -> int:
    if not event_norm or not entry_norm:
        return 0
    if event_norm == entry_norm:
        return 1000
    if event_norm in entry_norm or entry_norm in event_norm:
        return 500 + min(len(event_norm), len(entry_norm))
    # 共有する長い部分文字列
    best = 0
    for length in range(min(len(event_norm), 40), 3, -1):
        for i in range(len(event_norm) - length + 1):
            sub = event_norm[i : i + length]
            if sub in entry_norm:
                best = max(best, length)
                break
        if best:
            break
    return best


def best_chronology_match(
    abbr: str,
    title: str,
    chronology: list[tuple[str, int, int]],
) -> tuple[int, int] | None:
    candidates = [normalize(abbr), normalize(title)]
    # 略称からコラボ等を除いたキーワード
    short = re.sub(r"コラボ\d*$", "", abbr)
    if short:
        candidates.append(normalize(short))

    best: tuple[int, int] | None = None
    best_score = 0
    for name, y, mo in chronology:
        name_norm = normalize(name)
        for cand in candidates:
            s = score_match(cand, name_norm)
            if s > best_score:
                best_score = s
                best = (y, mo)
    return best if best_score >= 8 else None


def load_events_from_supabase(supabase_url: str, supabase_key: str) -> list[dict]:
    url = f"{supabase_url}/rest/v1/catalog_events?select=id,abbr,title,category,held_year,held_month"
    req = urllib.request.Request(
        url,
        headers={"apikey": supabase_key, "Authorization": f"Bearer {supabase_key}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        rows = json.loads(resp.read().decode())
    return [row for row in rows if row.get("category") in ("通常", "コラボ")]


def main() -> None:
    config_text = (ROOT / "js" / "config.js").read_text(encoding="utf-8")
    supabase_url = re.search(r"SUPABASE_URL = '([^']+)'", config_text).group(1)
    supabase_key = re.search(r"SUPABASE_ANON_KEY = '([^']+)'", config_text).group(1)

    print("Loading GameWith chronology...")
    chrono_text = CHRONOLOGY_FILE.read_text(encoding="utf-8")

    chronology = parse_chronology(chrono_text)
    print(f"Parsed {len(chronology)} chronology rows")

    events = load_events_from_supabase(supabase_url, supabase_key)

    updates: list[dict] = []
    unmatched: list[dict] = []

    for event in events:
        eid = event["id"]
        if event.get("held_year") and event.get("held_month"):
            continue

        if eid in MANUAL_OVERRIDES:
            y, mo = MANUAL_OVERRIDES[eid]
            source = "manual"
        elif eid in COLLAB_OVERRIDES:
            y, mo = COLLAB_OVERRIDES[eid]
            source = "collab"
        elif (h := heuristic_from_abbr(event["abbr"], event["title"])) is not None:
            y, mo = h
            source = "heuristic"
        elif (m := best_chronology_match(event["abbr"], event["title"], chronology)) is not None:
            y, mo = m
            source = "chronology"
        else:
            unmatched.append(event)
            continue

        updates.append(
            {
                "id": eid,
                "abbr": event["abbr"],
                "held_year": y,
                "held_month": mo,
                "source": source,
            }
        )

    out_sql = ROOT / "supabase" / "catalog_events_held_month_fill.sql"
    lines = [
        "-- 通常・コラボイベントの開催月一括設定（scripts/fill-held-months.py 生成）",
        "-- Supabase SQL Editor で実行",
        "",
    ]
    for row in updates:
        lines.append(
            f"UPDATE public.catalog_events SET held_year = {row['held_year']}, held_month = {row['held_month']} "
            f"WHERE id = '{row['id']}';"
        )
    out_sql.write_text("\n".join(lines) + "\n", encoding="utf-8")

    report = {
        "updated": len(updates),
        "unmatched": [
            {"id": e["id"], "abbr": e["abbr"], "title": e["title"]} for e in unmatched
        ],
    }
    report_path = ROOT / "scripts" / "held-month-fill-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Updates: {len(updates)}")
    print(f"Unmatched: {len(unmatched)}")
    if unmatched:
        for e in unmatched[:20]:
            print(f"  - {e['abbr']} / {e['title']}")
    print(f"SQL: {out_sql}")
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
