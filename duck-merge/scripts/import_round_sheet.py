"""Split a 5x2 concept sheet and retain each closed duck silhouette as RGBA."""
import sys
from collections import deque
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
sheet = Image.open(sys.argv[1]).convert('RGBA')
for tier in range(10):
    col, row = tier % 5, tier // 5
    x0, x1 = round(col * sheet.width / 5), round((col + 1) * sheet.width / 5)
    y0, y1 = round(row * sheet.height / 2), round((row + 1) * sheet.height / 2)
    im = sheet.crop((x0, y0, x1, y1))
    px, w, h = im.load(), im.width, im.height
    outside, todo = set(), deque()

    def visit(x, y):
        if not (0 <= x < w and 0 <= y < h) or (x, y) in outside:
            return
        r, g, b, _ = px[x, y]
        if min(r, g, b) >= 140 and max(r, g, b) - min(r, g, b) <= 40:
            outside.add((x, y)); todo.append((x, y))

    for x in range(w):
        visit(x, 0); visit(x, h - 1)
    for y in range(h):
        visit(0, y); visit(w - 1, y)
    while todo:
        x, y = todo.popleft()
        visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1)
    for x, y in outside:
        r, g, b, _ = px[x, y]; px[x, y] = (r, g, b, 0)

    # The duck is the largest remaining connected component; checker remnants vanish.
    seen, largest = set(), []
    for yy in range(h):
        for xx in range(w):
            if (xx, yy) in seen or px[xx, yy][3] == 0:
                continue
            part, queue = [], deque([(xx, yy)]); seen.add((xx, yy))
            while queue:
                x, y = queue.popleft(); part.append((x, y))
                for nx, ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and px[nx, ny][3] > 0:
                        seen.add((nx, ny)); queue.append((nx, ny))
            if len(part) > len(largest): largest = part
    keep = set(largest)
    for x, y in seen - keep:
        r, g, b, _ = px[x, y]; px[x, y] = (r, g, b, 0)
    im = im.crop(im.getchannel('A').getbbox())
    im.thumbnail((244, 244), Image.Resampling.LANCZOS)
    sprite = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    sprite.alpha_composite(im, ((256-im.width)//2, (256-im.height)//2))
    sprite.save(root / f'assets/duck-{tier+1}.png', optimize=True)
