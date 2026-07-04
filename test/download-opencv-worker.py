"""OpenCV.js Worker 版を vendor/ にダウンロード（オフライン用）。"""
from __future__ import annotations

import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT.parent / 'vendor' / 'opencv-worker'
BASE = 'https://cdn.jsdelivr.net/npm/@opencvjs/worker@4.13.0-release.1/lib'
FILES = ('index.js', 'opencv_js.js')


def main() -> int:
    VENDOR.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        url = f'{BASE}/{name}'
        out = VENDOR / name
        print(f'downloading {url}')
        print(f'       -> {out}')
        urllib.request.urlretrieve(url, out)
        size_mb = out.stat().st_size / (1024 * 1024)
        print(f'done ({size_mb:.1f} MB)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
