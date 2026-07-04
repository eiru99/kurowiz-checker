from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

def is_pillar(r,g,b):
    return r > 145 and g > 95 and b < 95 and r > g and g > b*1.1

def is_gold_frame(r,g,b,lum):
    if is_pillar(r,g,b): return True
    if r > 120 and g > 70 and b < 100 and r > g and 55 <= lum <= 185: return True
    return r > 90 and g > 50 and b < 65 and r > g and 40 <= lum <= 130

def is_interior(r,g,b,lum,sat):
    return lum >= 172 and lum <= 255 and sat < 0.24 and r >= 165 and g >= 165 and b >= 155

def max_run(flags):
    best=cur=0
    for f in flags:
        if f: cur+=1; best=max(best,cur)
        else: cur=0
    return best

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size
print('size',w,h)
scan_w=min(w,int(w*0.2)); scan_h=min(h,int(h*0.35))
min_frame=max(8,int(scan_h*0.12))
print('scan',scan_w,scan_h,'min_frame',min_frame)
for x in range(min(80,scan_w)):
    flags=[is_gold_frame(*px[x,y][:3], lum_sat(*px[x,y][:3])[0]) for y in range(scan_h)]
    mr=max_run(flags)
    if mr>=6:
        print(f'x={x:3d} maxRun={mr:3d} total={sum(flags):3d}')

print('\ngrid top-left 60x80')
for y in range(0,80,4):
    row=''
    for x in range(0,60,2):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if is_pillar(r,g,b): ch='#'
        elif is_gold_frame(r,g,b,lum): ch='+'
        elif is_interior(r,g,b,lum,sat): ch='o'
        elif lum<130: ch='*'
        else: ch='.'
    print(f'y={y:2d} {row}')
