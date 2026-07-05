"""js/spirit-image.js の属性検出ロジックを Python で再現する。"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image

SUB_SAMPLE_SHIFT_RATIO = 0.12
SUB_SAMPLE_SHIFT_MIN = 3


def luminance(r: float, g: float, b: float) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def saturation(r: float, g: float, b: float) -> float:
    max_c = max(r, g, b)
    min_c = min(r, g, b)
    return 0.0 if max_c == 0 else (max_c - min_c) / max_c


def is_attribute_frame_pixel(r: float, g: float, b: float) -> bool:
    sat = saturation(r, g, b)
    lum = luminance(r, g, b)
    if r >= 230 and g >= 230 and b >= 230 and sat < 0.1:
        return True
    return lum > 125 and lum < 225 and sat > 0.12 and sat < 0.55 and r > g and r > b * 0.75


def rgb_to_hue(r: float, g: float, b: float) -> float | None:
    rn, gn, bn = r / 255.0, g / 255.0, b / 255.0
    max_c = max(rn, gn, bn)
    min_c = min(rn, gn, bn)
    d = max_c - min_c
    if d < 0.04:
        return None

    if max_c == rn:
        h = ((gn - bn) / d) % 6
    elif max_c == gn:
        h = (bn - rn) / d + 2
    else:
        h = (rn - gn) / d + 4
    h *= 60
    if h < 0:
        h += 360
    return h


def classify_element_color(rgb: tuple[float, float, float] | None) -> str | None:
    if rgb is None:
        return None

    r, g, b = rgb
    sat = saturation(r, g, b)
    lum = luminance(r, g, b)

    if sat < 0.2 and lum > 165:
        return "光"

    hue = rgb_to_hue(r, g, b)
    if hue is None:
        return "光" if lum > 165 else None

    if hue < 30 or hue >= 330:
        if sat < 0.35 and lum > 155:
            return "光"
        return "火"
    if hue < 75:
        if b >= 72 and g - b < 70 and sat < 0.65:
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
    if hue < 327:
        return "闇"
    return "火"


@dataclass
class CropRect:
    x: int
    y: int
    size: int


def square_crop_rect_for_image(width: int, height: int) -> CropRect:
    size = min(width, height)
    return CropRect(
        x=(width - size) // 2,
        y=(height - size) // 2,
        size=size,
    )


def calc_attribute_sample_regions(crop_rect: CropRect) -> dict:
    emblem_size = max(6, round(crop_rect.size * 0.18))
    offset = max(1, round(crop_rect.size * 0.03))
    emblem_x = crop_rect.x + offset
    emblem_y = crop_rect.y + offset
    half_w = emblem_size // 2
    sub_shift = min(
        max(SUB_SAMPLE_SHIFT_MIN, round(emblem_size * SUB_SAMPLE_SHIFT_RATIO)),
        max(0, emblem_size - half_w - 3),
    )
    sub_x = emblem_x + half_w + sub_shift
    sub_w = max(3, emblem_size - half_w - sub_shift)
    return {
        "main": (emblem_x, emblem_y, half_w, emblem_size),
        "sub": (sub_x, emblem_y, sub_w, emblem_size),
    }


def average_attribute_color(
    pixels: list[tuple[int, int, int]],
    width: int,
    height: int,
    x0: int,
    y0: int,
    w: int,
    h: int,
) -> tuple[float, float, float] | None:
    r_sum = g_sum = b_sum = 0.0
    count = 0
    x_start = max(0, x0)
    y_start = max(0, y0)
    x_end = min(width, x0 + w)
    y_end = min(height, y0 + h)

    for py in range(y_start, y_end):
        for px in range(x_start, x_end):
            r, g, b = pixels[py * width + px]
            if is_attribute_frame_pixel(r, g, b):
                continue
            r_sum += r
            g_sum += g
            b_sum += b
            count += 1

    min_samples = max(2, int(w * h * 0.12))
    if count < min_samples:
        return None
    return (r_sum / count, g_sum / count, b_sum / count)


def load_rgb_pixels(image: Image.Image) -> tuple[list[tuple[int, int, int]], int, int]:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = [rgba.getpixel((x, y))[:3] for y in range(height) for x in range(width)]
    return pixels, width, height


def detect_spirit_attributes_from_image(image: Image.Image) -> dict[str, str | None]:
    pixels, width, height = load_rgb_pixels(image)
    crop_rect = square_crop_rect_for_image(width, height)
    regions = calc_attribute_sample_regions(crop_rect)

    main_color = average_attribute_color(pixels, width, height, *regions["main"])
    sub_color = average_attribute_color(pixels, width, height, *regions["sub"])
    return {
        "main": classify_element_color(main_color),
        "sub": classify_element_color(sub_color),
    }


def detect_spirit_attributes_from_bytes(png_bytes: bytes) -> dict[str, str | None]:
    with Image.open(io.BytesIO(png_bytes)) as image:
        return detect_spirit_attributes_from_image(image)


def normalize_attributes(attrs: dict[str, str | None]) -> tuple[str, str]:
    main = attrs.get("main")
    sub = attrs.get("sub")
    if not main or main == "-":
        raise ValueError("メイン属性を検出できませんでした")
    if not sub or sub == "-":
        sub = main
    return main, sub


if __name__ == "__main__":
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "images" / "spirits"
    targets = sys.argv[1:] or sorted(str(p) for p in root.glob("kamisanpo3-*.png"))
    for target in targets:
        path = Path(target)
        attrs = detect_spirit_attributes_from_bytes(path.read_bytes())
        main, sub = normalize_attributes(attrs)
        print(f"{path.name}: {main}/{sub} raw={attrs}")
