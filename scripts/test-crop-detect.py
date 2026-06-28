"""切り抜き検出の簡易検証（spirit-image.js と同じ判定ロジック）"""
from PIL import Image
import sys

def lum(r, g, b):
    return 0.299 * r + 0.587 * g + 0.114 * b

def sat(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    return 0 if mx == 0 else (mx - mn) / mx

def is_bg(r, g, b):
    l, s = lum(r, g, b), sat(r, g, b)
    if l > 238: return True
    if l > 158 and s < 0.14: return True
    return False

def find_by_projection(px, rx, ry, rw, rh, row_t=0.07, col_t=0.07):
    x_end, y_end = rx + rw, ry + rh
    top = bottom = left = right = -1
    for y in range(ry, y_end):
        c = sum(1 for x in range(rx, x_end) if not is_bg(*px[x, y][:3]))
        if c / rw >= row_t:
            if top < 0: top = y
            bottom = y
    if top < 0: return None
    band = bottom - top + 1
    for x in range(rx, x_end):
        c = sum(1 for y in range(top, bottom + 1) if not is_bg(*px[x, y][:3]))
        if c / band >= col_t:
            if left < 0: left = x
            right = x
    if left < 0: return None
    return left, top, right, bottom

path = sys.argv[1] if len(sys.argv) > 1 else r"test-assets/screenshot.png"
img = Image.open(path).convert("RGBA")
w, h = img.size
px = img.load()

# 2番目のアイコン付近を囲んだ想定（画像幅のおおよそ 22%~48%, 縦 55%~95%）
rx = int(w * 0.20)
ry = int(h * 0.52)
rw = int(w * 0.30)
rh = int(h * 0.42)

rect = find_by_projection(px, rx, ry, rw, rh)
print(f"image {w}x{h} region {rx},{ry},{rw},{rh}")
print(f"projection rect: {rect}")
if rect:
    l, t, r, b = rect
    bw, bh = r - l + 1, b - t + 1
    size = max(bw, bh)
    cx, cy = (l + r) / 2, (t + b) / 2
    print(f"square size={size} center=({cx:.0f},{cy:.0f}) aspect={bw/bh:.2f}")
