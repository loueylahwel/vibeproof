#!/usr/bin/env python3
"""Measure the v7 soundtrack: format and length, loudness and true peak (ours and ffmpeg's),
effect and drop onsets, silent stretches, and spectrogram/waveform pictures.

    python3 tools/sound/v7_verify.py [--png OUTDIR]
"""
import os
import re
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from dsp import SR  # noqa: E402
from loudness import integrated, true_peak_db  # noqa: E402
from v7_score import GAP, DROP  # noqa: E402

FX_TIMES = [("low hit", 5.5), ("metal clink", 16.5), ("glass crack + low hit", 24.5), ("lock-on", 43.0),
            ("lock-on", 50.0), ("lock-on", 67.5), ("lock-on", 75.0), ("UI click", 107.5),
            ("UI click + confirm", 128.0), ("chime", 215.0)]
FADE_START = 215.5


def read(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 2 and w.getsampwidth() == 2, path
        n = w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype="<i2").astype(float) / 32768.0
    return x.reshape(-1, 2).T


def onset(x, t, pre=0.1, look=0.3, frac=0.1):
    a = int((t - pre) * SR)
    e = np.abs(x[:, a:int((t + look) * SR)]).max(axis=0)
    thr = frac * e.max()
    return (a + int(np.argmax(e > thr))) / SR, 20 * np.log10(e.max() + 1e-12)


def ffmpeg_loudness(path):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true",
                        "-f", "null", "-"], capture_output=True, text=True)
    s = p.stderr[p.stderr.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+) LUFS", s)
    tp = re.search(r"Peak:\s+(-?[\d.]+) dBFS", s)
    lra = re.search(r"LRA:\s+(-?[\d.]+) LU", s)
    return (float(i.group(1)) if i else None, float(tp.group(1)) if tp else None,
            float(lra.group(1)) if lra else None)


def main():
    mix = read(os.path.join(HERE, "soundtrack-v7.wav"))
    mus = read(os.path.join(HERE, "music-v7.wav"))
    fx = read(os.path.join(HERE, "fx-v7.wav"))
    for name, x in (("soundtrack", mix), ("music", mus), ("fx", fx)):
        print(f"{name:10s} {x.shape[1]} frames = {x.shape[1] / SR:.4f} s")
    print(f"integrated (ours)  {integrated(mix):.2f} LUFS, true peak {true_peak_db(mix):.2f} dBTP")
    i, tp, lra = ffmpeg_loudness(os.path.join(HERE, "soundtrack-v7.wav"))
    print(f"ffmpeg ebur128     {i} LUFS, true peak {tp} dBTP, LRA {lra} LU")
    print(f"stems: music {integrated(mus):.2f} LUFS / TP {true_peak_db(mus):.2f}; "
          f"fx TP {true_peak_db(fx):.2f} dBTP")

    print("\neffect onsets (fx stem):")
    worst = 0.0
    for name, t in FX_TIMES:
        o, pk = onset(fx, t)
        worst = max(worst, abs(o - t))
        print(f"  {t:7.2f}  {name:24s} onset {o:8.4f}  ({(o - t) * 1000:+5.1f} ms)  peak {pk:5.1f} dBFS")
    o, pk = onset(mus, DROP, pre=0.05)
    worst = max(worst, abs(o - DROP))
    print(f"  {DROP:7.2f}  {'THE DROP (music stem)':24s} onset {o:8.4f}  ({(o - DROP) * 1000:+5.1f} ms)  peak {pk:5.1f} dBFS")
    print(f"  worst onset error {worst * 1000:.1f} ms")

    w = int(0.05 * SR)
    e = mix[:, :mix.shape[1] // w * w].reshape(2, -1, w)
    rms = 10 * np.log10((e ** 2).mean(axis=(0, 2)) + 1e-20)
    quiet = np.where(rms < -60)[0]
    spans = []
    for q in quiet:
        t0 = q * w / SR
        if spans and abs(spans[-1][1] - t0) < 1e-6:
            spans[-1][1] = t0 + 0.05
        else:
            spans.append([t0, t0 + 0.05])
    print("\nstretches below -60 dBFS RMS (50 ms windows):")
    for a, b in spans:
        tag = "intentional gap" if a >= GAP[0] - 0.06 and b <= GAP[1] + 0.06 else (
            "final fade" if a >= FADE_START else "UNEXPECTED")
        print(f"  {a:7.2f}-{b:7.2f}  {tag}")
    g = mix[:, int(GAP[0] * SR) + 480:int(GAP[1] * SR) - 10]
    print(f"gap {GAP[0]}-{GAP[1]} level: {20 * np.log10(np.sqrt((g ** 2).mean()) + 1e-12):.1f} dBFS RMS")
    print(f"last 0.2 s peak: {20 * np.log10(np.abs(mix[:, -int(0.2 * SR):]).max() + 1e-12):.1f} dBFS")

    if "--png" in sys.argv:
        out = sys.argv[sys.argv.index("--png") + 1]
        os.makedirs(out, exist_ok=True)
        src = os.path.join(HERE, "soundtrack-v7.wav")
        jobs = [("spectrum-full.png", [], "showspectrumpic=s=1800x600:legend=1:scale=log:fscale=log:stop=16000"),
                ("wave-full.png", [], "showwavespic=s=1800x400:split_channels=0"),
                ("spectrum-0-60.png", ["-ss", "0", "-t", "60"], "showspectrumpic=s=1800x600:legend=1:scale=log:fscale=log"),
                ("spectrum-190-222.png", ["-ss", "190", "-t", "32"], "showspectrumpic=s=1800x600:legend=1:scale=log:fscale=log"),
                ("wave-200-210.png", ["-ss", "200", "-t", "10"], "showwavespic=s=1800x400"),
                ("spectrum-low-30-40.png", ["-ss", "30", "-t", "8"],
                 "lowpass=f=400,showspectrumpic=s=1600x500:legend=1:scale=log:stop=400")]
        for name, seek, filt in jobs:
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *seek, "-i", src,
                            "-lavfi", filt, "-frames:v", "1", os.path.join(out, name)], check=True)
        for name, x in (("wave-fx.png", "fx-v7.wav"), ("wave-music.png", "music-v7.wav")):
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", os.path.join(HERE, x),
                            "-lavfi", "showwavespic=s=1800x300", "-frames:v", "1", os.path.join(out, name)],
                           check=True)
        print(f"pictures in {out}")


if __name__ == "__main__":
    main()
