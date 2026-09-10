"""Bake the game's existing neutral-matte atlas renderer into static RGBA assets.
No art regeneration; source atlas is retained. Requires Pillow.
"""
from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / 'assets/ducks.webp').convert('RGBA')
for tier in range(8):
    col, row = tier % 4, tier // 4
    im = source.crop((round(col*source.width/4), round(row*source.height/2),
                      round((col+1)*source.width/4), round((row+1)*source.height/2)))
    w, h = im.size
    px = im.load()
    seen = set()
    q = deque()
    def push(x, y):
        if not (0 <= x < w and 0 <= y < h) or (x, y) in seen:
            return
        r, g, b, a = px[x, y]
        if a < 32 or (min(r,g,b) > 145 and max(r,g,b)-min(r,g,b) < 36):
            seen.add((x,y)); q.append((x,y))
    for x in range(w):
        push(x,0); push(x,h-1)
    for y in range(h):
        push(0,y); push(w-1,y)
    while q:
        x,y=q.popleft();r,g,b,a=px[x,y];px[x,y]=(r,g,b,0)
        push(x-1,y);push(x+1,y);push(x,y-1);push(x,y+1)
    # Remove disconnected matte flecks outside the duck's closed outline.
    visited=set();largest=[]
    for yy in range(h):
        for xx in range(w):
            if (xx,yy) in visited or px[xx,yy][3]==0: continue
            component=[];todo=deque([(xx,yy)]);visited.add((xx,yy))
            while todo:
                x,y=todo.popleft();component.append((x,y))
                for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                    if 0<=nx<w and 0<=ny<h and (nx,ny) not in visited and px[nx,ny][3]>0:
                        visited.add((nx,ny));todo.append((nx,ny))
            if len(component)>len(largest): largest=component
    keep=set(largest)
    for x,y in visited-keep:
        r,g,b,a=px[x,y];px[x,y]=(r,g,b,0)
    bounds=im.getchannel('A').getbbox()
    assert bounds, 'Empty sprite'
    im=im.crop(bounds)
    # Every runtime sprite uses the same square coordinate system. Padding,
    # instead of resizing width and height independently, preserves roundness.
    im.thumbnail((244,244),Image.Resampling.LANCZOS)
    sprite=Image.new('RGBA',(256,256),(0,0,0,0))
    sprite.alpha_composite(im,((256-im.width)//2,(256-im.height)//2))
    sprite.save(ROOT / f'assets/duck-{tier+1}.png',optimize=True)
    print(tier+1,sprite.size,im.size)
