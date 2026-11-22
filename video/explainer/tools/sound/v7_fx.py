"""v7 effects: the few sound moments of SPEC v7, all tuned to the chord playing at that moment.
Each builder returns a stereo buffer whose first sample is the onset (it lands exactly on its time)."""
import numpy as np

from dsp import SR, rng_for
from v7_dsp import bp_mag, fft_filter, hp_mag, lp_mag, mtof, pan_st, pulse, saw, tri
from v7_score import CHORD, chord_at, tones_in


def _t(n):
    return np.arange(n) / SR


def _attack(x, ms):
    k = max(1, int(ms * 1e-3 * SR))
    x = x.copy()
    x[..., :k] *= np.linspace(0, 1, k)
    return x


def _tail(x, ms=20):
    k = max(1, int(ms * 1e-3 * SR))
    x[..., -k:] *= np.linspace(1, 0, k)
    return x


def low_hit(root_pc, r, weight=1.0):
    """Soft low synth hit: a sub that drops onto the chord root plus a dark saw fifth that blooms."""
    n = int(2.2 * SR)
    t = _t(n)
    m = 36 + (root_pc % 12) if 36 + (root_pc % 12) <= 43 else 24 + (root_pc % 12)
    f0 = float(mtof(m))
    f = f0 * (1 + 1.2 * np.exp(-t / 0.03))
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.7)
    body = np.zeros(n)
    for iv, g in ((12, 1.0), (19, 0.6), (24, 0.35)):
        body += g * saw(f0 * 2 ** (iv / 12), n, r)
    body = fft_filter(body, lp_mag(700, 2)) * np.exp(-t / 0.45) * (1 - np.exp(-t / 0.01))
    click = fft_filter(r.standard_normal(n), bp_mag(1800, 1.0)) * np.exp(-t / 0.004)
    x = np.tanh(1.3 * (sub * 0.9 * weight + 0.22 * body + 0.05 * click))
    st = np.stack([x, x])
    # a little width on the body only
    w = 0.08 * body * np.exp(-t / 0.3)
    st[0] += w
    st[1] -= w
    return _tail(_attack(st, 1.5), 50)


def clink(midi, r):
    """Small metallic clink: a struck bar (inharmonic modes) on a chord tone, with a tiny tick."""
    n = int(1.0 * SR)
    t = _t(n)
    f0 = float(mtof(midi))
    x = np.zeros(n)
    for ratio, g, tau in ((1.0, 1.0, 0.32), (2.756, 0.55, 0.16), (5.404, 0.3, 0.08), (8.933, 0.15, 0.04)):
        if f0 * ratio < 18000:
            fr = f0 * ratio * r.uniform(0.998, 1.002)
            x += g * np.sin(2 * np.pi * fr * t + r.random() * 6.28) * np.exp(-t / tau)
    tick = fft_filter(r.standard_normal(n), hp_mag(5000, 2)) * np.exp(-t / 0.0015)
    x = x + 0.25 * tick
    st = np.stack([x * 0.95, x])
    st[1] = np.concatenate([np.zeros(int(0.0004 * SR)), st[1][:-int(0.0004 * SR)]])
    return _tail(_attack(st, 0.3), 30)


def glass_crack(root_pc, r):
    """Glass crack: a cluster of tiny resonant cracks (no sweep) over a low hit on the chord root."""
    n = int(2.2 * SR)
    t = _t(n)
    st = low_hit(root_pc, r, weight=0.8) * 0.75
    times = np.sort(np.concatenate([[0.0], r.uniform(0.004, 0.14, 9) ** 1.3]))
    for i, tc in enumerate(times):
        m = int(0.05 * SR)
        burst = r.standard_normal(m) * np.exp(-_t(m) / r.uniform(0.0006, 0.0018))
        fc = r.uniform(2600, 8500)
        ring = fft_filter(burst, bp_mag(fc, r.uniform(6, 14)))
        ring += 0.5 * fft_filter(burst, hp_mag(4000, 2))
        ring /= np.max(np.abs(ring)) + 1e-9
        g = (1.0 if i == 0 else r.uniform(0.25, 0.7)) * (1 - 0.4 * tc / 0.14)
        a = int(tc * SR)
        st[:, a:a + m] += pan_st(ring * g * 0.55, r.uniform(-0.5, 0.5))
    # a faint glassy ring after the break, tuned to the chord (third and fifth up high)
    for midi, g in ((91, 0.06), (98, 0.04), (103, 0.025)):
        f = float(mtof(midi)) * r.uniform(0.997, 1.003)
        rr = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.35) * g
        st += pan_st(rr, r.uniform(-0.6, 0.6))
    return _tail(_attack(st, 0.2), 50)


def lock_on(m1, m2, r):
    """Two quick rising notes. Each instance varies the gap, glide, brightness and stereo place."""
    gap = r.uniform(0.06, 0.08)
    n = int(0.6 * SR)
    out = np.zeros((2, n))
    pw = r.uniform(0.25, 0.45)
    bright = r.uniform(0.15, 0.35)
    for k, (m, d, g) in enumerate(((m1, 0.07, 0.8), (m2, 0.22, 1.0))):
        L = int((d + 0.25) * SR)
        t = _t(L)
        f = float(mtof(m)) * 2 ** (-(r.uniform(25, 45) / 1200) * np.exp(-t / 0.012))
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) + bright * fft_filter(pulse(f, L, r, pw), lp_mag(5000, 2))
        e = np.minimum(1, t / 0.002) * np.exp(-t / (0.05 if k == 0 else 0.12))
        x *= e * g
        a = int(k * gap * SR)
        p = r.uniform(-0.15, 0.15) + (0.1 if k else -0.1)
        out[:, a:a + L] += pan_st(x, p)[:, :n - a]
    return _tail(out, 30)


def ui_click(r):
    n = int(0.12 * SR)
    t = _t(n)
    tick = fft_filter(r.standard_normal(n), bp_mag(r.uniform(3200, 3800), 2.0)) * np.exp(-t / 0.0012)
    tick /= np.max(np.abs(tick)) + 1e-9
    body = np.sin(2 * np.pi * r.uniform(1100, 1250) * t) * np.exp(-t / 0.016)
    thock = np.sin(2 * np.pi * 420 * t) * np.exp(-t / 0.024)
    x = 0.6 * tick + 0.35 * body + 0.25 * thock
    return _tail(_attack(pan_st(x, 0.05), 0.15), 10)


def confirm(chord_name, r):
    """UI click and, 60 ms later, a soft two-note confirm (third + fifth of the chord, high)."""
    click = ui_click(r)
    pcs = CHORD[chord_name][1]
    hi = tones_in(pcs, 79, 90)
    a, b = hi[0], hi[1]
    n = int(1.0 * SR)
    t = _t(n)
    tone = np.zeros(n)
    for m, g, dl in ((a, 0.7, 0.0), (b, 0.6, 0.05)):
        f = float(mtof(m))
        y = (np.sin(2 * np.pi * f * t) + 0.18 * tri(f * 2, n, r)) * np.exp(-t / 0.28) * np.minimum(1, t / 0.006)
        k = int(dl * SR)
        tone[k:] += g * y[:n - k]
    st = np.zeros((2, int(0.06 * SR) + n))
    st[:, :click.shape[1]] += click
    st[:, int(0.06 * SR):] += pan_st(tone * 0.55, 0.1)
    return _tail(st, 40)


def chime(r, f_strike=698.456):
    """Bell-like chime in F: church-bell partials tuned to F minor (hum F4, tierce Ab, quint C)."""
    n = int(7.0 * SR)
    t = _t(n)
    parts = [(0.5, 0.5, 3.6), (1.0, 0.9, 2.6), (1.1892, 0.45, 2.0), (1.4983, 0.3, 1.6), (2.0, 0.55, 1.4),
             (2.3784, 0.2, 0.9), (2.9966, 0.18, 0.7), (4.0, 0.12, 0.45), (5.04, 0.06, 0.3)]
    L = np.zeros(n)
    R = np.zeros(n)
    for ratio, g, tau in parts:
        f = f_strike * ratio
        beat = r.uniform(0.3, 0.9)
        L += g * np.sin(2 * np.pi * (f - beat / 2) * t + r.random() * 6.28) * np.exp(-t / tau)
        R += g * np.sin(2 * np.pi * (f + beat / 2) * t + r.random() * 6.28) * np.exp(-t / tau)
    strike = fft_filter(r.standard_normal(n), hp_mag(3000, 2)) * np.exp(-t / 0.003) * 0.15
    st = np.stack([L + strike, R + strike]) / 2.5
    return _tail(_attack(st, 1.0), 200)


def lock_notes(t, r):
    """Two notes rising by a fourth or fifth from the chord at time t, in C6..C7."""
    ch = CHORD[chord_at(t)]
    pool = tones_in(ch[1], 82, 98)
    i = int(r.integers(0, max(1, len(pool) - 2)))
    return pool[i], pool[i + 1] if r.random() < 0.5 else pool[min(i + 2, len(pool) - 1)]


def effects():
    """[(id, time, stereo buffer, level offset dB vs the music around it, music dip dB)];
    clicks may peak as high as the music around them (see PEAK_CAP_DB in music.py)."""
    out = []
    r = rng_for("v7-fx-hit-5.5")
    out.append(("low-hit", 5.5, low_hit(CHORD[chord_at(5.5)][0], r), 1.0, 2.5))
    r = rng_for("v7-fx-clink")
    ch = CHORD[chord_at(16.5)]
    out.append(("clink", 16.5, clink(tones_in(ch[1], 86, 98)[0], r), 2.0, 2.0))
    r = rng_for("v7-fx-crack")
    out.append(("glass-crack", 24.5, glass_crack(CHORD[chord_at(24.5)][0], r), 2.5, 3.0))
    for t in (43.0, 50.0, 67.5, 75.0):
        r = rng_for(f"v7-fx-lock-{t}")
        m1, m2 = lock_notes(t, r)
        out.append((f"lock-on-{t}", t, lock_on(m1, m2, r), 1.5, 2.0))
    out.append(("ui-click", 107.5, ui_click(rng_for("v7-fx-click-107.5")), 1.0, 1.5))
    out.append(("click-confirm", 128.0, confirm(chord_at(128.0), rng_for("v7-fx-confirm")), 1.5, 2.0))
    out.append(("chime", 215.0, chime(rng_for("v7-fx-chime")), 5.0, 2.5))
    return out
