from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

def is_text(r,g,b,lum,sat):
    if lum>152: return False
    if lum<112: return True
    if lum>120 and sat<0.16: return False
    return lum<125 and sat>0.24

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size

# find abbr text band
for y in range(80,200):
    c=sum(1 for x in range(w) if is_text(*px[x,y][:3],*lum_sat(*px[x,y][:3])))
    if c>15: print('text row',y,c)

print('\nrows 100-160 cols 0-80')
def is_pillar(r,g,b):
    return r > 145 and g > 95 and b < 95 and r > g and g > b*1.1

for y in range(100,165,3):
    row=''
    for x in range(0,80,2):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if is_pillar(r,g,b): ch='#'
        elif lum<125 and sat>0.2: ch='*'
        elif lum>220: ch='o'
        elif 100<=lum<=145 and sat<0.1: ch='|'
        else: ch='.'
    if '#' in row or '*' in row: print(f'y={y:3d} {row}')
