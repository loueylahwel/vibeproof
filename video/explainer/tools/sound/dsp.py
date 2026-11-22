"""Small DSP toolkit for the explainer soundtrack. numpy + standard library only.

Everything here is generated from maths: oscillators, noise, filters, envelopes and panning.
No samples, no audio files.
"""
import hashlib
import math

import numpy as np

SR = 48000


def rng_for(cue_id, salt=""):
    """A numpy Generator seeded from the cue id, so every run gives the same sound."""
    h = hashlib.sha256((cue_id + "|" + salt).encode()).digest()
    return np.random.default_rng(int.from_bytes(h[:8], "little"))


def secs(n):
    return int(round(n * SR))


def time_axis(n):
    return np.arange(n) / SR


# ---------------------------------------------------------------- noise

def white(rng, n):
    return rng.standard_normal(n)


def coloured(rng, n, slope_db_per_oct):
    """Noise with a spectral tilt: 0 = white, -3 = pink, -6 = brown, +3 = blue."""
    x = rng.standard_normal(n)
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1] if n > 1 else 1.0
    spec *= (f / 1000.0) ** (slope_db_per_oct / 6.0206)
    y = np.fft.irfft(spec, n)
    return y / (np.std(y) + 1e-12)


# ---------------------------------------------------------------- filters

def svf(x, fc, q, mode="bp"):
    """Topology-preserving state-variable filter (Zavalishin). fc may be an array (sweeps).

    mode: 'bp' (unity peak band-pass), 'lp', 'hp'.
    """
    n = len(x)
    fc = np.broadcast_to(np.asarray(fc, dtype=float), (n,))
    fc = np.clip(fc, 10.0, SR * 0.45)
    g = np.tan(np.pi * fc / SR)
    k = 1.0 / q
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    xs = x.tolist()
    a1l, a2l, a3l = a1.tolist(), a2.tolist(), a3.tolist()
    out = [0.0] * n
    ic1 = ic2 = 0.0
    if mode == "bp":
        for i in range(n):
            v3 = xs[i] - ic2
            v1 = a1l[i] * ic1 + a2l[i] * v3
            v2 = ic2 + a2l[i] * ic1 + a3l[i] * v3
            ic1 = 2 * v1 - ic1
            ic2 = 2 * v2 - ic2
            out[i] = v1
        return np.asarray(out) * k
    if mode == "lp":
        for i in range(n):
            v3 = xs[i] - ic2
            v1 = a1l[i] * ic1 + a2l[i] * v3
            v2 = ic2 + a2l[i] * ic1 + a3l[i] * v3
            ic1 = 2 * v1 - ic1
            ic2 = 2 * v2 - ic2
            out[i] = v2
        return np.asarray(out)
    for i in range(n):  # hp
        v3 = xs[i] - ic2
        v1 = a1l[i] * ic1 + a2l[i] * v3
        v2 = ic2 + a2l[i] * ic1 + a3l[i] * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        out[i] = xs[i] - k * v1 - v2
    return np.asarray(out)


def onepole_lp(x, fc):
    a = math.exp(-2 * math.pi * fc / SR)
    out = [0.0] * len(x)
    y = 0.0
    for i, v in enumerate(x.tolist()):
        y = (1 - a) * v + a * y
        out[i] = y
    return np.asarray(out)


def fft_lowpass(x, fc, order=2):
    """Zero-phase Butterworth-magnitude low-pass in the frequency domain (for long, smooth signals)."""
    n = x.shape[-1]
    spec = np.fft.rfft(x, axis=-1)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))
    return np.fft.irfft(spec, n, axis=-1)


def fft_highpass(x, fc, order=2):
    n = x.shape[-1]
    spec = np.fft.rfft(x, axis=-1)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = 1e-6
    spec *= 1.0 / np.sqrt(1.0 + (fc / f) ** (2 * order))
    return np.fft.irfft(spec, n, axis=-1)


# ---------------------------------------------------------------- oscillators

def phase_from_freq(freq, n, phase0=0.0):
    """Cumulative phase in cycles for an instantaneous frequency (scalar or array)."""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return phase0 + np.cumsum(f) / SR


def sine(freq, n, phase0=0.0):
    return np.sin(2 * np.pi * phase_from_freq(freq, n, phase0))


def saw_blep(freq, n, phase0=0.0):
    """Band-limited sawtooth (polyBLEP), vectorised."""
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    dt = f / SR
    ph = np.mod(phase0 + np.cumsum(dt), 1.0)
    y = 2.0 * ph - 1.0
    m = ph < dt
    t = ph[m] / dt[m]
    y[m] -= t + t - t * t - 1.0
    m = ph > 1.0 - dt
    t = (ph[m] - 1.0) / dt[m]
    y[m] -= t * t + t + t + 1.0
    return y


def damped(freq, n, tau, phase0=0.0):
    """Exponentially decaying sine (a struck resonance)."""
    t = time_axis(n)
    return np.sin(2 * np.pi * freq * t + phase0) * np.exp(-t / tau)


# ---------------------------------------------------------------- envelopes and space

def rise_fall(n_pre, n_post, rise_pow=3.0, tau_post=0.1, tail_pow=1.0):
    """Envelope that grows as a power curve for n_pre samples, peaks, then decays exponentially."""
    up = (np.arange(n_pre) / max(n_pre, 1)) ** rise_pow
    t = np.arange(n_post) / SR
    down = np.exp(-((t / tau_post) ** tail_pow))
    fade = np.ones(n_post)
    k = min(n_post, secs(0.02))
    fade[-k:] = np.linspace(1, 0, k)
    return np.concatenate([up, down * fade])


def adsr_exp(n, attack, tau, end_fade=0.01):
    t = time_axis(n)
    a = np.clip(t / max(attack, 1e-6), 0, 1)
    a = np.sin(a * np.pi / 2) ** 2
    e = a * np.exp(-np.maximum(t - attack, 0) / tau)
    k = min(n, secs(end_fade))
    if k > 0:
        e[-k:] *= np.linspace(1, 0, k)
    return e


def pan(mono, p):
    """Constant-power pan. p in [-1 (left), +1 (right)], scalar or per-sample array."""
    p = np.broadcast_to(np.asarray(p, dtype=float), mono.shape)
    th = (p + 1) * np.pi / 4
    return np.stack([mono * np.cos(th), mono * np.sin(th)])


def frac_delay(x, d_samples):
    """Per-sample fractional delay (linear interpolation); d can be an array."""
    n = len(x)
    idx = np.arange(n) - np.broadcast_to(np.asarray(d_samples, dtype=float), (n,))
    i0 = np.floor(idx).astype(int)
    fr = idx - i0
    i0c = np.clip(i0, 0, n - 1)
    i1c = np.clip(i0 + 1, 0, n - 1)
    y = x[i0c] * (1 - fr) + x[i1c] * fr
    y[idx < 0] = 0.0
    return y


def moving_pan(mono, p_start, p_end, curve=None, haas_ms=0.35):
    """Pan that travels from p_start to p_end, with a small interaural delay that follows it."""
    n = len(mono)
    s = np.linspace(0, 1, n) if curve is None else curve
    p = p_start + (p_end - p_start) * s
    st = pan(mono, p)
    d = np.abs(p) * haas_ms * 1e-3 * SR
    # delay the far ear: for p > 0 (right) delay the left channel
    left = frac_delay(st[0], np.where(p > 0, d, 0.0))
    right = frac_delay(st[1], np.where(p < 0, d, 0.0))
    return np.stack([left, right])


def flatten(x, ms=5.0):
    """Divide out the random short-term level of filtered noise so the designed envelope
    (and its peak on the beat) is exactly what you hear."""
    w = max(1, int(ms * 1e-3 * SR))
    c = np.concatenate([[0.0], np.cumsum(x * x)])
    e = np.sqrt(np.maximum((c[w:] - c[:-w]) / w, 0))
    h = w // 2
    e = np.concatenate([np.full(h, e[0]), e, np.full(w - 1 - h, e[-1])])
    y = x / (e + 0.05 * np.mean(e) + 1e-12)
    return 2.2 * np.tanh(y / 2.2)  # trims the rare noise spikes so peaks follow the envelope


def softclip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def norm_peak(x, peak=1.0):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def room_ir(rng, seconds=2.0, tau=0.28, predelay=0.012, damp_hz=3500.0):
    """A synthetic stereo room: decorrelated noise with an exponential decay that also
    darkens over time (two bands with different decay rates)."""
    n = secs(seconds)
    t = time_axis(n)
    ir = np.zeros((2, n))
    for ch in range(2):
        nz = rng.standard_normal(n)
        lo = fft_lowpass(nz, damp_hz, order=1)
        hi = nz - lo
        ir[ch] = lo * np.exp(-t / tau) + 0.5 * hi * np.exp(-t / (tau * 0.4))
    ir *= np.minimum(t / 0.01, 1.0)  # soft onset
    d = secs(predelay)
    ir = np.concatenate([np.zeros((2, d)), ir[:, :n - d]], axis=1)
    return ir / np.sqrt((ir ** 2).sum(axis=1, keepdims=True))


def convolve(x, ir):
    """FFT convolution of a stereo signal with a stereo impulse response, same length as x."""
    n = x.shape[1] + ir.shape[1] - 1
    nfft = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, nfft, axis=-1)
    H = np.fft.rfft(ir, nfft, axis=-1)
    return np.fft.irfft(X * H, nfft, axis=-1)[:, :x.shape[1]]
