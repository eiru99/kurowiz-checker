"""Simulate probeDecorativeOrnamentRect on test images."""
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

def is_gray_border(r,g,b,lum,sat):
    return 88 <= lum <= 155 and sat < 0.18 and abs(r-g) < 12 and abs(g-b) < 16

def is_brown_border(r,g,b,lum,sat):
    return 55 <= lum <= 115 and r > g and g >= b and sat < 0.35 and r > 70

def is_ornament_border(r,g,b,lum,sat):
    return is_gold_frame(r,g,b,lum) or is_gray_border(r,g,b,lum,sat) or is_brown_border(r,g,b,lum,sat)

def is_interior(r,g,b,lum,sat):
    return lum >= 172 and lum <= 255 and sat < 0.24 and r >= 165 and g >= 165 and b >= 155

def max_column_run(flags):
    best=cur=0
    for f in flags:
        if f: cur+=1; best=max(best,cur)
        else: cur=0
    return best

def probe(data_fn, w, h, use_border=False, separator_y=None):
    scan_w = min(w, int(w*0.2))
    scan_h = min(h, int(h*0.35))
    min_frame = max(8, int(scan_h*0.12))
    is_frame = is_ornament_border if use_border else lambda r,g,b,lum,sat: is_gold_frame(r,g,b,lum)
    is_strict = lambda r,g,b,lum,sat: is_pillar(r,g,b)
    
    frame_cols=[]
    for x in range(scan_w):
        flags=[is_frame(*data_fn(x,y)) for y in range(scan_h)]
        mr=max_column_run(flags)
        if mr >= min_frame:
            frame_cols.append((x,mr,sum(flags)))
    if not frame_cols:
        return None, scan_w, scan_h, min_frame, frame_cols
    
    cluster=[frame_cols[0][0]]
    for x,mr,tot in frame_cols[1:]:
        if x <= cluster[-1]+8: cluster.append(x)
        else: break
    
    y0=scan_h
    for x in cluster:
        for y in range(scan_h):
            if is_strict(*data_fn(x,y)):
                y0=min(y0,y)
    if y0>=scan_h:
        for x in cluster:
            for y in range(scan_h):
                if is_frame(*data_fn(x,y)):
                    y0=min(y0,y)
    
    y1 = max(y0+7, separator_y-2) if separator_y is not None else min(scan_h-1, y0+max(24,int(scan_h*0.22)))
    if separator_y is None:
        for x in cluster:
            for y in range(scan_h):
                if is_strict(*data_fn(x,y)):
                    y1=max(y1,y)
    
    frame_left=cluster[0]
    frame_right=frame_left
    for x in range(frame_left, min(scan_w, frame_left+16)):
        gc=sum(1 for y in range(y0,y1+1) if is_strict(*data_fn(x,y)))
        if gc>=3: frame_right=x
    
    x0=frame_left
    bh=y1-y0+1
    while x0>0:
        ic=sum(1 for y in range(y0,y1+1) if is_interior(*data_fn(x0-1,y)))
        if ic>=bh*0.55: x0-=1
        else: break
    
    ow=frame_right-x0+1
    oh=y1-y0+1
    max_w=max(10,min(22,int(oh*0.85)+4))
    if ow>max_w:
        frame_right=x0+max_w-1
        ow=max_w
    if oh>ow*2.6:
        y1=min(scan_h-1,y0+int(ow*2.2))
        oh=y1-y0+1
    return dict(x=x0,y=y0,w=ow,h=oh), scan_w, scan_h, min_frame, frame_cols[:12]

def load_band(path):
    img=Image.open(path)
    w,h=img.size
    band_h=int(h*0.5)
    crop=img.crop((0,0,w,band_h))
    px=crop.load(); cw,ch=crop.size
    def data_fn(x,y):
        r,g,b=px[x,y][:3]; return r,g,b,*lum_sat(r,g,b)
    return data_fn, cw, ch, w, h

root=Path(__file__).resolve().parents[1]/'test-assets'
for name in ['event-header-anniversary13.png','event-header-valentine2026.png','event-header-glorious-memorial.png','event-header-kuromaguzero2.png']:
    p=root/name
    if not p.exists(): continue
    data_fn,cw,ch,iw,ih=load_band(p)
    for mode in ['gold','border']:
        r=probe(data_fn,cw,ch,use_border=(mode=='border'))
        print(f'\n{name} [{mode}] img={iw}x{ih} band={cw}x{ch}')
        if r[0]: print('  rect',r[0],'scan',r[1],r[2],'min_frame',r[3])
        else: print('  null min_frame',r[3],'cols',r[4][:5] if r[4] else [])
