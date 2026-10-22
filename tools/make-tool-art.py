"""Makes the Workspace's tool pictures, assets/art/<tool>.jpg (480x300, 16:10).

Inputs are the example media kept on `main` (docs/examples, see THIRD_PARTY.md): six Unsplash photos and two Coverr
clips. The Vocal Remover picture is drawn here (four stem waveforms), not taken from a photo.

    git show main:docs/examples/<file> > <dir>/<file>   # for every file named in SOURCES and CLIPS
    python tools/make-tool-art.py <dir>

Needs Pillow, and FFmpeg on PATH for the clip frames.
"""

import math
import random
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

SIZE = (480, 300)
OUT = Path(__file__).resolve().parent.parent / "assets" / "art"

# tool id: (photo, horizontal focus, vertical focus) as fractions of the source
SOURCES = {
    "downloader": ("downloader.jpg", 0.62, 0.5),
    "converter": ("convert.jpg", 0.5, 0.5),
    "audio-visualizer": ("visualizer.jpg", 0.5, 0.7),
    "cover-test": ("covertest.jpg", 0.5, 0.45),
    "background-remover": ("removebg.jpg", 0.5, 0.38),
    "upscale": ("upscale.jpg", 0.5, 0.55),
}

# tool id: (clip, second)
CLIPS = {
    "frame-capture": ("clip-1.mp4", 3),
    "ai-interpolate": ("clip-2.mp4", 3),
}

# Grade: the city lights behind the man of clip-2, cropped close and given a look
GRADE = ("clip-2.mp4", 1, (0.6, 0.0, 1.0, 0.45))


def cover(image, fx, fy):
    """Crops `image` to 16:10 around the focus point and scales it to SIZE"""
    w, h = image.size
    target = SIZE[0] / SIZE[1]
    if w / h > target:
        cw, ch = round(h * target), h
    else:
        cw, ch = w, round(w / target)
    x = min(max(round(fx * w - cw / 2), 0), w - cw)
    y = min(max(round(fy * h - ch / 2), 0), h - ch)
    return image.crop((x, y, x + cw, y + ch)).resize(SIZE, Image.LANCZOS)


def frame(clip, second, dir):
    out = dir / f"{clip}-{second}.png"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-ss", str(second), "-i", str(dir / clip), "-frames:v", "1", str(out)],
        check=True,
    )
    return Image.open(out).convert("RGB")


def graded(image):
    """A warm, contrasty look, so Grade's picture shows a grade"""
    r, g, b = image.split()
    r = r.point(lambda v: min(255, int(v * 1.18 + 10)))
    b = b.point(lambda v: int(v * 0.82))
    image = Image.merge("RGB", (r, g, b))
    return ImageEnhance.Contrast(image).enhance(1.15)


def stems():
    """Four stem waveforms on the canvas colour, for Vocal Remover"""
    scale = 2
    w, h = SIZE[0] * scale, SIZE[1] * scale
    image = Image.new("RGB", (w, h), (16, 16, 17))
    draw = ImageDraw.Draw(image)
    colours = [(163, 168, 220), (227, 145, 164), (224, 177, 94), (159, 214, 178)]
    rng = random.Random(7)
    lane = h / 4
    for i, colour in enumerate(colours):
        mid = lane * i + lane / 2
        phase = rng.random() * 6
        for x in range(0, w, 6 * scale):
            t = x / w
            envelope = 0.35 + 0.65 * abs(math.sin(t * math.pi * (2 + i) + phase))
            amp = (lane * 0.42) * envelope * (0.55 + 0.45 * rng.random())
            draw.rounded_rectangle(
                (x, mid - amp, x + 3 * scale, mid + amp), radius=1.5 * scale, fill=colour
            )
    image = image.filter(ImageFilter.GaussianBlur(0.6))
    return image.resize(SIZE, Image.LANCZOS)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    dir = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    pictures = {}
    for tool, (file, fx, fy) in SOURCES.items():
        pictures[tool] = cover(Image.open(dir / file).convert("RGB"), fx, fy)
    for tool, (clip, second) in CLIPS.items():
        pictures[tool] = cover(frame(clip, second, dir), 0.5, 0.5)
    clip, second, (left, top, right, bottom) = GRADE
    still = frame(clip, second, dir)
    w, h = still.size
    region = still.crop((round(left * w), round(top * h), round(right * w), round(bottom * h)))
    pictures["grade"] = graded(cover(region, 0.5, 0.5))
    pictures["vocal-remover"] = stems()
    for tool, image in pictures.items():
        image.save(OUT / f"{tool}.jpg", quality=86, optimize=True, progressive=True)
        print(OUT / f"{tool}.jpg")


if __name__ == "__main__":
    main()
