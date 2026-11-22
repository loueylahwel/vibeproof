"""Pixel helper for our renderer (numpy + Pillow).

Server mode (one per render worker): reads JSON lines on stdin, answers one
JSON line per request on stdout.
  {"op": "diff", "a": png, "b": png}
      -> {"mad": mean |a-b| over 0..255, "frac": share of pixels moved > 24}
         measured on a 1/4-size copy
  {"op": "blend", "out": png, "inputs": [png, ...], "remove": true}
      -> averages the inputs in linear light, writes out, deletes inputs

CLI: python3 pixels.py compare <a.png> <b.png> [side_by_side.png]
      -> prints the mean absolute difference (0..255, all channels)
"""
import json
import os
import sys

import numpy as np
from PIL import Image

# sRGB <-> linear lookup: 8-bit in, float linear; and a 4096-step table back out
_s = np.arange(256, dtype=np.float64) / 255.0
TO_LIN = np.where(_s <= 0.04045, _s / 12.92, ((_s + 0.055) / 1.055) ** 2.4).astype(np.float32)
_l = np.linspace(0.0, 1.0, 4096)
FROM_LIN = np.clip(np.round(255.0 * np.where(_l <= 0.0031308, _l * 12.92, 1.055 * _l ** (1 / 2.4) - 0.055)), 0, 255).astype(np.uint8)


def load_rgb(path):
    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"))


def small(path):
    with Image.open(path) as im:
        im = im.convert("L")
        return np.asarray(im.resize((im.width // 4, im.height // 4), Image.BILINEAR), dtype=np.int16)


def diff(a, b):
    d = np.abs(small(a) - small(b))
    return {"mad": float(d.mean()), "frac": float((d > 24).mean())}


def blend(out, inputs, remove=True):
    acc = None
    for p in inputs:
        lin = TO_LIN[load_rgb(p)]
        acc = lin if acc is None else acc + lin
    acc /= len(inputs)
    idx = np.clip(np.round(acc * 4095.0), 0, 4095).astype(np.int32)
    Image.fromarray(FROM_LIN[idx], "RGB").save(out + ".tmp.png", compress_level=1)
    os.replace(out + ".tmp.png", out)
    if remove:
        for p in inputs:
            try:
                os.remove(p)
            except FileNotFoundError:
                pass
    return {"ok": True}


def serve():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            if req["op"] == "diff":
                res = diff(req["a"], req["b"])
            elif req["op"] == "blend":
                res = blend(req["out"], req["inputs"], req.get("remove", True))
            else:
                res = {"error": "unknown op"}
        except Exception as e:  # report, keep serving
            res = {"error": repr(e)}
        sys.stdout.write(json.dumps(res) + "\n")
        sys.stdout.flush()


def compare(a, b, sbs=None):
    A = load_rgb(a).astype(np.int16)
    B = load_rgb(b).astype(np.int16)
    print(f"{np.abs(A - B).mean():.3f}")
    if sbs:
        h = A.shape[0] // 2
        w = A.shape[1] // 2
        ia = Image.fromarray(A.astype(np.uint8)).resize((w, h))
        ib = Image.fromarray(B.astype(np.uint8)).resize((w, h))
        canvas = Image.new("RGB", (w, h * 2), "white")
        canvas.paste(ia, (0, 0))
        canvas.paste(ib, (0, h))
        canvas.save(sbs)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "compare":
        compare(*sys.argv[2:5])
    else:
        serve()
