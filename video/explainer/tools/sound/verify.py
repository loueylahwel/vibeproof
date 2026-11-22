#!/usr/bin/env python3
"""Measure the rendered soundtrack: length, peaks, loudness, cue timing and silent gaps.

    python3 tools/sound/verify.py
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from dsp import SR  # noqa: E402
from families import family_of  # noqa: E402
from loudness import integrated, true_peak_db  # noqa: E402
from synth import load_cues, render_cue  # noqa: E402

PEAKED = {"swing", "cam", "line"}  # whooshes: the envelope peak lands on the beat


def mode_of(cue, fam):
    if fam in PEAKED or "res-bars" in cue["id"] or "-hl-" in cue["id"]:
        return "peak"
    return "onset"  # struck sounds: the attack lands on the beat


def read(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 2 and w.getsampwidth() == 2
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768.0
    return x.reshape(-1, 2).T


def env_rms(x, ms):
    w = max(1, int(ms * 1e-3 * SR))
    e = (x * x).mean(axis=0)
    c = np.concatenate([[0.0], np.cumsum(e)])
    y = np.sqrt(np.maximum((c[w:] - c[:-w]) / w, 0))
    h = w // 2
    return np.concatenate([np.zeros(h), y, np.zeros(w - 1 - h)])


def hit_time(x, at, mode, half):
    """Where the sound lands, searched only within +-half seconds of `at`.
    onset: the time the 5 ms envelope crosses halfway up its rise (attack of a struck sound);
    peak:  the maximum of the 12 ms envelope (a whoosh's peak)."""
    a, b = int((at - half) * SR), int((at + half) * SR)
    a, b = max(a, 0), min(b, x.shape[1] - 1)
    if mode == "onset":
        e = env_rms(x[:, max(a - SR // 10, 0):b + SR // 10], 5.0)
        off = a - max(a - SR // 10, 0)
        e = e[off:off + (b - a)]
        top = int(np.argmax(e))
        base = e[:top + 1].min()
        thr = base + 0.5 * (e[top] - base)
        lo = int(np.argmin(e[:top + 1]))
        cross = lo + int(np.argmax(e[lo:top + 1] >= thr))
        return (a + cross) / SR
    e = env_rms(x, 12.0)
    return (a + int(np.argmax(e[a:b]))) / SR


def ffmpeg_loudness(path):
    try:
        p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true",
                            "-f", "null", "-"], capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired):
        return None
    txt = p.stderr.split("Summary:")[-1]
    vals = {}
    for line in txt.splitlines():
        line = line.strip()
        if line.startswith("I:"):
            vals["I"] = float(line.split()[1])
        if line.startswith("Peak:"):
            vals["TP"] = float(line.split()[1])
    return vals


def main():
    mix = read(os.path.join(HERE, "soundtrack.wav"))
    fx = read(os.path.join(HERE, "stem-effects.wav"))
    bed = read(os.path.join(HERE, "stem-bed.wav"))
    print(f"length: {mix.shape[1] / SR:.4f} s ({mix.shape[1]} frames)")
    print(f"sample peak: {20 * np.log10(np.abs(mix).max()):.2f} dBFS, clipped samples: {(np.abs(mix) >= 32767 / 32768).sum()}")
    print(f"true peak (4x): {true_peak_db(mix):.2f} dBTP")
    li_mix, li_fx, li_bed = integrated(mix), integrated(fx), integrated(bed)
    print(f"integrated (numpy BS.1770): mix {li_mix:.2f} LUFS, effects {li_fx:.2f}, bed {li_bed:.2f} "
          f"(bed {li_fx - li_bed:.1f} dB under effects)")
    ff = ffmpeg_loudness(os.path.join(HERE, "soundtrack.wav"))
    if ff:
        print(f"ffmpeg ebur128: I = {ff.get('I')} LUFS, true peak = {ff.get('TP')} dBFS")

    # cue timing, on the effects stem and on each cue rendered alone
    cues = load_cues()
    ats = np.array([c["at"] for c in cues])
    worst, rows = 0.0, []
    for i, c in enumerate(cues):
        fam = family_of(c)
        gap = min([abs(c["at"] - a) for j, a in enumerate(ats) if j != i] + [1.0])
        half = float(np.clip(gap / 2, 0.02, 0.06))
        mode = mode_of(c, fam)
        t_stem = hit_time(fx, c["at"], mode, half)
        st, hit, _ = render_cue(c)
        lone = np.zeros((2, st.shape[1] + 2 * SR))
        lone[:, SR:SR + st.shape[1]] = st
        t_lone = hit_time(lone, 1.0 + hit / SR, mode, 0.06) - 1.0 - hit / SR
        err = t_stem - c["at"]
        worst = max(worst, abs(err), abs(t_lone))
        rows.append((max(abs(err), abs(t_lone)), c["id"], fam, err * 1e3, t_lone * 1e3))
    rows.sort(reverse=True)
    print(f"cue timing: worst |error| {worst * 1e3:.1f} ms over {len(cues)} cues "
          f"({sum(abs(r[3]) <= 15 for r in rows)} within 15 ms on the stem, "
          f"{sum(abs(r[4]) <= 15 for r in rows)} rendered alone)")
    for r in rows[:6]:
        print(f"   {r[1]:28s} {r[2]:7s} stem {r[3]:+6.1f} ms   alone {r[4]:+6.1f} ms")

    # silent gaps in the full mix (50 ms RMS windows)
    e = env_rms(mix, 50.0)
    quiet = 20 * np.log10(e + 1e-12) < -50
    longest, run, start, best = 0, 0, 0, 0
    for i, q in enumerate(quiet[::48]):  # 1 ms steps
        if q:
            if run == 0:
                start = i
            run += 1
            if run > longest:
                longest, best = run, start
        else:
            run = 0
    print(f"longest stretch below -50 dBFS: {longest / 1000:.3f} s (from {best / 1000:.3f} s)")


if __name__ == "__main__":
    main()
