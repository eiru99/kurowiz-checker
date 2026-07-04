from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    return 0.299*r+0.587*g+0.114*b

def is_pillar(r,g,b):
    return r > 145 and g > 95 and b < 95 and r > g and g > b*1.1

def is_gold_frame(r,g,b,lum):
    if is_pillar(r,g,b): return True
    if r > 120 and g > 70 and b < 100 and r > g and 55 <= lum <= 185: return True
    return r > 90 and g > 50 and b < 65 and r > g and 40 <= lum <= 130

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size
for y in range(int(h*0.5)):
    for x in range(w):
        r,g,b=px[x,y][:3]; lum=lum_sat(r,g,b)
        if is_pillar(r,g,b) or is_gold_frame(r,g,b,lum):
            print('gold',x,y,(r,g,b))
