from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load()

for y in range(108,195,4):
    row=''
    for x in range(0,72):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if lum<60: ch='#'
        elif lum<100 and sat>0.15: ch='b'
        elif 100<=lum<=150 and sat<0.2: ch='g'
        elif lum>230: ch='o'
        elif sat>0.3: ch='*'
        else: ch='.'
    print(f'y={y:3d} {row}')

print('\nSample left pillar pixels:')
for y in [115,125,135,145,155,165,175]:
    for x in [8,12,16,20,24,28,32,36,40]:
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        print(f'  ({x},{y}) rgb=({r},{g},{b}) lum={lum:.0f} sat={sat:.2f}')
