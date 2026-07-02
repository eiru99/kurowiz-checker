"""属性サンプリング領域を画像に重ねて PNG 出力する。"""
from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent
SAMPLES = BASE / 'samples'
SCALE = 5
FILL_ALPHA = 56  # 約 22% 不透明（元画像が透けて見える）
SUB_SAMPLE_SHIFT_RATIO = 0.12
SUB_SAMPLE_SHIFT_MIN = 3


def calc_regions(crop_rect: dict) -> dict:
    x, y, size = crop_rect['x'], crop_rect['y'], crop_rect['size']
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
        'emblem': {'x': emblem_x, 'y': emblem_y, 'w': emblem_size, 'h': emblem_size},
        'main': {'x': emblem_x, 'y': emblem_y, 'w': half_w, 'h': emblem_size},
        'sub': {'x': sub_x, 'y': emblem_y, 'w': sub_w, 'h': emblem_size},
        'offset': offset,
        'emblem_size': emblem_size,
        'sub_shift': sub_shift,
    }


def square_crop_rect(width: int, height: int) -> dict:
    size = min(width, height)
    return {
        'x': (width - size) // 2,
        'y': (height - size) // 2,
        'size': size,
    }


def region_center(region: dict) -> tuple[float, float]:
    return region['x'] + region['w'] / 2, region['y'] + region['h'] / 2


def draw_dashed_rect(draw: ImageDraw.ImageDraw, box: tuple, outline: str, width: int = 2) -> None:
    x0, y0, x1, y1 = box
    dash, gap = 6, 4
    for x in range(x0, x1, dash + gap):
        draw.line([(x, y0), (min(x + dash, x1), y0)], fill=outline, width=width)
        draw.line([(x, y1), (min(x + dash, x1), y1)], fill=outline, width=width)
    for y in range(y0, y1, dash + gap):
        draw.line([(x0, y), (x0, min(y + dash, y1))], fill=outline, width=width)
        draw.line([(x1, y), (x1, min(y + dash, y1))], fill=outline, width=width)


def draw_point(draw: ImageDraw.ImageDraw, center: tuple[float, float], stroke: str, label: str) -> None:
    px, py = center[0] * SCALE, center[1] * SCALE
    radius = max(2, int(SCALE * 0.75))
    draw.ellipse(
        [px - radius - 2, py - radius - 2, px + radius + 2, py + radius + 2],
        outline=(255, 255, 255, 230),
        width=2,
    )
    draw.ellipse(
        [px - radius, py - radius, px + radius, py + radius],
        outline=stroke,
        width=2,
    )
    draw.line([(px - radius - 3, py), (px + radius + 3, py)], fill=(17, 24, 39, 190), width=1)
    draw.line([(px, py - radius - 3), (px, py + radius + 3)], fill=(17, 24, 39, 190), width=1)
    draw.text((px + radius + 5, py - radius - 2), label, fill='#ffffff')


def render(path: Path) -> dict:
    img = Image.open(path).convert('RGBA')
    width, height = img.size
    crop = square_crop_rect(width, height)
    regions = calc_regions(crop)
    out = img.resize((width * SCALE, height * SCALE), Image.NEAREST)
    draw = ImageDraw.Draw(out, 'RGBA')

    def rect_box(region: dict) -> tuple:
        return (
            region['x'] * SCALE,
            region['y'] * SCALE,
            (region['x'] + region['w']) * SCALE - 1,
            (region['y'] + region['h']) * SCALE - 1,
        )

    draw.rectangle(
        rect_box(regions['main']),
        fill=(34, 197, 94, FILL_ALPHA),
        outline=(22, 163, 74, 220),
        width=2,
    )
    draw.rectangle(
        rect_box(regions['sub']),
        fill=(249, 115, 22, FILL_ALPHA),
        outline=(234, 88, 12, 220),
        width=2,
    )
    draw_dashed_rect(draw, rect_box(regions['emblem']), outline='#3b82f6', width=2)
    draw_point(draw, region_center(regions['main']), '#16a34a', 'M')
    draw_point(draw, region_center(regions['sub']), '#ea580c', 'S')

    out_path = path.with_name(path.stem + '-overlay.png')
    out.save(out_path)
    return {
        'source': path.name,
        'output': out_path.name,
        'size': [width, height],
        'crop': crop,
        'regions': regions,
        'main_center': region_center(regions['main']),
        'sub_center': region_center(regions['sub']),
    }


def main() -> int:
    results = []
    for name in sorted(SAMPLES.glob('sample-*.png')):
        stem = name.stem
        if stem.endswith('-overlay') or stem.endswith('-sampling'):
            continue
        results.append(render(name))

    meta_path = SAMPLES / 'sampling-overlay-meta.json'
    meta_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
    for item in results:
        print(f"{item['source']} -> {item['output']}")
    print(f"meta -> {meta_path.name}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
