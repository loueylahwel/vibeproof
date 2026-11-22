"""Loudness (ITU-R BS.1770 K-weighting, gated integrated loudness) and true-peak estimates."""
import numpy as np

from dsp import SR

# BS.1770 K-weighting biquads at 48 kHz
_K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
_K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def _biquad_mag2(b, a, f):
    z = np.exp(-2j * np.pi * f / SR)
    num = b[0] + b[1] * z + b[2] * z * z
    den = a[0] + a[1] * z + a[2] * z * z
    return np.abs(num / den) ** 2


def k_weight(x):
    """K-weighted signal (magnitude applied in the frequency domain; energy is what matters)."""
    x = np.atleast_2d(x)
    n = x.shape[-1]
    pad = n + 4096
    spec = np.fft.rfft(x, pad, axis=-1)
    f = np.fft.rfftfreq(pad, 1 / SR)
    spec *= np.sqrt(_biquad_mag2(*_K1, f) * _biquad_mag2(*_K2, f))
    return np.fft.irfft(spec, pad, axis=-1)[:, :n]


def block_loudness(x, win=0.4, hop=0.1):
    y = k_weight(x)
    w, h = int(win * SR), int(hop * SR)
    p = np.concatenate([np.zeros((y.shape[0], 1)), np.cumsum(y * y, axis=-1)], axis=-1)
    starts = np.arange(0, y.shape[-1] - w + 1, h)
    ms = (p[:, starts + w] - p[:, starts]) / w
    return -0.691 + 10 * np.log10(ms.sum(axis=0) + 1e-20), starts


def integrated(x):
    lk, _ = block_loudness(x)
    g = lk[lk > -70]
    if len(g) == 0:
        return -np.inf
    rel = -0.691 + 10 * np.log10(np.mean(10 ** ((g + 0.691) / 10))) - 10
    g = g[g > rel]
    return -0.691 + 10 * np.log10(np.mean(10 ** ((g + 0.691) / 10)))


def max_short_window(x, win=0.1):
    """Loudest K-weighted window of `win` seconds (used to level each sound against its family)."""
    y = k_weight(x)
    w = max(1, int(win * SR))
    e = (y * y).sum(axis=0)
    if len(e) < w:
        e = np.pad(e, (0, w - len(e)))
    c = np.concatenate([[0.0], np.cumsum(e)])
    return -0.691 + 10 * np.log10(np.max(c[w:] - c[:-w]) / w + 1e-20)


def oversampled_abs(x, factor=4, chunk=SR):
    """|x| at `factor` times the sample rate (FFT interpolation in overlapping chunks), per channel."""
    x = np.atleast_2d(x)
    n = x.shape[-1]
    pad = 256
    out = np.zeros((x.shape[0], n * factor), dtype=np.float32)
    for s in range(0, n, chunk):
        a, b = max(0, s - pad), min(n, s + chunk + pad)
        seg = x[:, a:b]
        m = seg.shape[-1]
        win = np.ones(m)
        spec = np.fft.rfft(seg * win, axis=-1)
        up = np.fft.irfft(spec, m * factor, axis=-1) * factor
        lo = (s - a) * factor
        hi = lo + (min(s + chunk, n) - s) * factor
        out[:, s * factor:min(s + chunk, n) * factor] = np.abs(up[:, lo:hi])
    return out


def true_peak_db(x):
    return 20 * np.log10(np.max(oversampled_abs(x)) + 1e-20)
