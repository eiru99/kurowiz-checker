from pathlib import Path
from PIL import Image

def lum_sat(r,g,b):
    lum = 0.299*r+0.587*g+0.114*b
    mx,mn=max(r,g,b),min(r,g,b)
    sat = 0 if mx==0 else (mx-mn)/mx
    return lum,sat

def is_pillar(r,g,b):
    return r > 145 and g > 95 and b < 95 and r > g and g > b*1.1

def is_gold(r,g,b,lum):
    if is_pillar(r,g,b): return True
    if r > 120 and g > 70 and b < 100 and r > g and 55 <= lum <= 185: return True
    return r > 90 and g > 50 and b < 65 and r > g and 40 <= lum <= 130

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
px=img.load(); w,h=img.size

for y in range(105,200,3):
    row=''
    for x in range(0,80):
        r,g,b=px[x,y][:3]; lum,sat=lum_sat(r,g,b)
        if is_pillar(r,g,b): ch='P'
        elif is_gold(r,g,b,lum): ch='G'
        elif lum>240: ch='o'
        elif lum<130 and sat>0.25: ch='*'
        else: ch='.'
    if any(c in row for c in 'PG*'):
        print(f'y={y:3d} {row}')

# gold bbox in banner
pts=[]
for y in range(100,200):
    for x in range(0,80):
        r,g,b=px[x,y][:3]; lum,_=lum_sat(r,g,b)
        if is_gold(r,g,b,lum): pts.append((x,y))
if pts:
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    print('gold bbox',min(xs),min(ys),max(xs)-min(xs)+1,max(ys)-min(ys)+1,'count',len(pts))

# per column max gold run y=100-200
print('\ncols with gold run>=6 in y=100-200:')
for x in range(80):
    flags=[is_gold(*px[x,y][:3],lum_sat(*px[x,y][:3])[0]) for y in range(100,200)]
    best=cur=0
    for f in flags:
        if f: cur+=1; best=max(best,cur)
        else: cur=0
    if best>=6: print(f' x={x} maxRun={best} total={sum(flags)}')
