"""v7 DSP additions (numpy only): batched filters, a time-varying STFT filter, long convolution,
band-limited oscillators per note and a stereo bus. Built on dsp.py; nothing here reads audio files.
"""
import math

import numpy as np

from dsp import SR, saw_blep

DUR = 222.0
N = int(round(DUR * SR))


def mtof(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


def idx(t):
    return int(round(t * SR))


# ---------------------------------------------------------------- filters

def svf_batch(x, fc, q=0.707, mode="lp"):
    """Zavalishin state-variable filter run on many voices at once.

    x: (V, L) voices; fc: cutoff per sample, shape (V, L) or broadcastable. The Python loop runs
    over time, numpy runs over voices, so hundreds of notes cost about as much as one.
    """
    x = np.atleast_2d(np.asarray(x, dtype=float))
    V, L = x.shape
    out = np.empty((L, V))
    step = max(8, int(3e6 // max(L, 1)))
    for s in range(0, V, step):
        xs = x[s:s + step]
        v = xs.shape[0]
        f = np.clip(np.broadcast_to(np.asarray(fc, dtype=float), (V, L))[s:s + step], 10.0, SR * 0.45)
        g = np.tan(np.pi * f / SR)
        k = 1.0 / q
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        A1, A2, A3 = (np.ascontiguousarray(a.T) for a in (a1, a2, a3))
        X = np.ascontiguousarray(xs.T)
        o = out[:, s:s + v]
        ic1 = np.zeros(v)
        ic2 = np.zeros(v)
        for i in range(L):
            v3 = X[i] - ic2
            v1 = A1[i] * ic1 + A2[i] * v3
            v2 = ic2 + A2[i] * ic1 + A3[i] * v3
            ic1 = 2.0 * v1 - ic1
            ic2 = 2.0 * v2 - ic2
            if mode == "lp":
                o[i] = v2
            elif mode == "bp":
                o[i] = v1 * k
            else:
                o[i] = X[i] - k * v1 - v2
    return out.T


def fft_filter(x, mag_fn, pad=0.05):
    """Static zero-phase filter on a short buffer (any shape (..., n)); mag_fn(freqs) -> gain."""
    n = x.shape[-1]
    p = int(pad * SR)
    m = n + p
    spec = np.fft.rfft(x, m, axis=-1)
    f = np.fft.rfftfreq(m, 1 / SR)
    spec *= mag_fn(f)
    return np.fft.irfft(spec, m, axis=-1)[..., :n]


def lp_mag(fc, order=2):
    return lambda f: 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))


def hp_mag(fc, order=2):
    return lambda f: 1.0 / np.sqrt(1.0 + (fc / np.maximum(f, 1e-3)) ** (2 * order))


def bp_mag(fc, q):
    def m(f):
        f = np.maximum(f, 1e-3)
        return 1.0 / np.sqrt(1.0 + q * q * (f / fc - fc / f) ** 2)
    return m


def reso_lp(f, fc, q, order=4):
    """Magnitude of a resonant low-pass (Butterworth-like slope plus a resonant bump at fc)."""
    r = f / fc
    base = 1.0 / np.sqrt(1.0 + r ** (2 * order))
    bump = 1.0 + (q - 0.707) * np.exp(-((np.log2(np.maximum(r, 1e-6))) ** 2) / 0.08)
    return base * bump


def stft_filter(x, gain_fn, nfft=4096, hop=1024):
    """Time-varying zero-phase filter. x: (C, n). gain_fn(t (F,), f (K,)) -> (F, K) gains, where t is
    each frame's centre time in seconds. sqrt-Hann in and out, 75% overlap (sums to 2)."""
    x = np.atleast_2d(x)
    C, n = x.shape
    w = np.sqrt(0.5 - 0.5 * np.cos(2 * np.pi * np.arange(nfft) / nfft))
    pad = nfft
    xp = np.concatenate([np.zeros((C, pad)), x, np.zeros((C, pad))], axis=1)
    nfr = (xp.shape[1] - nfft) // hop + 1
    out = np.zeros_like(xp)
    f = np.fft.rfftfreq(nfft, 1 / SR)
    chunk = 2048
    for c0 in range(0, nfr, chunk):
        fr = np.arange(c0, min(nfr, c0 + chunk))
        starts = fr * hop
        tc = (starts + nfft / 2 - pad) / SR
        G = gain_fn(tc, f)
        ii = starts[:, None] + np.arange(nfft)[None, :]
        for ch in range(C):
            seg = xp[ch][ii] * w
            y = np.fft.irfft(np.fft.rfft(seg, axis=-1) * G, nfft, axis=-1) * w
            o = out[ch]
            for j, st in enumerate(starts):
                o[st:st + nfft] += y[j]
    return out[:, pad:pad + n] / 2.0


def convolve_long(x, ir, block=1 << 18):
    """Overlap-add FFT convolution of a long (C, n) signal with a (C, m) impulse response."""
    C, n = x.shape
    m = ir.shape[1]
    nfft = 1 << (block + m - 2).bit_length()
    H = np.fft.rfft(ir, nfft, axis=-1)
    out = np.zeros((C, n + m))
    for s in range(0, n, block):
        seg = x[:, s:s + block]
        L = seg.shape[1] + m - 1
        y = np.fft.irfft(np.fft.rfft(seg, nfft, axis=-1) * H, nfft, axis=-1)[:, :L]
        out[:, s:s + L] += y
    return out[:, :n]


def fft_hp_long(x, fc, order=2):
    n = x.shape[-1]
    spec = np.fft.rfft(x, axis=-1)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= hp_mag(fc, order)(f)
    return np.fft.irfft(spec, n, axis=-1)


def fft_lp_long(x, fc, order=2):
    n = x.shape[-1]
    spec = np.fft.rfft(x, axis=-1)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= lp_mag(fc, order)(f)
    return np.fft.irfft(spec, n, axis=-1)


# ---------------------------------------------------------------- oscillators

def saw(freq, n, rng):
    return saw_blep(freq, n, phase0=rng.random())


def pulse(freq, n, rng, width=0.5):
    """Band-limited pulse as the difference of two polyBLEP saws."""
    p0 = rng.random()
    return 0.5 * (saw_blep(freq, n, p0) - saw_blep(freq, n, (p0 + width) % 1.0))


def tri(freq, n, rng):
    """Band-limited triangle: a few odd harmonics (enough for soft leads and pulses)."""
    f = float(np.mean(freq)) if np.ndim(freq) else float(freq)
    ph = 2 * np.pi * (rng.random() + np.cumsum(np.broadcast_to(np.asarray(freq, dtype=float), (n,))) / SR)
    y = np.zeros(n)
    k = 1
    while k * f < SR * 0.45 and k <= 15:
        y += ((-1) ** ((k - 1) // 2)) * np.sin(k * ph) / (k * k)
        k += 2
    return y * (8 / np.pi ** 2)


def env_adsr(n, a, d, s, r, gate):
    """Linear-attack, exponential decay to sustain, exponential release after `gate` seconds."""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    rel = t > gate
    if rel.any():
        g0 = e[np.argmax(rel) - 1] if np.argmax(rel) > 0 else e[0]
        e = np.where(rel, g0 * np.exp(-(t - gate) / max(r, 1e-6)), e)
    k = min(n, int(0.004 * SR))
    e[-k:] *= np.linspace(1, 0, k)
    return e


# ---------------------------------------------------------------- bus

class Bus:
    """A stereo float32 buffer of the whole film with additive placement."""

    CUT = None      # (cut, resume): a sound that starts before `cut` is silenced from `cut` on

    def __init__(self, name):
        self.name = name
        self.x = np.zeros((2, N), dtype=np.float32)

    def add(self, st, t, gain=1.0, offset=0):
        st = np.atleast_2d(st)
        if st.shape[0] == 1:
            st = np.vstack([st, st])
        start = int(round(t * SR)) - offset
        if Bus.CUT is not None and t < Bus.CUT[0]:
            c = int(round(Bus.CUT[0] * SR)) - start
            if c < st.shape[1]:
                st = st[:, :max(c, 0)].copy()
                k = min(st.shape[1], int(0.008 * SR))
                if k:
                    st[:, -k:] *= np.linspace(1, 0, k)
        a, b = max(0, start), min(N, start + st.shape[1])
        if b > a:
            self.x[:, a:b] += (gain * st[:, a - start:b - start]).astype(np.float32)


def pan_st(mono, p):
    th = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.stack([mono * math.cos(th), mono * math.sin(th)])
