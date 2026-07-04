from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

def is_gray_border(r,g,b,lum,sat):
    return 88 <= lum <= 155 and sat < 0.18 and abs(r-g) < 12 and abs(g-b) < 16

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size
band_h=int(h*0.5); scan_h=min(band_h,int(band_h*0.35))
print('band',band_h,'scan_h',scan_h)

for x in range(20):
    flags=[is_gray_border(*px[x,y][:3],*lum_sat(*px[x,y][:3])) for y in range(scan_h)]
    best=cur=0
    for f in flags:
        if f: cur+=1; best=max(best,cur)
        else: cur=0
    if best>=6 or sum(flags)>0:
        ys=[y for y in range(scan_h) if flags[y]]
        print(f'x={x:2d} maxRun={best:3d} total={sum(flags):3d} yrange={min(ys) if ys else "-"}-{max(ys) if ys else "-"}')

# find banner panel: white interior bordered region near text
def is_interior(r,g,b,lum,sat):
    return lum >= 172 and lum <= 255 and sat < 0.24 and r >= 165 and g >= 165 and b >= 155

# scan for compact ornament: left border column with SHORT run (not full height margin)
print('\nshort border runs (6-50) in x=8-80 y=80-220:')
for x in range(8,80):
    flags=[is_gray_border(*px[x,y][:3],*lum_sat(*px[x,y][:3])) for y in range(80,220)]
    best=cur=0
    for f in flags:
        if f: cur+=1; best=max(best,cur)
        else: cur=0
    if 6 <= best <= 55:
        print(f'  x={x} maxRun={best}')

# sample pixels at suspected ornament area
for y in [100,110,120,130,140,150]:
    row=''
    for x in range(8,60,2):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if is_gray_border(r,g,b,lum,sat): ch='#'
        elif lum>220: ch='o'
        elif lum<120 and sat>0.2: ch='*'
        else: ch='.'
    print(f'y={y} {row}')
