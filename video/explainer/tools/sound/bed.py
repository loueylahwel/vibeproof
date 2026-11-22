"""Ambient bed: a slow F-major chord loop of detuned saw + sine voices through a gentle
low-pass, a very quiet low pulse, a lift for the results section and a held final chord."""
import numpy as np

from dsp import SR, fft_lowpass, phase_from_freq, rng_for, saw_blep

DUR = 222.0
CHORD_LEN = 8.0
XFADE = 2.0  # seconds of crossfade centred on each chord change


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# pad voicings (MIDI) and bass roots
LOOP = [
    ("Fmaj9", [53, 57, 60, 64, 67], 41),
    ("Dm9", [50, 57, 60, 64, 65], 38),
    ("Bbmaj7", [46, 53, 57, 62, 65], 46),
    ("Csus4", [48, 55, 60, 65, 67], 36),
]
FINAL = ("Fadd9", [53, 60, 65, 67, 69], 41)


def segments():
    segs = []
    t, k = 0.0, 0
    while t < 200.0:
        segs.append((t, t + CHORD_LEN, LOOP[k % 4]))
        t += CHORD_LEN
        k += 1
    segs.append((200.0, 210.0, LOOP[3]))  # dominant sus under the payoff, resolving at 210
    segs.append((210.0, DUR, FINAL))
    return segs


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return np.sin(x * np.pi / 2) ** 2


def ramp(t, t0, t1):
    return smoothstep((t - t0) / (t1 - t0))


def render_bed():
    n = int(round(DUR * SR))
    pad = np.zeros((2, n))
    bass = np.zeros(n)
    for (s, e, (name, notes, root)) in segments():
        a = max(0.0, s - XFADE / 2)
        b = min(DUR, e + XFADE / 2)
        i0, i1 = int(round(a * SR)), int(round(b * SR))
        m = i1 - i0
        t = (np.arange(m) + i0) / SR
        w = np.ones(m)
        if s > 0:
            w *= smoothstep((t - (s - XFADE / 2)) / XFADE)
        if e < DUR:
            w *= 1 - smoothstep((t - (e - XFADE / 2)) / XFADE)
        r = rng_for(f"bed-{s:.0f}-{name}")
        for j, note in enumerate(notes):
            f = mtof(note)
            spread = (j / (len(notes) - 1)) * 1.2 - 0.6
            lfo = 1 + 0.15 * np.sin(2 * np.pi * r.uniform(0.07, 0.2) * t + r.uniform(0, 6.28))
            drift = 1 + 0.0015 * np.sin(2 * np.pi * r.uniform(0.05, 0.12) * t + r.uniform(0, 6.28))
            cents = r.uniform(5, 9)
            s1 = saw_blep(f * drift * 2 ** (cents / 1200), m, r.uniform())
            s2 = saw_blep(f * drift * 2 ** (-cents / 1200), m, r.uniform())
            sn = np.sin(2 * np.pi * phase_from_freq(f * drift, m, r.uniform()))
            amp = w * lfo * (0.9 if note < 50 else 1.0) / len(notes)
            th = (spread + 1) * np.pi / 4
            pad[0, i0:i1] += amp * (0.55 * s1 + 0.25 * s2 + 0.5 * sn) * np.cos(th) * 1.41
            pad[1, i0:i1] += amp * (0.25 * s1 + 0.55 * s2 + 0.5 * sn) * np.sin(th) * 1.41
        # held bass sine an octave under the chord
        fb = mtof(root)
        bass[i0:i1] += w * 0.22 * np.sin(2 * np.pi * phase_from_freq(fb, m, r.uniform()))

    t = np.arange(n) / SR
    lift = ramp(t, 180.0, 183.0) * (1 - ramp(t, 204.0, 207.0))
    dark = fft_lowpass(pad, 850.0, order=2)
    bright = fft_lowpass(pad, 1500.0, order=2)
    pad = dark * (1 - lift) + bright * lift
    pad += bass

    # very quiet low pulse on the chord root, once a second, from the first scene to the payoff
    pulse = np.zeros(n)
    for (s, e, (name, notes, root)) in segments()[:-1]:
        fp = mtof(root + 12) if mtof(root) < 70 else mtof(root)
        k = s
        while k < e - 1e-6:
            if 2.0 <= k <= 206.0:
                i = int(round(k * SR))
                m = min(int(0.9 * SR), n - i)
                tt = np.arange(m) / SR
                env = np.minimum(tt / 0.02, 1) * np.exp(-tt / 0.25)
                env[-int(0.05 * SR):] *= np.linspace(1, 0, int(0.05 * SR))
                strong = 1.0 if abs((k - s) % 2.0) < 1e-6 else 0.7
                pulse[i:i + m] += strong * env * (np.sin(2 * np.pi * fp * tt) + 0.25 * np.sin(4 * np.pi * fp * tt))
            k += 1.0
    pad += pulse * 0.10

    gain = ramp(t, 0.0, 2.0) ** 0.5            # fade in over the first 2 s
    gain *= 10 ** (2.5 * lift / 20)             # lift for the results section
    gain *= np.cos(np.pi / 2 * np.clip((t - (DUR - 4.0)) / 4.0, 0, 1))  # fade out over the last 4 s
    return pad * gain
