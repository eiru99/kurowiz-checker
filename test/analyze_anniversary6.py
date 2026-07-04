from pathlib import Path
from PIL import Image

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size

# row density of non-gray-white (text-ish)
def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

for y in range(0,250,5):
    dark=sum(1 for x in range(w) if lum_sat(*px[x,y][:3])[0]<125 and lum_sat(*px[x,y][:3])[1]>0.12)
    if dark>10: print(f'y={y:3d} dark={dark:4d} ({dark/w:.2%})')
