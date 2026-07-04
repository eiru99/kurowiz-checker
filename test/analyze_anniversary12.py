from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

def is_pillar(r,g,b):
    return r > 145 and g > 95 and b < 95 and r > g and g > b*1.1

def is_gold(r,g,b,lum):
    if is_pillar(r,g,b): return True
    if r > 120 and g > 70 and b < 100 and r > g and 55 <= lum <= 185: return True
    return r > 90 and g > 50 and b < 65 and r > g and 40 <= lum <= 130

def is_gray(r,g,b,lum,sat):
    return 88 <= lum <= 155 and sat < 0.18 and abs(r-g) < 12 and abs(g-b) < 16

def is_border(r,g,b,lum,sat):
    return is_gold(r,g,b,lum) or is_gray(r,g,b,lum,sat)

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size

y0,y1=95,175
print(f'banner zone y={y0}-{y1}')
for x in range(100):
    flags=[is_border(*px[x,y][:3],*lum_sat(*px[x,y][:3])) for y in range(y0,y1)]
    best=cur=0
    for f in flags:
        if f: cur+=1; best=max(best,cur)
        else: cur=0
    tot=sum(flags)
    if tot>=4:
        ys=[y for y in range(y0,y1) if is_border(*px[x,y][:3],*lum_sat(*px[x,y][:3]))]
        print(f'x={x:3d} maxRun={best:3d} total={tot:3d} ys={min(ys)}-{max(ys)}')

print('\nascii x=0-70')
for y in range(95,176,2):
    row=''
    for x in range(0,70):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if is_gold(r,g,b,lum): ch='G'
        elif is_gray(r,g,b,lum,sat): ch='g'
        elif lum>220: ch='o'
        elif lum<125 and sat>0.2: ch='*'
        else: ch='.'
    if 'G' in row or '*' in row or 'g' in row:
        print(f'y={y:3d} {row}')
