#!/usr/bin/env python3
"""Synthesize the full soundtrack for the 222 s explainer from tools/cues.json.

    python3 tools/sound/synth.py          # writes soundtrack.wav, stem-effects.wav, stem-bed.wav

Every sound is generated here from oscillators, noise and filters (see families.py, bed.py).
No audio files, sample libraries or external tools are used. Randomness is seeded from each
cue id, so re-running gives byte-identical output.
"""
import json
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from bed import DUR, render_bed, segments  # noqa: E402
from dsp import SR, convolve, rng_for, room_ir  # noqa: E402
from families import BUILDERS, LEVEL_DB, PEAK_CAP_DB, family_of  # noqa: E402
from loudness import integrated, max_short_window, oversampled_abs  # noqa: E402

CUES = os.path.join(HERE, "..", "cues.json")
N = int(round(DUR * SR))

BED_BELOW_DB = 14.0     # the bed sits this far under the effects (integrated)
REVERB_DB = -12.0       # send level of the synthetic room on the effects
TARGET_LUFS = -18.0     # final mix
CEILING_DB = -1.5       # true-peak ceiling of the limiter (dBTP)


def load_cues():
    with open(CUES) as f:
        return select_cues(sorted(json.load(f)["cues"], key=lambda c: (c["at"], c["id"])))


def chord_at(t):
    for s, e, (name, notes, root) in segments():
        if s <= t < e:
            return notes, root
    return segments()[-1][2][1], segments()[-1][2][2]


PLUCK_GAP = 0.5   # seconds: text plucks closer than this to another sound are left out


def select_cues(cues):
    """v6: no whooshes. Camera puffs and the cursor slide are dropped; text-line plucks are
    thinned so they never crowd; every tonal cue gets a note from the bed's chord at that time,
    walking up and down so consecutive plucks are never the same note."""
    out = []
    others = [c["at"] for c in cues if family_of(c) not in ("cam", "cursor", "pluck")]
    last_pluck = -9.0
    prev_note = 72
    for c in cues:
        fam = family_of(c)
        if fam in ("cam", "cursor"):
            continue
        c = dict(c)
        notes, root = chord_at(c["at"])
        if fam == "pluck":
            if c["at"] - last_pluck < PLUCK_GAP or any(abs(c["at"] - o) < 0.2 for o in others):
                continue
            last_pluck = c["at"]
            r = rng_for(c["id"], "note")
            pool = sorted({n + 12 * k for n in notes for k in (1, 2)} )
            pool = [p for p in pool if 62 <= p <= 86 and p != prev_note]
            near = sorted(pool, key=lambda p: abs(p - prev_note))[:4]
            c["note"] = int(r.choice(near))
            prev_note = c["note"]
        elif fam == "bloom":
            c["note"] = root + 12
        elif fam == "motion6":
            c["note"] = notes[0] + 12
        out.append(c)
    return out


def render_cue(cue):
    """Return (stereo buffer, hit index, family) for one cue, already levelled."""
    fam = family_of(cue)
    r = rng_for(cue["id"])
    st, hit = BUILDERS[fam](cue, r)
    return st, hit, fam


def importance_db(cue, fam, medians):
    g = max(cue["gain"], 1e-3)
    return float(np.clip(3.0 * np.log2(g / medians[fam]), -2.0, 2.0))


def soft_saturate(x, ceiling):
    """tanh saturation that only bends the top of the waveform: peaks approach `ceiling`."""
    p = np.abs(x).max()
    if p <= 0.6 * ceiling:
        return x
    return ceiling * np.tanh(x / ceiling)


def render_effects(cues, sat_db=None):
    """Place every cue on the effects stem. sat_db: per-sound saturation ceiling (dBFS) so that
    single loud sounds are shaped here, by the sound itself, rather than by the bus limiter."""
    fams = [family_of(c) for c in cues]
    medians = {f: float(np.median([c["gain"] for c, ff in zip(cues, fams) if ff == f])) for f in set(fams)}
    out = np.zeros((2, N))
    placed = []
    for cue in cues:
        st, hit, fam = render_cue(cue)
        jitter = rng_for(cue["id"], "level").uniform(-1.0, 1.0)
        target = LEVEL_DB[fam] + importance_db(cue, fam, medians) + jitter
        st = st * 10 ** ((target - max_short_window(st)) / 20)
        cap = 10 ** ((PEAK_CAP_DB[fam] + 0.5 * jitter) / 20)
        st = st * min(1.0, cap / np.abs(st).max())
        if sat_db is not None:
            st = soft_saturate(st, 10 ** (sat_db / 20))
        start = int(round(cue["at"] * SR)) - hit
        a, b = max(0, start), min(N, start + st.shape[1])
        out[:, a:b] += st[:, a - start:b - start]
        placed.append((cue["id"], fam, start, hit))
    return out, placed


def _shift_min(x, w):
    """Centred running minimum over w samples (doubling trick)."""
    y = x.copy()
    span = 1
    while span < w:
        s = min(span, w - span)
        y = np.minimum(y, np.concatenate([y[s:], np.full(s, 1.0)]))
        span += s
    h = w // 2
    return np.concatenate([np.full(h, 1.0), y[:-h]]) if h else y


def _box(x, w):
    c = np.concatenate([[0.0], np.cumsum(x)])
    y = (c[w:] - c[:-w]) / w
    h = w // 2
    return np.concatenate([np.full(h, 1.0), y, np.full(w - 1 - h, 1.0)])


def limit(x, ceiling_db=CEILING_DB, look_ms=5.0, release_ms=100.0):
    """Soft look-ahead limiter on the 4x oversampled peak, zero latency (centred windows)."""
    thr = 10 ** (ceiling_db / 20)
    pk = oversampled_abs(x).max(axis=0).reshape(-1, 4).max(axis=1)
    req = np.minimum(1.0, thr / np.maximum(pk, 1e-9))
    if req.min() >= 1.0:
        return x, 0.0
    w = int(look_ms * 1e-3 * SR) | 1
    g = _box(_shift_min(req, w), w)
    g = np.minimum(g, req)
    # slow release: only where gain reduction happens, recover with a one-pole
    a = np.exp(-1.0 / (release_ms * 1e-3 * SR))
    idx = np.where(g < 1.0)[0]
    lo, hi = idx[0], min(len(g), idx[-1] + int(0.5 * SR))
    seg = g[lo:hi].tolist()
    y = seg[0]
    for i, v in enumerate(seg):
        y = v if v < y else a * y + (1 - a) * v
        seg[i] = y
    g[lo:hi] = seg
    return x * g, float(20 * np.log10(g.min()))


def write_wav(path, x, seed_name):
    r = rng_for(seed_name, "dither")
    d = (r.random(x.shape) - r.random(x.shape)) / 32768.0
    y = np.clip(np.round((x + d) * 32767.0), -32768, 32767).astype("<i2")
    inter = y.T.reshape(-1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(inter.tobytes())


def main():
    cues = load_cues()
    print(f"{len(cues)} cues")
    bed = render_bed()
    l_bed = integrated(bed)
    ir = room_ir(rng_for("room"))

    # find the trim that puts the mix on target, with every sound saturating just under the ceiling
    trim = 6.0
    for it in range(3):
        dry, placed = render_effects(cues, sat_db=CEILING_DB - 0.7 - trim)
        fx = dry + convolve(dry, ir) * 10 ** (REVERB_DB / 20)
        l_fx = integrated(fx)
        bed_s = bed * 10 ** ((l_fx - BED_BELOW_DB - l_bed) / 20)
        trim = TARGET_LUFS - integrated(fx + bed_s)
        print(f"  pass {it + 1}: effects {l_fx:.2f} LUFS, trim {trim:+.2f} dB")

    k = 10 ** (trim / 20)
    fx, bed = fx * k, bed_s * k
    for _ in range(2):  # the limiter takes a little loudness away; win it back
        mix, gr = limit(fx + bed)
        err = TARGET_LUFS - integrated(mix)
        if abs(err) < 0.05:
            break
        fx, bed = fx * 10 ** (err / 20), bed * 10 ** (err / 20)
    fx_l, gr_fx = limit(fx)
    bed_l, gr_bed = limit(bed)
    print(f"limiter max GR: mix {gr:.2f} dB, effects stem {gr_fx:.2f} dB, bed stem {gr_bed:.2f} dB")

    write_wav(os.path.join(HERE, "soundtrack.wav"), mix, "mix")
    write_wav(os.path.join(HERE, "stem-effects.wav"), fx_l, "fx")
    write_wav(os.path.join(HERE, "stem-bed.wav"), bed_l, "bed")
    print("wrote soundtrack.wav, stem-effects.wav, stem-bed.wav")


if __name__ == "__main__":
    main()
