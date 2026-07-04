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

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load()

for y in range(95,200,5):
    row=''
    for x in range(0,100,2):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if is_pillar(r,g,b) or is_gold_frame(r,g,b,lum): ch='#'
        elif lum<120 and sat>0.15: ch='*'
        elif lum>200: ch='o'
        else: ch='.'
    print(f'y={y:3d} {row}')
