"""Packs Poly Haven CC0 texture sets into the two compact maps the terrain shader uses.

Input (per set, 1k JPGs from polyhaven.com): <name>_diff.jpg, <name>_nor_gl.jpg, <name>_rough.jpg
Output (public/textures/):
  <out>_detail_<size>.jpg  linear RGB albedo *ratio* to the texture mean, x0.5, half-desaturated.
                            The shader multiplies Mars base colour by (sample * 2), so the photo
                            supplies grain and structure while the settlement controls the hue.
  <out>_nr_<size>.jpg      R,G = OpenGL normal X,Y   B = roughness
Usage: python3 -I scripts/process_textures.py <input_dir> <output_dir>
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

SETS = {"gravelly_sand": "regolith", "rock_face_03": "bedrock", "cliff_side": "strata"}
SIZES = (1024, 512)


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def main(src, dst):
    src, dst = Path(src), Path(dst)
    dst.mkdir(parents=True, exist_ok=True)
    for name, out in SETS.items():
        diff = srgb_to_linear(np.asarray(Image.open(src / f"{name}_diff.jpg").convert("RGB"), np.float32) / 255)
        lum = diff @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        diff = lum[..., None] + (diff - lum[..., None]) * 0.5
        ratio = diff / diff.reshape(-1, 3).mean(0)
        detail = np.clip(ratio * 0.5, 0, 1)
        nor = np.asarray(Image.open(src / f"{name}_nor_gl.jpg").convert("RGB"), np.float32) / 255
        rough = np.asarray(Image.open(src / f"{name}_rough.jpg").convert("L"), np.float32) / 255
        nr = np.dstack([nor[..., 0], nor[..., 1], rough])
        for size in SIZES:
            for arr, kind in ((detail, "detail"), (nr, "nr")):
                img = Image.fromarray((arr * 255 + 0.5).astype(np.uint8))
                if img.size[0] != size:
                    img = img.resize((size, size), Image.LANCZOS)
                img.save(dst / f"{out}_{kind}_{size}.jpg", quality=86, optimize=True, progressive=True)
        print(out, "mean ratio check", float(detail.mean()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
