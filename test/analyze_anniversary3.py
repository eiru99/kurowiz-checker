from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size

for y in [5,10,15,20,25,30,35,40,45,50,55,60]:
    print(f'y={y}')
    for x in [0,2,4,6,8,10,12,14,16,18,20,25,30,40,50]:
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        print(f'  x={x:2d} rgb=({r:3d},{g:3d},{b:3d}) lum={lum:5.1f} sat={sat:.2f}')

print('\nunique colors top-left 30x60')
from collections import Counter
c=Counter()
for y in range(60):
    for x in range(40):
        r,g,b=px[x,y][:3]
        c[(r//8*8,g//8*8,b//8*8)]+=1
for col,n in c.most_common(15):
    print(n, col)
