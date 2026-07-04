from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    return lum

def is_pillar(r,g,b):
    return r > 145 and g > 95 and b < 95 and r > g and g > b*1.1

def is_gold_frame(r,g,b,lum):
    if is_pillar(r,g,b): return True
    if r > 120 and g > 70 and b < 100 and r > g and 55 <= lum <= 185: return True
    return r > 90 and g > 50 and b < 65 and r > g and 40 <= lum <= 130

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size
band_h=int(h*0.5)
pts=[]
for y in range(min(band_h,200)):
    for x in range(int(w*0.2)):
        r,g,b=px[x,y][:3]; lum=lum_sat(r,g,b)
        if is_gold_frame(r,g,b,lum): pts.append((x,y))
print('gold pts',len(pts))
if pts:
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    print('bbox',min(xs),min(ys),max(xs)-min(xs)+1,max(ys)-min(ys)+1)
    from collections import Counter
    print('cols', Counter(xs).most_common(10))

# gray border detection - columns with consistent gray left border
def is_gray_border(r,g,b,lum,sat):
    return 100 <= lum <= 145 and sat < 0.12 and abs(r-g)<8 and abs(g-b)<12

for x in range(30):
    count=sum(1 for y in range(80) if is_gray_border(*px[x,y][:3], *lum_sat(*px[x,y][:3]), 0))
    if count>20: print('gray col',x,count)
