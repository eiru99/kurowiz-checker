#!/usr/bin/env python3
"""開催月の怪しいマッチ（略称・続編・年表あいまい一致）を洗い出す。"""

from __future__ import annotations

import importlib.util
import json
import re
import unicodedata
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


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFKC", text or "").lower()
    value = re.sub(r"[\s\u3000・･/\\&＆'\"''""()（）\[\]【】!?！？:：\-－—〜～・.]", "", value)
    return value


def load_events() -> list[dict]:
    url = (
        f"{SUPABASE_URL}/rest/v1/catalog_events"
        "?select=id,abbr,title,section_id,held_year,held_month,category"
        "&order=held_year.asc.nullslast,held_month.asc.nullslast"
    )
    req = urllib.request.Request(
        url,
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def best_chrono_with_name(abbr: str, title: str) -> tuple[str, int, int, int] | None:
    candidates = [normalize(abbr), normalize(title)]
    short = re.sub(r"コラボ\d*$", "", abbr)
    if short:
        candidates.append(normalize(short))

    best_name = ""
    best = None
    best_score = 0
    for name, y, mo in CHRONOLOGY:
        name_norm = normalize(name)
        for cand in candidates:
            s = _fill.score_match(cand, name_norm)
            if s > best_score:
                best_score = s
                best_name = name
                best = (y, mo)
    if best is None or best_score < 8:
        return None
    return best_name, best[0], best[1], best_score


def sequel_token(text: str) -> str | None:
    n = normalize(text)
    for pat in [r"(\d+)$", r"(\d+)周年", r"ep(\d+)", r"episode(\d+)", r"ⅳ|ⅳ|ⅳ"]:
        if m := re.search(pat, n):
            return m.group(0)
    if "2" in n and ("レディアント2" in text or "radiant2" in n):
        return "2"
    return None


def title_year(text: str) -> int | None:
    m = re.search(r"(20\d{2})", text or "")
    return int(m.group(1)) if m else None


def main() -> None:
    events = [e for e in load_events() if e.get("category") in ("通常", "コラボ") or e["section_id"] in ("recent", "kollabo", "charapre")]
    suspicious: list[dict] = []

    chrono_by_norm = {normalize(n): (n, y, mo) for n, y, mo in CHRONOLOGY}

    for e in events:
        reasons: list[str] = []
        match = best_chrono_with_name(e["abbr"], e["title"])
        hy, hm = e.get("held_year"), e.get("held_month")

        if match:
            ch_name, cy, cm, score = match
            if hy and hm and (hy != cy or hm != cm):
                reasons.append(f"年表最良一致「{ch_name}」は {cy}/{cm:02d}（score={score}）だが DB は {hy}/{hm:02d}")

            # 続編番号の食い違い
            abbr_seq = re.search(r"(\d+)$", e["abbr"] or "")
            chrono_seq = re.search(r"(\d+)$", ch_name)
            if abbr_seq and chrono_seq and abbr_seq.group(1) != chrono_seq.group(1):
                reasons.append(f"略称末尾 {abbr_seq.group(1)} vs 年表名末尾 {chrono_seq.group(1)}")
            elif abbr_seq and not chrono_seq and int(abbr_seq.group(1)) >= 2:
                # 略称に2以上があるのに年表側に番号なし
                base = normalize(re.sub(r"\d+$", "", e["abbr"]))
                if base and base in normalize(ch_name) and normalize(ch_name) == base:
                    reasons.append("続編略称が初回イベント名にマッチしている可能性")

            # タイトルに番号/続編があるのに年表が初回
            if "2" in (e["abbr"] or "") and "2" not in ch_name and "Ⅱ" not in ch_name and "2" not in normalize(ch_name):
                if normalize(ch_name) in normalize(e["title"]) or normalize(ch_name) in normalize(e["abbr"]):
                    reasons.append("続編が初回イベントの年表にマッチしている可能性")

        ty = title_year(e["title"]) or title_year(e["abbr"])
        if ty and hy and abs(ty - hy) > 1:
            reasons.append(f"名称内の年 {ty} と DB 年 {hy} が大きく乖離")

        # 略称と年表で別候補が競合
        if match:
            ch_name, cy, cm, _ = match
            alt_hits = []
            for n, y, mo in CHRONOLOGY:
                nn = normalize(n)
                an = normalize(e["abbr"])
                tn = normalize(e["title"])
                if (an in nn or nn in an or tn in nn or nn in tn) and (y, mo) != (cy, cm):
                    alt_hits.append((n, y, mo))
            if alt_hits:
                for alt_name, ay, amo in alt_hits[:3]:
                    if hy == ay and hm == amo and (cy, cm) != (hy, hm):
                        reasons.append(f"DBは別候補「{alt_name}」{ay}/{amo:02d}と一致、最良スコアは「{ch_name}」{cy}/{cm:02d}")

        if reasons:
            suspicious.append({**e, "chrono_match": match, "reasons": reasons})

    out = ROOT / "scripts" / "held-month-audit.json"
    out.write_text(
        json.dumps({"suspicious": suspicious, "total": len(events)}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {out} ({len(suspicious)} suspicious / {len(events)} events)")


if __name__ == "__main__":
    main()
