#!/usr/bin/env python3
"""sample-frames.py — pull evenly-spaced frames from a video into one montage
   image for quick on-camera presence review (posture / eye-contact / expression).
   Usage: python sample-frames.py <video> [out.jpg]   Env: EVERY=<seconds> (default 8)
"""
import av, sys, os
from PIL import Image, ImageDraw

path = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/frames.jpg'
N = float(os.environ.get('EVERY', '8'))

container = av.open(path)
v = container.streams.video[0]
dur = float(v.duration * v.time_base) if v.duration else 150.0
rot = 0
try:
    r = v.metadata.get('rotate')
    if r:
        rot = int(r) % 360
except Exception:
    pass

times, t = [], 1.0
while t < dur:
    times.append(t); t += N

frames = []
for tt in times:
    try:
        container.seek(int(tt / v.time_base), stream=v)
    except Exception:
        pass
    got = None
    for frame in container.decode(v):
        got = frame; break
    if got is None:
        continue
    img = got.to_image()
    if rot == 90:
        img = img.transpose(Image.ROTATE_270)
    elif rot == 180:
        img = img.transpose(Image.ROTATE_180)
    elif rot == 270:
        img = img.transpose(Image.ROTATE_90)
    frames.append((tt, img))

if not frames:
    print("no frames"); sys.exit(1)

cols, tw, cap = 4, 340, 26
tiles = []
for tt, img in frames:
    w, h = img.size
    th = int(h * tw / w)
    im2 = img.resize((tw, th))
    canvas = Image.new('RGB', (tw, th + cap), (18, 22, 30))
    canvas.paste(im2, (0, cap))
    d = ImageDraw.Draw(canvas)
    d.text((6, 6), f"{int(tt//60)}:{int(tt%60):02d}", fill=(255, 235, 120))
    tiles.append(canvas)

cw, ch = tiles[0].width, tiles[0].height
rows = (len(tiles) + cols - 1) // cols
mont = Image.new('RGB', (cols * cw, rows * ch), (0, 0, 0))
for i, im in enumerate(tiles):
    mont.paste(im, ((i % cols) * cw, (i // cols) * ch))
# cap final width for reasonable file size
if mont.width > 1400:
    mont = mont.resize((1400, int(mont.height * 1400 / mont.width)))
mont.save(out, quality=85)
print(f"montage: {out}  ({len(tiles)} frames @ every {N}s, rot={rot})")
