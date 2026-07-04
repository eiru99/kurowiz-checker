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

def max_run(flags):
    best=cur=0
    for f in flags:
        if f: cur+=1; best=max(best,cur)
        else: cur=0
    return best

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size
band_h=int(h*0.5); scan_w=min(w,int(w*0.2)); scan_h=min(band_h,int(band_h*0.35))
min_frame=max(8,int(scan_h*0.12))
print('min_frame',min_frame)
for x in range(scan_w):
    flags=[is_gold_frame(*px[x,y][:3], lum_sat(*px[x,y][:3])) for y in range(scan_h)]
    mr=max_run(flags); tot=sum(flags)
    if tot>0: print(x,mr,tot)
