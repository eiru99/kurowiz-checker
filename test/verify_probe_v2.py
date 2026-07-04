"""Verify improved probe logic against test assets."""
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

def is_interior(r,g,b,lum,sat):
    return lum >= 172 and lum <= 255 and sat < 0.24 and r >= 165 and g >= 165 and b >= 155

def is_neutral_margin(r,g,b,lum,sat):
    return lum >= 95 and lum <= 142 and sat < 0.14 and abs(r-g) < 10 and abs(g-b) < 10 and not is_gold(r,g,b,lum)

def is_header_text(r,g,b,lum,sat):
    if is_pillar(r,g,b): return False
    if lum > 152: return False
    if lum < 112: return True
    if lum > 120 and sat < 0.16: return False
    return lum < 125 and sat > 0.24

def max_col_run(pred, x, y0, y1, px):
    best=cur=0
    for y in range(y0,y1+1):
        if pred(px[x,y][:3]): cur+=1; best=max(best,cur)
        else: cur=0
    return best

def probe(px,w,h):
    scan_w=min(w,int(w*0.2)); scan_h=min(h,int(h*0.35))
    ys,ye=0,scan_h-1; span=ye-ys+1
    min_frame=max(8,int(scan_h*0.12))
    cols=[]
    for x in range(scan_w):
        neutral=max_col_run(lambda rgb: is_neutral_margin(*rgb,*lum_sat(*rgb)), x, ys, ye, px)
        if neutral>=span*0.68: continue
        frame=max_col_run(lambda rgb: is_gold(*rgb,lum_sat(*rgb)[0]), x, ys, ye, px)
        if frame>=min_frame: cols.append(x)
    if not cols: return None
    clusters=[[cols[0]]]
    for x in cols[1:]:
        if x<=clusters[-1][-1]+8: clusters[-1].append(x)
        else: clusters.append([x])
    best=None; best_s=-1
    for cl in clusters:
        y0=ye+1; y1=ys
        for x in cl:
            for y in range(ys,ye+1):
                r,g,b=px[x,y][:3]; lum=lum_sat(r,g,b)[0]
                if is_pillar(r,g,b):
                    y0=min(y0,y)
        if y0>ye:
            for x in cl:
                for y in range(ys,ye+1):
                    if is_gold(*px[x,y][:3],lum_sat(*px[x,y][:3])[0]):
                        y0=min(y0,y)
        if y0>ye: continue
        y1=ys
        for x in cl:
            for y in range(ys,ye+1):
                if is_pillar(*px[x,y][:3]):
                    y1=max(y1,y)
        if y1<y0:
            for x in cl:
                for y in range(ys,ye+1):
                    if is_gold(*px[x,y][:3],lum_sat(*px[x,y][:3])[0]):
                        y1=max(y1,y)
        if y1<y0: continue
        bh=y1-y0+1; fr=cl[0]
        for x in range(cl[0], min(scan_w, cl[0]+24)):
            sc=sum(1 for y in range(y0,y1+1) if is_pillar(*px[x,y][:3]))
            if sc>=3: fr=x
        x0=cl[0]; max_left=max(0, cl[0]-int(bh*1.1))
        while x0>max_left:
            ic=sum(1 for y in range(y0,y1+1) if is_interior(*px[x0-1,y][:3],*lum_sat(*px[x0-1,y][:3])))
            if ic>=bh*0.55: x0-=1
            else: break
        ow=fr-x0+1; oh=y1-y0+1
        mw=max(10,min(22,int(oh*0.85)+4))
        if ow>mw: ow=mw
        if oh>ow*2.2: oh=min(ye-y0+1,int(ow*2.15))
        if ow<2 or oh<8: continue
        cx=x0+ow/2
        if x0>w*0.055 or cx>w*0.12: continue
        score=min(ow*oh,1600)-x0*1.5
        if score>best_s: best_s=score; best=dict(x=x0,y=y0,w=ow,h=oh)
    return best

def valid(r,w,h):
    return r and r['w']>=8 and r['h']>=12 and r['w']*r['h']>=96 and r['x']<=w*0.055 and r['x']+r['w']<=w*0.18

root=Path(__file__).resolve().parents[1]/'test-assets'
for name in ['event-header-valentine2026.png','event-header-glorious-memorial.png','event-header-kuromaguzero2.png','event-header-anniversary13-header.png']:
    p=root/name
    if not p.exists(): continue
    img=Image.open(p); w,h=img.size
    if 'anniversary' not in name:
        img=img.crop((0,0,w,int(h*0.5))); w,h=img.size
    px=img.load()
    r=probe(px,w,h)
    print(f'{name}: probe={r} valid={valid(r,w,h)}')
