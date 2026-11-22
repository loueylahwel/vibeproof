"""Soundtrack for the app walkthrough, synthesized with numpy (no samples).

    python3 tools/sound.py <scratch-dir> <out.wav>

Reads <scratch-dir>/timeline.json (written by record.mjs) and makes:
  - a calm music bed in F minor, 92 BPM: warm pad, soft bass, a plucked arpeggio and
    light brushed hats, fading in and out with the recording;
  - a soft mouse click on every click, a quiet key tick on every key press (each one
    slightly different), and a two-note chime when a scan finishes.
"""
import json
import sys

import numpy as np

SR = 48000
BPM = 92.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(20261122)


def mtof(m):
    return 440.0 * 2 ** ((np.asarray(m, float) - 69) / 12)


def lp(x, fc):
    """Two-pole low-pass via FFT (zero phase)."""
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    return np.fft.irfft(np.fft.rfft(x) / (1 + (f / fc) ** 4) ** 0.5, n)


def hp(x, fc):
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    r = (f / fc) ** 2
    return np.fft.irfft(np.fft.rfft(x) * r / np.sqrt(1 + r ** 2), n)


def env(n, a, r_tau, sustain_n=None):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4))
    return e * np.exp(-t / r_tau)


def add(buf, x, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= buf.shape[1] or i + len(x) <= 0:
        return
    j = min(buf.shape[1], i + len(x))
    seg = x[: j - i] * gain
    buf[0, i:j] += seg * np.sqrt(0.5 * (1 - pan))
    buf[1, i:j] += seg * np.sqrt(0.5 * (1 + pan))


# ---------------- music ----------------
# Fm9 | Dbmaj7 | Abmaj7 | Eb6sus, two bars each (MIDI notes)
CHORDS = [
    (41, [56, 60, 63, 67]),   # F:  Ab C Eb G
    (37, [53, 56, 60, 65]),   # Db: F Ab C F
    (44, [55, 60, 63, 67]),   # Ab: G C Eb G
    (39, [55, 58, 60, 63]),   # Eb: G Bb C Eb
]


def pad_note(m, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for det in (-0.07, 0.0, 0.06):
        f = mtof(m + det)
        ph = rng.uniform(0, 1)
        x += 2 * ((f * t + ph) % 1) - 1  # saw
    x = lp(x, 900)
    a = np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 1.0).clip(0)
    return x * a / 3


def pluck(m, v):
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.12)
    x += 0.12 * np.sin(6 * np.pi * f * t + 0.3) * np.exp(-t / 0.06)
    return x * env(n, 0.003, 0.42) * v


def bass_note(m, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = mtof(m)
    x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    a = np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.15).clip(0)
    return x * a


def hat(v):
    n = int(0.09 * SR)
    x = hp(rng.standard_normal(n), 7000) * env(n, 0.001, 0.025)
    return x * v


def kick(v):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 48 + 70 * np.exp(-t / 0.04)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(n, 0.002, 0.16) * v


def music(length):
    buf = np.zeros((2, int(length * SR) + SR))
    pads = np.zeros_like(buf)
    bars = int(np.ceil(length / BAR)) + 1
    for b in range(bars):
        t0 = b * BAR
        root, notes = CHORDS[(b // 2) % 4]
        if b % 2 == 0:  # chord changes every two bars
            for k, m in enumerate(notes):
                add(pads, pad_note(m, 2 * BAR + 0.8), t0, 0.16, pan=(-0.5, -0.15, 0.15, 0.5)[k])
            add(buf, bass_note(root, 2 * BAR - 0.1), t0, 0.22)
        arp_on = 2 <= b  # pads and bass alone for the first two bars
        drums_on = 4 <= b and t0 < length - 3 * BAR
        for s in range(8):  # eighth notes
            ts = t0 + s * BEAT / 2
            if arp_on:
                seq = [0, 2, 1, 3, 2, 1, 3, 2] if b % 4 < 2 else [0, 1, 2, 3, 2, 3, 1, 2]
                m = notes[seq[s]] + 12
                v = (0.9 if s % 2 == 0 else 0.6) * (0.85 + 0.15 * rng.random())
                add(buf, pluck(m, v), ts + rng.normal(0, 0.004), 0.07, pan=0.35 * np.sin(s * 0.8))
            if drums_on:
                add(buf, hat(0.6 if s % 2 else 0.35), ts + (0.012 if s % 2 else 0), 0.06, pan=0.25)
        if drums_on:
            for beat in (0, 2):
                add(buf, kick(1.0), t0 + beat * BEAT, 0.22)
    # simple stereo "room": a short delay on the plucks and pads
    wet = np.zeros_like(buf)
    for d, g in ((0.19, 0.25), (0.31, 0.18), (0.47, 0.11)):
        k = int(d * SR)
        wet[0, k:] += buf[1, :-k] * g + pads[1, :-k] * g * 0.6
        wet[1, k:] += buf[0, :-k] * g + pads[0, :-k] * g * 0.6
    out = buf + pads + np.stack([lp(wet[0], 3500), lp(wet[1], 3500)])
    out = out[:, : int(length * SR)]
    t = np.arange(out.shape[1]) / SR
    fade = np.minimum(1, t / 2.5) * np.clip((length - t) / 4.0, 0, 1)
    return out * fade


# ---------------- interface sounds ----------------
def click_sound():
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    pitch = 1 + rng.normal(0, 0.05)
    body = np.sin(2 * np.pi * 1900 * pitch * t) * np.exp(-t / 0.006)
    snap = hp(rng.standard_normal(n), 2500) * np.exp(-t / 0.002)
    low = np.sin(2 * np.pi * 180 * pitch * t) * np.exp(-t / 0.012)
    return (0.5 * body + 0.35 * snap + 0.5 * low) * 10 ** (rng.normal(0, 1.2) / 20)


def key_sound():
    n = int(0.035 * SR)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 1800 + 600 * rng.random()) * np.exp(-t / 0.004)
    x += 0.3 * np.sin(2 * np.pi * (650 + 120 * rng.random()) * t) * np.exp(-t / 0.008)
    return x * 10 ** (rng.normal(0, 2.0) / 20)


def chime():
    n = int(1.8 * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for m, d in ((84, 0.0), (91, 0.11)):  # C6 then G6, both in the key
        f = mtof(m)
        k = int(d * SR)
        tt = t[: n - k]
        x[k:] += (np.sin(2 * np.pi * f * tt) + 0.2 * np.sin(2 * np.pi * 2.76 * f * tt) * np.exp(-tt / 0.08)) * np.exp(-tt / 0.5)
    return x


def main(scratch, out):
    tl = json.load(open(f"{scratch}/timeline.json"))
    z = tl["frames"][0]["t"]
    length = tl["t1"] - z
    mus = music(length)
    fx = np.zeros_like(mus)
    for e in tl["events"]:
        t = e["t"] - z
        if e["type"] == "click":
            add(fx, click_sound(), t + 0.07, 0.5, pan=rng.uniform(-0.1, 0.1))
        elif e["type"] == "key":
            add(fx, key_sound(), t + 0.01, 0.16, pan=rng.uniform(-0.15, 0.15))
        elif e["type"] == "done":
            add(fx, chime(), t + 0.05, 0.16, pan=0.1)
    # music level: about 14 dB under the effects' peaks
    mix = mus / (np.sqrt(np.mean(mus ** 2)) + 1e-9) * 0.06 + fx
    mix /= max(1.0, np.max(np.abs(mix)) / 0.89)
    pcm = (np.clip(mix.T, -1, 1) * 32767).astype("<i2")
    import wave
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{out}: {length:.1f} s")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
