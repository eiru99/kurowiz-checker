"""OpenCV 輪郭検出による精霊切り抜きの CLI テスト。

使い方:
    python test/test-opencv-crop.py test-assets/screenshot.png 200 350
    python test/test-opencv-crop.py test-assets/screenshot.png 200 350 --compare
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

MIN_CROP_SIZE = 16


def luminance(r: float, g: float, b: float) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def saturation(r: float, g: float, b: float) -> float:
    mx, mn = max(r, g, b), min(r, g, b)
    return 0.0 if mx == 0 else (mx - mn) / mx


def is_white_gutter(r: float, g: float, b: float) -> bool:
    sat = saturation(r, g, b)
    return r >= 235 and g >= 235 and b >= 235 and sat < 0.08


def is_gray_screenshot_background(r: float, g: float, b: float) -> bool:
    return luminance(r, g, b) > 158 and saturation(r, g, b) < 0.14


def is_spirit_background(r: float, g: float, b: float) -> bool:
    return is_white_gutter(r, g, b) or is_gray_screenshot_background(r, g, b)


def create_foreground_mask(img: np.ndarray) -> np.ndarray:
    b, g, r = img[:, :, 0].astype(np.float32), img[:, :, 1].astype(np.float32), img[:, :, 2].astype(np.float32)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx == 0, 0, (mx - mn) / mx)
    lum = 0.299 * r + 0.587 * g + 0.114 * b

    white_gutter = (r >= 235) & (g >= 235) & (b >= 235) & (sat < 0.08)
    gray_bg = (lum > 158) & (sat < 0.14)
    foreground = ~(white_gutter | gray_bg)
    return (foreground.astype(np.uint8) * 255)


def find_nearest_foreground(mask: np.ndarray, x: int, y: int) -> tuple[int, int] | None:
    h, w = mask.shape
    cx = int(np.clip(round(x), 0, w - 1))
    cy = int(np.clip(round(y), 0, h - 1))
    if mask[cy, cx] > 0:
        return cx, cy

    max_radius = min(w, h)
    for radius in range(1, max_radius):
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                if abs(dx) != radius and abs(dy) != radius:
                    continue
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] > 0:
                    return nx, ny
    return None


def clamp_square(x: int, y: int, size: int, width: int, height: int) -> dict[str, int] | None:
    clamped_size = int(size)
    if clamped_size <= 0:
        return None

    if x < 0:
        x = 0
    if y < 0:
        y = 0
    if x + clamped_size > width:
        x = width - clamped_size
    if y + clamped_size > height:
        y = height - clamped_size
    if x < 0 or y < 0:
        clamped_size = min(clamped_size, width, height)
        x = max(0, (width - clamped_size) // 2)
        y = max(0, (height - clamped_size) // 2)
    if clamped_size <= 0 or x + clamped_size > width or y + clamped_size > height:
        return None
    return {"x": x, "y": y, "size": clamped_size}


def rect_to_square(x: int, y: int, w: int, h: int, width: int, height: int) -> dict[str, int] | None:
    size = max(w, h)
    cx = x + w / 2
    cy = y + h / 2
    return clamp_square(int(round(cx - size / 2)), int(round(cy - size / 2)), size, width, height)


def detect_spirit_crop_rect_at_click(img: np.ndarray, click_x: float, click_y: float) -> dict[str, int] | None:
    height, width = img.shape[:2]
    raw_mask = create_foreground_mask(img)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    anchor = find_nearest_foreground(mask, click_x, click_y)
    if anchor is None:
        return None

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    ax, ay = anchor

    for contour in contours:
        if cv2.pointPolygonTest(contour, (ax, ay), False) < 0:
            continue
        area = cv2.contourArea(contour)
        x, y, w, h = cv2.boundingRect(contour)
        if w < MIN_CROP_SIZE or h < MIN_CROP_SIZE:
            continue
        if best is None or area < best[0]:
            best = (area, x, y, w, h)

    if best is None:
        return None

    _, x, y, w, h = best
    return rect_to_square(x, y, w, h, width, height)


def compare_with_pixel_logic(image_path: Path, click_x: float, click_y: float) -> None:
    print("pixel logic comparison requires browser / spirit-image.js — OpenCV result only in CLI")


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenCV contour-based spirit crop test")
    parser.add_argument("image", type=Path, help="input image path")
    parser.add_argument("click_x", type=float, help="click X in image coordinates")
    parser.add_argument("click_y", type=float, help="click Y in image coordinates")
    parser.add_argument("--save-mask", type=Path, help="save foreground mask for debugging")
    parser.add_argument("--save-crop", type=Path, help="save cropped result")
    args = parser.parse_args()

    if not args.image.exists():
        print(f"image not found: {args.image}", file=sys.stderr)
        return 1

    img = cv2.imread(str(args.image), cv2.IMREAD_UNCHANGED)
    if img is None:
        print(f"failed to read image: {args.image}", file=sys.stderr)
        return 1
    if img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

    if args.save_mask:
        mask = create_foreground_mask(img)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        cv2.imwrite(str(args.save_mask), closed)
        print(f"saved mask: {args.save_mask}")

    rect = detect_spirit_crop_rect_at_click(img, args.click_x, args.click_y)
    print(f"image: {args.image} ({img.shape[1]}x{img.shape[0]})")
    print(f"click: ({args.click_x}, {args.click_y})")
    print(f"opencv rect: {rect}")

    if rect and args.save_crop:
        crop = img[rect["y"]:rect["y"] + rect["size"], rect["x"]:rect["x"] + rect["size"]]
        resized = cv2.resize(crop, (128, 128), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(args.save_crop), resized)
        print(f"saved crop: {args.save_crop}")

    return 0 if rect else 2


if __name__ == "__main__":
    raise SystemExit(main())
