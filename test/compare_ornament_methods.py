"""Compare gold-mask vs clean-rect vs combined ornament detection."""
from pathlib import Path
import cv2
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "test"))

from prototype_opencv_ornament import (
    build_raw_gold_mask,
    build_frame_mask,
    build_clean_gray,
    build_clean_foreground_mask,
    suppress_neutral_margin,
    find_vertical_ornament_in_band,
    find_ornament_by_clean_rect,
    pick_best_ornament_candidate,
    refine_ornament_top_width,
    is_interior_mostly_white,
    expand_ornament_to_white_edges,
    clamp_ornament_width,
    detect_ornament_opencv,
)


def detect_gold_only(bgr):
    h, w = bgr.shape[:2]
    raw = build_raw_gold_mask(bgr)
    frame = build_frame_mask(raw)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    scan_w = int(w * 0.2)
    y_max = int(h * 0.38)
    suppress_neutral_margin(raw, gray, scan_w)
    suppress_neutral_margin(frame, gray, scan_w)
    ornament = find_vertical_ornament_in_band(frame, scan_w, w, y_max)
    if not ornament:
        ornament = find_vertical_ornament_in_band(raw, scan_w, w, y_max)
    if ornament:
        ornament = refine_ornament_top_width(raw, ornament)
    return ornament


def detect_rect_only(bgr):
    h, w = bgr.shape[:2]
    clean_gray = build_clean_gray(bgr)
    clean_mask = build_clean_foreground_mask(clean_gray)
    scan_w = int(w * 0.2)
    y_max = int(h * 0.38)
    suppress_neutral_margin(clean_mask, clean_gray, scan_w)
    ornament = find_ornament_by_clean_rect(clean_mask, scan_w, w, y_max)
    if ornament:
        ornament = refine_ornament_top_width(clean_mask, ornament)
    return ornament


def detect_white_edges_only(bgr):
    gold = detect_gold_only(bgr)
    if not gold:
        return None
    h, w = bgr.shape[:2]
    clean_gray = build_clean_gray(bgr)
    return clamp_ornament_width(expand_ornament_to_white_edges(clean_gray, gold, w))


def fmt(rect):
    if not rect:
        return "(none)"
    return f"x={rect['x']} y={rect['y']} w={rect['w']} h={rect['h']}"


def main():
    assets = sorted((ROOT / "test-assets").glob("event-header*.png"))
    print(f"{'image':<42} {'gold':<22} {'rect':<22} {'whiteEdge':<22} {'combined':<22}")
    print("-" * 130)
    for path in assets:
        img = cv2.imread(str(path))
        if img is None:
            continue
        h, w = img.shape[:2]
        if "anniversary13-header" in path.name:
            band = img
        else:
            band = img[: int(h * 0.5), :]

        gold = detect_gold_only(band)
        rect = detect_rect_only(band)
        white = detect_white_edges_only(band)
        combined = detect_ornament_opencv(band)

        name = path.name[:40]
        print(f"{name:<42} {fmt(gold):<22} {fmt(rect):<22} {fmt(white):<22} {fmt(combined):<22}")


if __name__ == "__main__":
    main()
