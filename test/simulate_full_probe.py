"""Full layout + probe simulation for anniversary image."""
from pathlib import Path
from PIL import Image
import numpy as np

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

def is_interior(r,g,b,lum,sat):
    return lum >= 172 and lum <= 255 and sat < 0.24 and r >= 165 and g >= 165 and b >= 155

def max_column_run(pred, w, x, y0, y1, data):
    best=cur=0
    for y in range(y0,y1+1):
        if pred(x,y): cur+=1; best=max(best,cur)
        else: cur=0
    return best

def probe(data, w, h, separator_y=None):
    scan_w = min(w, int(w*0.2))
    scan_h = min(h, int(h*0.35))
    min_frame = max(8, int(scan_h*0.12))
    is_strict = lambda x,y: is_pillar(*data[y,x][:3])
    is_frame = lambda x,y: is_gold_frame(*data[y,x][:3], lum_sat(*data[y,x][:3])[0])
    is_int = lambda x,y: is_interior(*data[y,x][:3], *lum_sat(*data[y,x][:3]))
    
    frame_cols=[]
    for x in range(scan_w):
        mr=max_column_run(is_frame,w,x,0,scan_h-1,data)
        if mr>=min_frame: frame_cols.append(x)
    print(f'probe scan {scan_w}x{scan_h} min_frame={min_frame} cols={frame_cols[:15]}')
    if not frame_cols: return None
    
    cluster=[frame_cols[0]]
    for x in frame_cols[1:]:
        if x<=cluster[-1]+8: cluster.append(x)
        else: break
    
    y0=scan_h
    for x in cluster:
        for y in range(scan_h):
            if is_strict(x,y): y0=min(y0,y)
    if y0>=scan_h:
        for x in cluster:
            for y in range(scan_h):
                if is_frame(x,y): y0=min(y0,y)
    
    y1 = max(y0+7, separator_y-2) if separator_y is not None else min(scan_h-1, y0+max(24,int(scan_h*0.22)))
    if separator_y is None:
        for x in cluster:
            for y in range(scan_h):
                if is_strict(x,y): y1=max(y1,y)
    
    frame_left=cluster[0]
    frame_right=frame_left
    for x in range(frame_left, min(scan_w, frame_left+16)):
        gc=sum(1 for y in range(y0,y1+1) if is_strict(x,y))
        if gc>=3: frame_right=x
    
    x0=frame_left
    bh=y1-y0+1
    while x0>0:
        ic=sum(1 for y in range(y0,y1+1) if is_int(x0-1,y))
        if ic>=bh*0.55: x0-=1
        else: break
    
    ow=frame_right-x0+1
    oh=y1-y0+1
    max_w=max(10,min(22,int(oh*0.85)+4))
    if ow>max_w:
        frame_right=x0+max_w-1; ow=max_w
    if oh>ow*2.6:
        y1=min(scan_h-1,y0+int(ow*2.2)); oh=y1-y0+1
    return dict(x=x0,y=y0,w=ow,h=oh)

img=Image.open(Path(__file__).resolve().parents[1]/'test-assets/event-header-anniversary13.png')
w,h=img.size
band_h=int(h*0.5)
arr=np.array(img.crop((0,0,w,band_h)))
bh,bw=arr.shape[:2]
print('band',bw,bh)
r=probe(arr,bw,bh)
print('probe result',r)
valid = r and r['w']>=5 and r['h']>=8
print('valid',valid)
