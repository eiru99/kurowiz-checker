from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

def is_gray_border(r,g,b,lum,sat):
    return 95 <= lum <= 148 and sat < 0.14 and abs(r-g) < 10 and abs(g-b) < 14

def is_interior(r,g,b,lum,sat):
    return lum >= 172 and lum <= 255 and sat < 0.24 and r >= 165 and g >= 165 and b >= 155

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size
band_h=int(h*0.5)

# gray columns in top 200 rows
for x in range(25):
    gray_run=0; best=0; interior=0
    y0=y1=-1
    for y in range(200):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if is_gray_border(r,g,b,lum,sat):
            gray_run+=1; best+=1
            if y0<0: y0=y
            y1=y
        else:
            pass
        if is_interior(r,g,b,lum,sat): interior+=1
    if best>=15:
        print(f'x={x:2d} gray={best:3d} interior={interior:3d} y={y0}-{y1}')

# find right edge of white block in title row
for y in [45,50,55,60,65,70,80,90,100]:
    for x in range(80):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if lum<130 and sat>0.1:
            print(f'text y={y} starts ~x={x} rgb=({r},{g},{b})')
            break
