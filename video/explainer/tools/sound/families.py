"""Sound families. Each builder takes (cue, rng) and returns (stereo[2, n], hit) where
`hit` is the sample index inside the buffer that must land on the cue's `at` time.

Every builder draws its pitch, length, filter, noise colour and pan from the cue's own
random generator, so each instance is different but the family stays recognisable.
"""
import re

import numpy as np

from dsp import (SR, adsr_exp, coloured, damped, flatten, moving_pan, pan, rise_fall,
                 saw_blep, secs, sine, softclip, svf, time_axis, white)

# F major pentatonic, used for the faint pitch inside the text rises
PENTA = [349.23, 392.00, 440.00, 523.25, 587.33, 698.46, 783.99, 880.00]


def _index(cue_id):
    m = re.search(r"(\d+)(?:_\d+)?$", cue_id)
    return int(m.group(1)) if m else 0


# ------------------------------------------------------------------ whooshes

def swing(cue, r):
    """Whole-screen whip to the left: accelerating band-passed noise, peak on the cut,
    centre frequency sweeps up then falls, panned right -> left."""
    pre = secs(r.uniform(0.30, 0.36))
    post = secs(r.uniform(0.34, 0.48))
    n = pre + post
    env = rise_fall(pre, post, rise_pow=r.uniform(2.6, 3.4), tau_post=r.uniform(0.07, 0.11), tail_pow=0.9)
    src = coloured(r, n, r.uniform(-3.5, -1.0))
    f_lo, f_pk, f_end = r.uniform(280, 420), r.uniform(1500, 2400), r.uniform(450, 750)
    s = np.arange(n)
    fc = np.where(s < pre, f_lo * (f_pk / f_lo) ** ((s / pre) ** 2.2),
                  f_pk * (f_end / f_pk) ** np.clip((s - pre) / (post * 0.6), 0, 1))
    body = svf(src, fc, r.uniform(1.1, 1.6), "bp")
    air = svf(coloured(r, n, 0.0), fc * r.uniform(2.6, 3.4), 2.5, "bp") * r.uniform(0.25, 0.4)
    low = svf(coloured(r, n, -6.0), fc * 0.18, 0.9, "lp") * r.uniform(0.35, 0.55)
    mono = flatten(body + air + low) * env
    curve = 0.5 - 0.5 * np.cos(np.pi * np.clip(s / n * 1.15, 0, 1))
    st = moving_pan(mono, r.uniform(0.65, 0.85), -r.uniform(0.65, 0.85), curve, haas_ms=0.45)
    return st, pre


def cam(cue, r):
    """Gentle camera glide: a soft, low, short puff of air."""
    pre = secs(r.uniform(0.14, 0.2))
    post = secs(r.uniform(0.22, 0.32))
    n = pre + post
    env = rise_fall(pre, post, rise_pow=2.0, tau_post=r.uniform(0.08, 0.12))
    src = coloured(r, n, r.uniform(-5.0, -3.0))
    f0 = r.uniform(380, 620)
    s = np.arange(n) / n
    fc = f0 * (1 + 0.6 * np.sin(np.pi * s))
    mono = flatten(svf(svf(src, fc, r.uniform(0.7, 1.0), "bp"), 2200.0, 0.7, "lp")) * env
    d = r.choice([-1, 1])
    p0 = r.uniform(-0.2, 0.2)
    return moving_pan(mono, p0 - 0.25 * d, p0 + 0.25 * d, haas_ms=0.2), pre


def line(cue, r):
    """A line of text rises into place: airy high noise rising upwards, with a faint pitched glide."""
    idx = _index(cue["id"])
    pre = secs(r.uniform(0.10, 0.14))
    post = secs(r.uniform(0.16, 0.24))
    n = pre + post
    env = rise_fall(pre, post, rise_pow=2.2, tau_post=r.uniform(0.05, 0.08))
    s = np.arange(n) / n
    f0 = r.uniform(1400, 2000)
    fc = f0 * (1 + r.uniform(1.2, 1.8) * s)
    air = svf(coloured(r, n, r.uniform(0.0, 2.0)), fc, r.uniform(2.0, 3.0), "bp")
    note = PENTA[(idx * 2 + int(r.integers(0, 2))) % len(PENTA)]
    glide = note * 2 ** (r.uniform(-4, -2) / 12 * (1 - np.clip(s * n / pre, 0, 1)))
    tone = sine(glide, n) * adsr_exp(n, pre / SR, 0.06) * r.uniform(0.10, 0.16)
    mono = flatten(air) * env * 0.3 + tone
    return pan(mono, r.uniform(-0.25, 0.25)), pre


def small_motion(cue, r):
    """Small object / highlight motions inside the demos."""
    cid = cue["id"]
    if "stack-rows" in cid:
        # rows riffle into a stack: three quick soft flaps, first one on the beat
        n = secs(0.5)
        out = np.zeros(n)
        t = 0
        for k in range(4):
            m = secs(0.09)
            e = adsr_exp(m, 0.002, r.uniform(0.018, 0.03))
            flap = svf(coloured(r, m, -2.0), r.uniform(900, 1400) * (1 + 0.15 * k), 1.4, "bp") * e
            out[t:t + m] += flap * (0.85 ** k)
            t += secs(r.uniform(0.055, 0.08))
        return moving_pan(out, -0.3, 0.3), 0
    if "res-bars" in cid:
        # bars grow upward: rising filtered saw + noise, peaking on the beat
        pre, post = secs(0.22), secs(0.2)
        n = pre + post
        s = np.arange(n)
        f = r.uniform(150, 190) * 2 ** (np.clip(s / pre, 0, 1) * r.uniform(0.9, 1.2))
        tone = svf(saw_blep(f, n), f * 4, 0.8, "lp")
        nz = svf(coloured(r, n, -1.0), f * 8, 2.0, "bp") * 0.5
        env = rise_fall(pre, post, rise_pow=2.0, tau_post=0.05)
        return pan((tone * 0.5 + nz) * env, r.uniform(-0.3, 0.3)), pre
    if "-hl-" in cid:
        # highlight sweeps across a line: bright shimmer moving left -> right plus a soft glass ping
        pre, post = secs(0.08), secs(0.28)
        n = pre + post
        s = np.arange(n) / n
        nz = flatten(svf(coloured(r, n, 1.5), 3500 + 3000 * s, 3.0, "bp")) * 0.3
        env = rise_fall(pre, post, rise_pow=1.5, tau_post=0.07)
        ping_f = r.choice([1396.9, 1568.0, 1760.0, 2093.0])
        ping = np.zeros(n)
        ping[pre:] = damped(ping_f, post, r.uniform(0.06, 0.1)) + 0.4 * damped(ping_f * 2.76, post, 0.03)
        mono = nz * env * 0.8 + ping * 0.35
        return moving_pan(mono, -0.45, 0.45, haas_ms=0.2), pre
    if "cursor-move" in cid:
        # the cursor slides across: a soft, slightly longer low slide moving right
        pre, post = secs(0.012), secs(0.42)
        n = pre + post
        s = np.arange(n) / n
        fc = 500 + 500 * np.sin(np.pi * s)
        mono = flatten(svf(coloured(r, n, -4.0), fc, 1.2, "bp")) * rise_fall(pre, post, 1.0, 0.16, 1.0) * 0.5
        return moving_pan(mono, -0.4, 0.5), pre
    # punch-ins (a panel zooms toward camera): short downward whoosh with a soft low knock
    pre, post = secs(r.uniform(0.07, 0.1)), secs(r.uniform(0.2, 0.28))
    n = pre + post
    s = np.arange(n)
    fc = np.where(s < pre, 900 + 900 * s / pre, 1800 * (300 / 1800) ** np.clip((s - pre) / post, 0, 1))
    nz = flatten(svf(coloured(r, n, -2.0), fc, 1.3, "bp")) * rise_fall(pre, post, 3.0, 0.06) * 0.4
    knock = np.zeros(n)
    f = r.uniform(110, 150) * 2 ** (-time_axis(post) * 6)
    knock[pre:] = sine(f, post) * adsr_exp(post, 0.001, 0.05)
    return pan(nz + knock * 0.6, r.uniform(-0.2, 0.2)), pre


# ------------------------------------------------------------------ percussive

def _tick(r, f_res, tau, bright=1.0):
    """One mechanical transient: a 2 ms noise burst into two damped resonances."""
    n = secs(tau * 6 + 0.01)
    burst = white(r, n) * adsr_exp(n, 0.0002, 0.0012)
    burst = svf(burst, f_res * 1.3, 0.8, "hp" if bright > 0.5 else "bp")
    body = damped(f_res, n, tau) + 0.5 * damped(f_res * r.uniform(1.9, 2.4), n, tau * 0.6)
    return burst * 0.9 * bright + body * 0.5


def click(cue, r):
    """UI mouse click: press transient on the beat, a lighter release 40-70 ms later."""
    cid = cue["id"]
    n = secs(0.16)
    out = np.zeros(n)
    f = r.uniform(2800, 3800)
    if "lock" in cid:
        f = r.uniform(1500, 1800)  # a latch: lower and more metallic
    press = _tick(r, f, r.uniform(0.004, 0.006))
    thump = sine(r.uniform(160, 220), secs(0.02)) * adsr_exp(secs(0.02), 0.0005, 0.006)
    out[:len(press)] += press
    out[:len(thump)] += thump * 0.5
    rel_at = secs(r.uniform(0.04, 0.07))
    rel = _tick(r, f * r.uniform(1.1, 1.25), 0.003) * r.uniform(0.35, 0.5)
    m = min(len(rel), n - rel_at)
    out[rel_at:rel_at + m] += rel[:m]
    if "lock" in cid:
        ring = damped(r.uniform(2400, 2600), n, 0.05) * 0.18 + damped(3710, n, 0.03) * 0.1
        out += ring
    if "cursor-in" in cid:
        out *= 0.6
    return pan(out, r.uniform(-0.25, 0.25)), 0


def key(cue, r, soft=1.0):
    """A soft mechanical key tick (one key)."""
    n = secs(0.07)
    out = np.zeros(n)
    t = _tick(r, r.uniform(1700, 2600), r.uniform(0.003, 0.005), bright=r.uniform(0.4, 0.8))
    out[:len(t)] += t[:n]
    bott = sine(r.uniform(240, 320), secs(0.03)) * adsr_exp(secs(0.03), 0.0005, 0.008)
    out[secs(0.004):secs(0.004) + len(bott)] += bott * 0.35
    if "answer" in cue["id"]:
        # the answer row: a double tick, second slightly higher
        t2 = _tick(r, 2900, 0.004, 0.6) * 0.6
        o = secs(0.045)
        out[o:o + min(len(t2), n - o)] += t2[:n - o]
    return pan(out * soft, r.uniform(-0.3, 0.3)), 0


def typing(cue, r):
    """1.5 s of irregular key clicks, first one on the beat."""
    n = secs(1.6)
    out = np.zeros((2, n))
    t = 0.0
    while t < 1.5:
        sub = dict(cue, id=f"{cue['id']}#{t:.3f}")
        k, _ = key(sub, r, soft=r.uniform(0.55, 1.0) * (1.0 if t > 0 else 1.15))
        if r.random() < 0.08:  # occasional space bar: lower and longer
            k = k * 0.8
            low = svf(k[0], 900, 1.0, "lp") * 1.4
            k = np.stack([low, low])
        i = secs(t)
        m = min(k.shape[1], n - i)
        out[:, i:i + m] += k[:, :m]
        gap = r.gamma(3.0, 0.03)
        if r.random() < 0.1:
            gap += r.uniform(0.12, 0.22)  # a little pause, like a real typist
        t += max(gap, 0.045)
    return out, 0


def thud(cue, r):
    """A tag or badge slams in: pitched sine drop with a short noise transient."""
    cid = cue["id"]
    if "break" in cid:
        return crack(cue, r)
    n = secs(r.uniform(0.35, 0.45))
    t = time_axis(n)
    f0, f1 = r.uniform(95, 130), r.uniform(42, 55)
    f = f1 + (f0 - f1) * np.exp(-t / r.uniform(0.03, 0.05))
    body = sine(f, n) * adsr_exp(n, 0.0015, r.uniform(0.09, 0.13))
    click_n = svf(coloured(r, n, -2.0), r.uniform(1200, 2000), 0.9, "bp") * adsr_exp(n, 0.0005, 0.006)
    mid = svf(coloured(r, n, -3.0), 350, 1.0, "lp") * adsr_exp(n, 0.001, 0.03)
    mono = softclip(body * 1.2, 1.6) + click_n * 0.5 + mid * 0.5
    if "stack-key" in cid:
        # a key lands: add a small metallic clink on top of the thump
        for ratio, a, tau in ((1.0, 0.25, 0.12), (2.32, 0.15, 0.07), (4.25, 0.08, 0.04)):
            mono += damped(1750 * ratio, n, tau) * a
    return pan(mono, r.uniform(-0.15, 0.15)), 0


def crack(cue, r):
    """A shield breaks: a sharp crack, a scatter of crackles and a short low thump."""
    n = secs(0.9)
    out = np.zeros(n)
    # initial snap
    snap = svf(white(r, n), 3200, 0.7, "hp") * adsr_exp(n, 0.0002, 0.004)
    out += snap * 1.2
    # crackle: a decaying shower of tiny impulses through resonances
    t = 0.0
    while t < 0.55:
        i = secs(t)
        tk = _tick(r, r.uniform(2000, 6000), 0.0015)
        m = len(tk)
        if i + m >= n:
            break
        g = np.exp(-t / 0.16) * r.uniform(0.3, 1.0)
        out[i:i + m] += tk * g
        t += r.exponential(0.018) + 0.003
    # body thump
    tt = time_axis(n)
    f = 45 + 70 * np.exp(-tt / 0.04)
    out += sine(f, n) * adsr_exp(n, 0.001, 0.1) * 0.9
    # debris hiss
    out += svf(coloured(r, n, 0.0), 4500, 0.8, "bp") * adsr_exp(n, 0.002, 0.12) * 0.25
    return moving_pan(out, -0.1, 0.25, haas_ms=0.3), 0


def impact(cue, r):
    """The two halves join: a swell that rises into a deep hit on the beat."""
    pre, post = secs(0.9), secs(2.6)
    n = pre + post
    s = np.arange(n)
    # swell: rising band of noise + rising low tone (reverse-shaped)
    sw_env = np.where(s < pre, (s / pre) ** 3.5, np.exp(-(s - pre) / (0.02 * SR)))
    fc = np.where(s < pre, 200 * (1500 / 200) ** (s / pre), 1500)
    swell = svf(coloured(r, n, -2.5), fc, 1.2, "bp") * sw_env * 0.12
    tone_f = np.where(s < pre, 55 * 2 ** (s / pre), 110)
    swell += sine(tone_f, n) * sw_env * 0.35
    # hit
    hit = np.zeros(n)
    m = post
    t = time_axis(m)
    f = 38 + 62 * np.exp(-t / 0.06)
    hit[pre:] += softclip(sine(f, m) * adsr_exp(m, 0.002, 0.55), 1.3) * 1.0
    hit[pre:] += svf(coloured(r, m, -1.5), 900, 0.8, "lp") * adsr_exp(m, 0.0007, 0.05) * 0.6
    # warm body: F2 root and C3 fifth ringing under it
    for fr, a, tau in ((87.31, 0.30, 0.9), (130.81, 0.16, 0.7), (174.61, 0.10, 0.5)):
        hit[pre:] += sine(fr * (1 + 0.002 * r.standard_normal()), m) * adsr_exp(m, 0.004, tau) * a
    mono = swell + hit
    # widen: slightly different short delays on each side for the body only
    left = mono + 0.12 * np.roll(hit, secs(0.011))
    right = mono + 0.12 * np.roll(hit, secs(0.017))
    return np.stack([left, right]) * 0.7, pre


def chime(cue, r):
    """The brand mark: a warm bell from inharmonic partials with exponential decays."""
    n = secs(5.0)
    f0 = 523.25  # C5; partials make an F-major-friendly bell
    # (ratio, amp, decay s): hum, prime, tierce, quint, nominal, upper partials
    partials = [(0.5, 0.35, 3.2), (1.0, 0.6, 2.4), (1.19, 0.28, 1.6), (1.5, 0.22, 1.4),
                (2.0, 0.42, 1.3), (2.51, 0.16, 0.8), (2.66, 0.12, 0.7), (3.01, 0.1, 0.55),
                (4.16, 0.06, 0.35), (5.43, 0.04, 0.22)]
    left = np.zeros(n)
    right = np.zeros(n)
    for i, (ratio, a, tau) in enumerate(partials):
        f = f0 * ratio
        beat = r.uniform(0.4, 1.6)  # paired partials slightly apart for a slow shimmer
        ph = r.uniform(0, 2 * np.pi)
        e = adsr_exp(n, 0.002, tau, end_fade=0.2)
        left += np.sin(2 * np.pi * (f - beat / 2) * time_axis(n) + ph) * e * a
        right += np.sin(2 * np.pi * (f + beat / 2) * time_axis(n) + ph) * e * a
    strike = svf(white(r, n), 3000, 1.0, "bp") * adsr_exp(n, 0.0003, 0.004) * 0.25
    return np.stack([left + strike, right + strike]) * 0.6, 0



# ------------------------------------------------------------------ v6: tonal, no air noise

def _mallet(f, n, r, bright=1.0):
    """A soft wooden mallet note: fundamental, a quiet octave and a marimba-like 4x partial."""
    t = time_axis(n)
    tau = r.uniform(0.18, 0.3) * (440.0 / f) ** 0.3
    body = damped(f, n, tau) + 0.18 * damped(f * 2.0, n, tau * 0.5) + 0.08 * bright * damped(f * 3.93, n, tau * 0.18)
    att = np.minimum(t / 0.003, 1.0)
    felt = svf(white(r, n), f * 3, 1.5, "bp") * adsr_exp(n, 0.0003, 0.003) * 0.15
    return (body * att + felt)


def pluck(cue, r):
    """A text line lands: one soft mallet note from the current chord (cue['note'] in MIDI)."""
    f = 440.0 * 2 ** ((cue["note"] - 69) / 12)
    n = secs(0.9)
    mono = _mallet(f, n, r, bright=r.uniform(0.6, 1.0))
    return pan(mono, r.uniform(-0.35, 0.35)), 0


def bloom(cue, r):
    """A scene cut: a warm low chord tone that swells in just before the cut and rings out."""
    root = 440.0 * 2 ** ((cue["note"] - 69) / 12)
    pre, post = secs(0.06), secs(1.4)
    n = pre + post
    out = np.zeros(n)
    tt = time_axis(post)
    for ratio, a, tau in ((1.0, 0.55, 0.55), (1.5, 0.22, 0.4), (2.0, 0.2, 0.35), (3.0, 0.06, 0.2)):
        out[pre:] += sine(root * ratio * (1 + 0.001 * r.standard_normal()), post) * adsr_exp(post, 0.012, tau) * a
    out[:pre] += sine(root, pre) * np.linspace(0, 0.2, pre)
    f = 60 + 50 * np.exp(-tt / 0.03)
    out[pre:] += sine(f, post) * adsr_exp(post, 0.001, 0.07) * 0.45   # soft felt knock on the cut
    left = out + 0.1 * np.roll(out, secs(0.009))
    right = out + 0.1 * np.roll(out, secs(0.014))
    return np.stack([left, right]) * 0.8, pre


def motion_v6(cue, r):
    """Small demo motions without air noise."""
    cid = cue["id"]
    if "stack-rows" in cid:
        # rows riffle into a stack: three quick rising mallet notes
        n = secs(0.8)
        out = np.zeros(n)
        base = cue["note"]
        for k, step in enumerate((0, 4, 7)):
            i = secs(0.07 * k)
            m = n - i
            out[i:] += _mallet(440.0 * 2 ** ((base + step - 69) / 12), m, r, 0.7)[:m] * (0.9 ** k)
        return moving_pan(out, -0.3, 0.3), 0
    if "-hl-" in cid:
        # highlight lands on a line: a soft glass ping only
        n = secs(0.6)
        ping_f = r.choice([1396.9, 1568.0, 1760.0, 2093.0])
        mono = damped(ping_f, n, r.uniform(0.08, 0.12)) + 0.3 * damped(ping_f * 2.76, n, 0.03)
        return pan(mono * 0.35, r.uniform(-0.4, 0.4)), 0
    if "res-bars" in cid:
        st, hit = small_motion(cue, r)
        return st, hit
    # punch-in: just the soft low knock, no whoosh
    n = secs(0.3)
    f = r.uniform(110, 150) * 2 ** (-time_axis(n) * 6)
    return pan(sine(f, n) * adsr_exp(n, 0.001, 0.05) * 0.6, r.uniform(-0.2, 0.2)), 0


# ------------------------------------------------------------------ routing

def family_of(cue):
    cid, kind = cue["id"], cue["kind"]
    if kind == "swish":
        if cid.startswith("sfx-swing"):
            return "bloom"
        if cid.startswith("sfx3-cam"):
            return "cam"          # v6: dropped (see synth.select_cues)
        if cid.startswith("sfx2-line"):
            return "pluck"
        if "cursor-move" in cid:
            return "cursor"       # v6: dropped
        return "motion6"
    if kind == "thud" and "break" in cid:
        return "crack"
    return kind


BUILDERS = {
    "swing": swing, "cam": cam, "line": line, "motion": small_motion,
    "click": click, "key": key, "typing": typing, "thud": thud, "crack": crack,
    "impact": impact, "chime": chime,
    "pluck": pluck, "bloom": bloom, "motion6": motion_v6,
}

# loudness of each family before the final trim: loudest 100 ms K-weighted window (LUFS-like)
LEVEL_DB = {
    "swing": -11.5, "cam": -18.0, "line": -15.0, "motion": -15.0,
    "click": -20.0, "key": -21.0, "typing": -21.0, "thud": -12.5, "crack": -12.5,
    "impact": -8.5, "chime": -11.5,
    "pluck": -19.0, "bloom": -14.0, "motion6": -17.0,
}
# sample-peak ceiling of each family before the final trim (dBFS): keeps sharp transients in check
PEAK_CAP_DB = {
    "swing": -3.0, "cam": -11.0, "line": -8.5, "motion": -8.0,
    "click": -8.0, "key": -11.0, "typing": -10.0, "thud": -4.0, "crack": -5.0,
    "impact": -2.5, "chime": -4.5,
    "pluck": -10.0, "bloom": -5.0, "motion6": -9.0,
}
