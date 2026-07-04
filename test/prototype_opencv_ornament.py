"""Prototype: OpenCV ornament detection (two-pass + mesh removal)."""

from pathlib import Path

import cv2

import numpy as np



ROOT = Path(__file__).resolve().parents[1]





def build_raw_gold_mask(bgr: np.ndarray) -> np.ndarray:

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    mask_gold = cv2.inRange(hsv, (5, 35, 50), (38, 255, 230))

    b, g, r = cv2.split(bgr)

    rgb = ((r > 88) & (g > 48) & (b < 105) & (r > g) & (g > b)).astype(np.uint8) * 255

    return cv2.bitwise_or(mask_gold, rgb)





def build_clean_gray(bgr: np.ndarray) -> np.ndarray:

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    r, g, b = cv2.split(rgb)

    s = hsv[:, :, 1]

    is_mesh = (

        (gray >= 165) & (gray <= 248) & (s < 45)

        & (np.abs(r.astype(np.int16) - g.astype(np.int16)) < 14)

        & (np.abs(g.astype(np.int16) - b.astype(np.int16)) < 18)

    )

    out = gray.copy()

    out[is_mesh] = 255

    return out





def build_clean_foreground_mask(clean_gray: np.ndarray) -> np.ndarray:

    _, binary = cv2.threshold(clean_gray, 200, 255, cv2.THRESH_BINARY_INV)

    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))

    return cv2.morphologyEx(binary, cv2.MORPH_OPEN, k, iterations=1)





def build_frame_mask(raw: np.ndarray) -> np.ndarray:

    k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))

    mask = cv2.morphologyEx(raw, cv2.MORPH_CLOSE, k, iterations=1)

    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=1)





def suppress_neutral_margin(mask: np.ndarray, gray: np.ndarray, scan_w: int) -> None:

    limit = int(mask.shape[0] * 0.35)

    for x in range(scan_w):

        if (gray[:limit, x] > 200).mean() > 0.75 and mask[:limit, x].mean() < 25:

            mask[:limit, x] = 0





def score_ornament_candidate(ornament: dict | None, image_width: int) -> float:

    if not ornament:

        return -1

    center_x = ornament["x"] + ornament["w"] / 2

    if ornament["x"] > image_width * 0.09 or center_x > image_width * 0.14:

        return -1

    score = min(ornament["w"] * ornament["h"], 1600) - ornament["x"] * 3

    aspect = ornament["h"] / max(ornament["w"], 1)

    if 0.75 <= aspect <= 2.8:

        score += 120

    if 8 <= ornament["w"] <= 52 and 14 <= ornament["h"] <= 110:

        score += 160

    score -= abs(aspect - 1.75) * 10

    return score





def clamp_ornament_width(ornament: dict) -> dict:

    max_w = max(10, min(26, int(ornament.get("h", 24) * 0.85) + 4))

    if ornament["w"] <= max_w:

        return ornament

    return {**ornament, "w": max_w}





def pick_best_ornament_candidate(gold: dict | None, rect: dict | None, image_width: int) -> dict | None:

    gold_score = score_ornament_candidate(gold, image_width)

    rect_score = score_ornament_candidate(rect, image_width)

    if gold_score < 0 and rect_score < 0:

        return None

    if gold_score < 0:

        return dict(rect)

    if rect_score < 0:

        return dict(gold)

    if rect["x"] + 8 < gold["x"] and rect_score >= gold_score - 60:

        return dict(rect)

    if gold["x"] + 8 < rect["x"] and gold_score >= rect_score - 60:

        return dict(gold)

    return dict(rect if rect_score >= gold_score else gold)





def column_white_ratio(gray: np.ndarray, x: int, y0: int, y1: int, threshold: int = 200) -> float:

    if x < 0 or x >= gray.shape[1] or y1 < y0:

        return 1.0

    return float((gray[y0 : y1 + 1, x] >= threshold).mean())





def is_interior_mostly_white(gray: np.ndarray, ornament: dict) -> bool:

    margin_x = max(2, int(ornament["w"] * 0.18))

    ix0 = ornament["x"] + margin_x

    ix1 = ornament["x"] + ornament["w"] - margin_x - 1

    iy0 = ornament["y"] + int(ornament["h"] * 0.12)

    iy1 = ornament["y"] + int(ornament["h"] * 0.88)

    if ix1 <= ix0 or iy1 <= iy0:

        return True

    region = gray[iy0 : iy1 + 1, ix0 : ix1 + 1]

    return float((region >= 200).mean()) > 0.62





def expand_ornament_to_white_edges(gray: np.ndarray, ornament: dict, image_width: int) -> dict:

    y0 = ornament["y"]

    y1 = min(gray.shape[0] - 1, ornament["y"] + ornament["h"] - 1)

    white_threshold = 0.72

    max_expand = max(12, int(ornament["h"] * 0.6))

    max_right = min(gray.shape[1] - 1, int(image_width * 0.16))



    x0 = ornament["x"]

    x1 = ornament["x"] + ornament["w"] - 1



    while x0 > 0 and column_white_ratio(gray, x0 - 1, y0, y1) < white_threshold and ornament["x"] - x0 < max_expand:

        x0 -= 1

    while x0 < x1 and column_white_ratio(gray, x0, y0, y1) >= white_threshold:

        x0 += 1



    while (

        x1 < max_right

        and column_white_ratio(gray, x1 + 1, y0, y1) < white_threshold

        and x1 - ornament["x"] < max_expand + ornament["w"]

    ):

        x1 += 1

    while x1 > x0 and column_white_ratio(gray, x1, y0, y1) >= white_threshold:

        x1 -= 1



    if x1 <= x0:

        return ornament

    return {"x": x0, "y": ornament["y"], "w": x1 - x0 + 1, "h": ornament["h"]}





def expand_line_run(mask, peak_y, peak_avg, scan_left, scan_right, max_run=8):

    y0 = y1 = peak_y

    threshold = max(8, peak_avg * 0.38)

    h = mask.shape[0]

    while y0 > 0 and y1 - y0 < max_run - 1 and mask[y0 - 1, scan_left:scan_right].mean() >= threshold:

        y0 -= 1

    while y1 < h - 1 and y1 - y0 < max_run - 1 and mask[y1 + 1, scan_left:scan_right].mean() >= threshold:

        y1 += 1

    return {"y0": y0, "y1": y1, "centerY": (y0 + y1) / 2}





def refine_ornament_top_width(mask: np.ndarray, ornament: dict) -> dict:

    top_rows = min(6, max(3, int(ornament["w"] * 0.25)))

    min_x = ornament["x"] + ornament["w"]

    max_x = ornament["x"]

    found = False

    for dy in range(top_rows):

        row = ornament["y"] + dy

        if row >= mask.shape[0]:

            break

        col_end = min(mask.shape[1], ornament["x"] + max(ornament["w"], 32) + 4)

        for col in range(max(0, ornament["x"] - 2), col_end):

            if mask[row, col] > 0:

                found = True

                min_x = min(min_x, col)

                max_x = max(max_x, col)

    if not found:

        return ornament

    max_w = max(10, min(26, int(ornament.get("h", 24) * 0.85) + 4))

    w = min(max_w, max_x - min_x + 1)

    return {"x": min_x, "y": ornament["y"], "w": max(8, w), "h": ornament["h"]}





def find_horizontal_extension_line(mask: np.ndarray, w: int, ornament: dict) -> dict | None:

    scan_left = max(ornament["x"] + int(ornament["w"] * 0.15), 8)

    scan_right = int(w * 0.97)

    connect_left = ornament["x"]

    connect_right = ornament["x"] + ornament["w"] + 3

    min_span = max(30, int((scan_right - scan_left) * 0.08))

    y_start = ornament["y"] + max(6, int(ornament["w"] * 0.35))

    y_end = min(mask.shape[0] - 1, ornament["y"] + max(80, int(ornament["w"] * 3.2)))

    best = None



    for y in range(y_start, y_end + 1):

        connect = mask[y, connect_left : connect_right + 1].mean()

        if connect < 12:

            continue

        row = mask[y, scan_left:scan_right]

        nz = np.where(row > 0)[0]

        if len(nz) < 12:

            continue

        span = int(nz[-1] - nz[0])

        if span < min_span:

            continue

        density = float(row.mean()) / 255.0

        if density < 0.006:

            continue

        score = span * (0.35 + density)

        if best is None or score > best[0]:

            best = (score, y, float(row.mean()))



    if best is None:

        return None

    return expand_line_run(mask, best[1], best[2], scan_left, scan_right)





def find_vertical_ornament_in_band(mask: np.ndarray, scan_w: int, w: int, y_max: int) -> dict | None:

    sub = mask[:y_max, :scan_w]

    contours, _ = cv2.findContours(sub, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best = None



    for cnt in contours:

        x, y, cw, ch = cv2.boundingRect(cnt)

        if cw < 5 or ch < 10:

            continue

        if x > w * 0.09:

            continue

        if cw > w * 0.12:

            continue

        aspect = ch / max(cw, 1)

        if aspect < 0.5 or aspect > 3.5:

            continue

        score = cw * ch - x * 2.5

        if 0.75 <= aspect <= 2.8:

            score += 100

        if best is None or score > best[0]:

            best = (score, x, y, cw, ch)



    if best is None:

        return None



    _, x, y, cw, ch = best

    return clamp_ornament_width({"x": int(x), "y": int(y), "w": int(cw), "h": int(ch)})





def find_ornament_by_clean_rect(clean_mask: np.ndarray, scan_w: int, w: int, y_max: int) -> dict | None:

    sub = clean_mask[:y_max, :scan_w]

    k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 5))

    closed = cv2.morphologyEx(sub, cv2.MORPH_CLOSE, k, iterations=1)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best = None

    best_score = -1.0



    for cnt in contours:

        x, y, cw, ch = cv2.boundingRect(cnt)

        if cw < 6 or ch < 12:

            continue

        if x > w * 0.09:

            continue

        if cw > w * 0.14:

            continue

        aspect = ch / max(cw, 1)

        if aspect < 0.55 or aspect > 3.2:

            continue

        candidate = {"x": int(x), "y": int(y), "w": int(cw), "h": int(ch)}

        score = score_ornament_candidate(candidate, w)

        if score > best_score:

            best_score = score

            best = candidate



    if best is None:

        return None

    return clamp_ornament_width(best)





def detect_ornament_opencv(bgr: np.ndarray) -> dict | None:

    h, w = bgr.shape[:2]

    raw = build_raw_gold_mask(bgr)

    frame = build_frame_mask(raw)

    clean_gray = build_clean_gray(bgr)

    clean_mask = build_clean_foreground_mask(clean_gray)

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    scan_w = int(w * 0.2)

    y_max = int(h * 0.38)

    suppress_neutral_margin(raw, gray, scan_w)

    suppress_neutral_margin(frame, gray, scan_w)

    suppress_neutral_margin(clean_mask, clean_gray, scan_w)



    gold = find_vertical_ornament_in_band(frame, scan_w, w, y_max)

    if not gold:

        gold = find_vertical_ornament_in_band(raw, scan_w, w, y_max)

    rect = find_ornament_by_clean_rect(clean_mask, scan_w, w, y_max)

    ornament = pick_best_ornament_candidate(gold, rect, w)

    if not ornament:

        return None



    ornament = refine_ornament_top_width(raw, ornament)

    extension_line = find_horizontal_extension_line(raw, w, dict(ornament))

    ornament = refine_ornament_top_width(clean_mask, ornament)



    if is_interior_mostly_white(clean_gray, ornament):

        relocated = find_ornament_by_clean_rect(clean_mask, scan_w, w, y_max)

        if not relocated:

            relocated = gold

        if relocated and score_ornament_candidate(relocated, w) >= score_ornament_candidate(ornament, w) - 40:

            ornament = relocated

            ornament = refine_ornament_top_width(raw, ornament)

            ornament = refine_ornament_top_width(clean_mask, ornament)

            extension_line = find_horizontal_extension_line(raw, w, dict(ornament))



    ornament = expand_ornament_to_white_edges(clean_gray, ornament, w)

    ornament = clamp_ornament_width(ornament)



    if extension_line:

        ornament["h"] = max(8, int(extension_line["y1"]) - ornament["y"] + 1)

        ornament["extension_line"] = extension_line



    return ornament





if __name__ == "__main__":

    for name in [

        "event-header-glorious-memorial.png",

        "event-header-valentine2026.png",

        "event-header-kuromaguzero2.png",

        "event-header-anniversary13-header.png",

    ]:

        path = ROOT / "test-assets" / name

        img = cv2.imread(str(path))

        if img is None:

            continue

        h, w = img.shape[:2]

        band = img if "anniversary13-header" in name else img[: int(h * 0.5), :]

        result = detect_ornament_opencv(band)

        print(f"{name}: {result}")


