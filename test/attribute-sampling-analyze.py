"""Temporary analysis: spirit attribute color detection (ports js/spirit-image.js)."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

REPO = Path(r"C:\Users\mishi_rn2lh85\Documents\GitHub_kurowiz\kurowiz-checker")
SAMPLES = REPO / "test" / "samples"

SUB_SAMPLE_SHIFT_RATIO = 0.12
SUB_SAMPLE_SHIFT_MIN = 3

ELEMENTS = ("火", "水", "雷", "光", "闇")

CASES = [
    ("sample-light-thunder.png", "光", "光"),
    ("sample-thunder-dark.png", "雷", "闇"),
    ("sample-water-light.png", "水", "光"),
    ("sample-fire-dark.png", "火", "闇"),
    ("sample-fire-light.png", "火", "光"),
    ("sample-thunder-water.png", "雷", "水"),
]


def luminance(r: float, g: float, b: float) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def saturation(r: float, g: float, b: float) -> float:
    mx, mn = max(r, g, b), min(r, g, b)
    return 0.0 if mx == 0 else (mx - mn) / mx


def is_attribute_frame_pixel(r: float, g: float, b: float) -> bool:
    sat = saturation(r, g, b)
    lum = luminance(r, g, b)
    if r >= 230 and g >= 230 and b >= 230 and sat < 0.1:
        return True
    return (
        lum > 125
        and lum < 225
        and sat > 0.12
        and sat < 0.55
        and r > g
        and r > b * 0.75
    )


def rgb_to_hue(r: float, g: float, b: float, gray_delta: float = 0.04) -> float | None:
    rn, gn, bn = r / 255.0, g / 255.0, b / 255.0
    mx, mn = max(rn, gn, bn), min(rn, gn, bn)
    d = mx - mn
    if d < gray_delta:
        return None
    if mx == rn:
        h = ((gn - bn) / d) % 6
    elif mx == gn:
        h = (bn - rn) / d + 2
    else:
        h = (rn - gn) / d + 4
    h *= 60.0
    if h < 0:
        h += 360.0
    return h


@dataclass(frozen=True)
class ClassifyThresholds:
    light_sat_max: float = 0.2
    light_lum_min: float = 165.0
    gray_delta: float = 0.04
    hue_fire_low: float = 30.0
    hue_thunder: float = 75.0
    hue_green_band: float = 155.0
    hue_water: float = 255.0
    hue_dark: float = 327.0
    gold_light_b_min: float = 72.0
    gold_light_sat_max: float = 0.65
    rgb_diff: float = 20.0


def classify_element_color(rgb: dict | None, t: ClassifyThresholds = ClassifyThresholds()) -> str | None:
    if not rgb:
        return None
    r, g, b = rgb["r"], rgb["g"], rgb["b"]
    sat = saturation(r, g, b)
    lum = luminance(r, g, b)
    if sat < t.light_sat_max and lum > t.light_lum_min:
        return "光"
    hue = rgb_to_hue(r, g, b, t.gray_delta)
    if hue is None:
        return "光" if lum > t.light_lum_min else None
    if hue < t.hue_fire_low or hue >= 360 - (360 - t.hue_fire_low):
        # match JS: hue < 30 || hue >= 330
        if hue < t.hue_fire_low or hue >= 360 - t.hue_fire_low:
            return "火"
    # Fix: JS uses hue >= 330 for fire - use explicit 330 when defaults
    if hue < 30 or hue >= 330:
        if sat < 0.35 and lum > 155:
            return "光"
        return "火"
    if hue < 75:
        if b >= t.gold_light_b_min and sat < t.gold_light_sat_max:
            return "光"
        return "雷"
    if hue < 155:
        if b > r + 20:
            return "水"
        if r > b + 20:
            return "火"
        return "雷"
    if hue < 255:
        return "水"
    if hue < t.hue_dark:
        return "闇"
    return "火"


def classify_element_color_param(rgb: dict | None, t: ClassifyThresholds) -> str | None:
    if not rgb:
        return None
    r, g, b = rgb["r"], rgb["g"], rgb["b"]
    sat = saturation(r, g, b)
    lum = luminance(r, g, b)
    if sat < t.light_sat_max and lum > t.light_lum_min:
        return "光"
    hue = rgb_to_hue(r, g, b, t.gray_delta)
    if hue is None:
        return "光" if lum > t.light_lum_min else None
    h_fire_hi = 360 - t.hue_fire_low  # 330 when low=30
    if hue < t.hue_fire_low or hue >= h_fire_hi:
        if sat < 0.35 and lum > 155:
            return "光"
        return "火"
    if hue < t.hue_thunder:
        if b >= t.gold_light_b_min and sat < t.gold_light_sat_max:
            return "光"
        return "雷"
    if hue < t.hue_green_band:
        if b > r + t.rgb_diff:
            return "水"
        if r > b + t.rgb_diff:
            return "火"
        return "雷"
    if hue < t.hue_water:
        return "水"
    if hue < t.hue_dark:
        return "闇"
    return "火"


def average_attribute_color(px, width: int, height: int, x0: int, y0: int, w: int, h: int):
    r_sum = g_sum = b_sum = 0.0
    count = 0
    frame = 0
    x_start = max(0, x0)
    y_start = max(0, y0)
    x_end = min(width, x0 + w)
    y_end = min(height, y0 + h)
    for py in range(y_start, y_end):
        for px_x in range(x_start, x_end):
            r, g, b, _ = px[px_x, py]
            if is_attribute_frame_pixel(r, g, b):
                frame += 1
                continue
            r_sum += r
            g_sum += g
            b_sum += b
            count += 1
    min_samples = max(2, math.floor(w * h * 0.12))
    if count < min_samples:
        return None, {"count": count, "frame": frame, "min_samples": min_samples}
    rgb = {"r": r_sum / count, "g": g_sum / count, "b": b_sum / count}
    return rgb, {"count": count, "frame": frame, "min_samples": min_samples}


def calc_attribute_sample_regions(crop_rect: dict):
    x, y, size = crop_rect["x"], crop_rect["y"], crop_rect["size"]
    emblem_size = max(6, round(size * 0.18))
    offset = max(1, round(size * 0.03))
    emblem_x = x + offset
    emblem_y = y + offset
    half_w = emblem_size // 2
    sub_shift = min(
        max(SUB_SAMPLE_SHIFT_MIN, round(emblem_size * SUB_SAMPLE_SHIFT_RATIO)),
        max(0, emblem_size - half_w - 3),
    )
    sub_x = emblem_x + half_w + sub_shift
    sub_w = max(3, emblem_size - half_w - sub_shift)
    return {
        "emblem": {"x": emblem_x, "y": emblem_y, "w": emblem_size, "h": emblem_size},
        "main": {"x": emblem_x, "y": emblem_y, "w": half_w, "h": emblem_size},
        "sub": {"x": sub_x, "y": emblem_y, "w": sub_w, "h": emblem_size},
        "offset": offset,
        "emblemSize": emblem_size,
        "subShift": sub_shift,
    }


def square_crop_rect_for_image(width: int, height: int):
    size = min(width, height)
    return {"x": (width - size) // 2, "y": (height - size) // 2, "size": size}


def describe_rgb(rgb: dict):
    r, g, b = rgb["r"], rgb["g"], rgb["b"]
    return {
        "rgb": [round(r, 2), round(g, 2), round(b, 2)],
        "hue": None if rgb_to_hue(r, g, b) is None else round(rgb_to_hue(r, g, b), 2),
        "saturation": round(saturation(r, g, b), 4),
        "luminance": round(luminance(r, g, b), 2),
    }


def analyze_image(path: Path, exp_main: str, exp_sub: str):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    px = img.load()
    crop = square_crop_rect_for_image(w, h)
    regions = calc_attribute_sample_regions(crop)
    out = {
        "file": path.name,
        "imageSize": [w, h],
        "cropRect": crop,
        "regions": regions,
        "expected": {"main": exp_main, "sub": exp_sub},
    }
    for key in ("main", "sub"):
        reg = regions[key]
        rgb, stats = average_attribute_color(px, w, h, reg["x"], reg["y"], reg["w"], reg["h"])
        actual = classify_element_color_param(rgb, ClassifyThresholds())
        entry = {
            "rect": reg,
            "stats": stats,
            "color": describe_rgb(rgb) if rgb else None,
            "actual": actual,
            "match": actual == out["expected"][key],
        }
        out[key] = entry
    return out


def collect_all_colors():
    rows = []
    for fname, em, es in CASES:
        path = SAMPLES / fname
        if not path.exists():
            continue
        res = analyze_image(path, em, es)
        for region in ("main", "sub"):
            c = res[region]["color"]
            if not c:
                continue
            rows.append(
                {
                    "file": fname,
                    "region": region,
                    "expected": res["expected"][region],
                    "actual": res[region]["actual"],
                    **c,
                }
            )
    return rows


def score_thresholds(t: ClassifyThresholds, dataset):
    ok = 0
    for row in dataset:
        rgb = {"r": row["rgb"][0], "g": row["rgb"][1], "b": row["rgb"][2]}
        pred = classify_element_color_param(rgb, t)
        if pred == row["expected"]:
            ok += 1
    return ok


def sweep_thresholds(dataset):
    best = []
    base = ClassifyThresholds()
    # grid over key knobs
    for light_lum in range(140, 186, 5):
        for light_sat in [0.12, 0.15, 0.18, 0.2, 0.22, 0.25, 0.28, 0.32]:
            for gray_d in [0.02, 0.03, 0.04, 0.05, 0.06, 0.08]:
                for hue_th in [65, 70, 75, 80, 85]:
                    for hue_gr in [145, 150, 155, 160, 165]:
                        for rgb_d in [10, 15, 20, 25, 30]:
                            t = ClassifyThresholds(
                                light_sat_max=light_sat,
                                light_lum_min=float(light_lum),
                                gray_delta=gray_d,
                                hue_thunder=float(hue_th),
                                hue_green_band=float(hue_gr),
                                rgb_diff=float(rgb_d),
                            )
                            s = score_thresholds(t, dataset)
                            if s == len(dataset):
                                best.append(t)
    # dedupe-ish: keep unique param tuples
    seen = set()
    uniq = []
    for t in best:
        key = (
            t.light_sat_max,
            t.light_lum_min,
            t.gray_delta,
            t.hue_thunder,
            t.hue_green_band,
            t.rgb_diff,
        )
        if key not in seen:
            seen.add(key)
            uniq.append(t)
    return uniq


def main():
    results = []
    for fname, em, es in CASES:
        path = SAMPLES / fname
        if not path.exists():
            print(f"MISSING {path}")
            continue
        results.append(analyze_image(path, em, es))

    print("=== Per-image results (current thresholds) ===")
    for r in results:
        print(f"\n{r['file:///file'] if False else r['file']}  {r['imageSize'][0]}x{r['imageSize'][1]}")
        print(f"  crop: {r['cropRect']}")
        print(f"  emblemSize={r['regions']['emblemSize']} subShift={r['regions']['subShift']}")
        for region in ("main", "sub"):
            e = r[region]
            exp = r["expected"][region]
            print(
                f"  {region}: expected={exp} actual={e['actual']} match={e['match']} "
                f"rect={e['rect']} samples={e['stats']}"
            )
            if e["color"]:
                print(f"         {e['color']}")

    dataset = collect_all_colors()
    print("\n=== Flat color table ===")
    for row in dataset:
        print(row)

    current_score = score_thresholds(ClassifyThresholds(), dataset)
    print(f"\nCurrent thresholds: {current_score}/{len(dataset)} regions correct")

    print("\n=== Threshold sweep (searching all-8 correct) ===")
    good = sweep_thresholds(dataset)
    print(f"Found {len(good)} parameter sets that classify all {len(dataset)} regions")
    for i, t in enumerate(good[:15]):
        print(
            f"  #{i+1} light_sat_max={t.light_sat_max} light_lum_min={t.light_lum_min} "
            f"gray_delta={t.gray_delta} hue_thunder={t.hue_thunder} "
            f"hue_green_band={t.hue_green_band} rgb_diff={t.rgb_diff}"
        )
    if good:
        t0 = good[0]
        print("\n=== Predictions with first matching threshold set ===")
        for row in dataset:
            rgb = {"r": row["rgb"][0], "g": row["rgb"][1], "b": row["rgb"][2]}
            pred = classify_element_color_param(rgb, t0)
            print(f"  {row['file']} {row['region']}: exp={row['expected']} pred={pred} hue={row['hue']}")

    out_path = REPO / "test" / "attribute-sampling-analyze-output.json"
    out_path.write_text(json.dumps({"results": results, "dataset": dataset, "matchingThresholds": [t.__dict__ for t in good[:30]]}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
