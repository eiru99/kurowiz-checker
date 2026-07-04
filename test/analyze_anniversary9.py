from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

def is_border(r,g,b,lum,sat):
    if r > 145 and g > 95 and b < 95 and r > g and g > b*1.1: return True
    if r > 120 and g > 70 and b < 100 and r > g and 55 <= lum <= 185: return True
    if r > 90 and g > 50 and b < 65 and r > g and 40 <= lum <= 130: return True
    if 88 <= lum <= 155 and sat < 0.18 and abs(r-g)<12 and abs(g-b)<16: return True
    if 55 <= lum <= 115 and r > g and g >= b and sat < 0.35 and r > 70: return True
    return False

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size

pts=[]
for y in range(int(h*0.5)):
    for x in range(int(w*0.25)):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if is_border(r,g,b,lum,sat): pts.append((x,y))
print('border pts',len(pts))
if pts:
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    print('bbox',min(xs),min(ys),max(xs)-min(xs)+1,max(ys)-min(ys)+1)

# per-column max run in title area y=90-200
for x in range(60):
    flags=[is_border(*px[x,y][:3],*lum_sat(*px[x,y][:3])) for y in range(90,200)]
    from functools import reduce
    mr=0; c=0; best=0
    for f in flags:
        if f: c+=1; mr+=1; best=max(best,mr)
        else: mr=0
    if best>=6: print('col',x,'maxRun',best,'total',sum(flags))
