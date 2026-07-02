"""OpenCV.js を test/vendor/ にダウンロード（CDN が使えない場合のオフライン用）。"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.1/dist/opencv.js'
OUT = Path(__file__).resolve().parent / 'vendor' / 'opencv.js'


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    print(f'downloading {URL}')
    print(f'       -> {OUT}')
    urllib.request.urlretrieve(URL, OUT)
    size_mb = OUT.stat().st_size / (1024 * 1024)
    print(f'done ({size_mb:.1f} MB)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
