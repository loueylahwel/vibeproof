"""v7 instruments: every drum hit, bass note, pad chord, arp, lead and bell made from oscillators,
noise and filters. Each function places its notes on a Bus (see v7_dsp.Bus)."""
import math

import numpy as np

from dsp import SR, rng_for
from v7_dsp import (bp_mag, env_adsr, fft_filter, hp_mag, lp_mag, mtof, pan_st, pulse,
                    reso_lp, saw, stft_filter, svf_batch, tri)
from v7_score import BEAT, CHORD, DROP, GAP, PROG, S16, scene_at, pad_voicings


def _t(n):
    return np.arange(n) / SR


def _attack(x, ms=1.0):
    k = max(1, int(ms * 1e-3 * SR))
    x[:k] *= np.linspace(0, 1, k)
    return x


# ================================================================ drums

def kick(v, r, soft=False, drop=False):
    L = 1.6 if drop else 0.55
    n = int(L * SR)
    t = _t(n)
    fs = r.uniform(160, 185) * (0.9 if soft else 1.0)
    fe = 43.65 if drop else 51.9
    tau_p = 0.032 if not drop else 0.05
    f = fe + (fs - fe) * np.exp(-t / tau_p)
    ph = 2 * np.pi * np.cumsum(f) / SR
    tau = 0.15 if soft else (0.55 if drop else 0.16) * r.uniform(0.92, 1.08)
    body = np.sin(ph) * np.exp(-t / tau)
    if drop:
        body += 0.35 * np.sin(2 * ph) * np.exp(-t / 0.08)
    click = fft_filter(r.standard_normal(n), hp_mag(2500 + 800 * r.random(), 2)) * np.exp(-t / 0.0025)
    x = body + (0.08 if soft else 0.22) * v * click
    x = np.tanh(1.7 * x) / np.tanh(1.7)
    return _attack(x, 0.6) * v


def clap(v, r, ghost=False):
    n = int(0.45 * SR)
    t = _t(n)
    nz = fft_filter(r.standard_normal(n), bp_mag(r.uniform(1050, 1350), 1.3))
    nz = fft_filter(nz, hp_mag(550, 2))
    nz /= np.std(nz) + 1e-9
    env = np.zeros(n)
    offs = [0.0, 0.0085 + 0.002 * r.random(), 0.018 + 0.003 * r.random()]
    for i, o in enumerate(offs):
        m = t >= o
        env[m] += (1.0 - 0.15 * i) * np.exp(-(t[m] - o) / 0.0045)
    o = offs[-1] + 0.004
    m = t >= o
    env[m] += 0.75 * np.exp(-(t[m] - o) / (0.07 if ghost else r.uniform(0.08, 0.1)))
    x = nz * env * 0.32 * v
    return _attack(x, 0.3)


def snare(v, r, pitch=1.0, soft=False, roll=False):
    n = int(0.4 * SR)
    t = _t(n)
    nz = fft_filter(r.standard_normal(n), bp_mag(2600 * pitch, 0.7))
    nz += 0.4 * fft_filter(r.standard_normal(n), hp_mag(5000, 2))
    if soft:
        nz = fft_filter(nz, lp_mag(3500, 2))
    nz /= np.std(nz) + 1e-9
    dec = 0.07 if roll else (0.13 if not soft else 0.1)
    noise = nz * np.exp(-t / dec)
    f0 = 185 * pitch
    f = f0 * (1 + 0.35 * np.exp(-t / 0.012))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05)
    tone += 0.45 * np.sin(2 * np.pi * np.cumsum(f * 1.78) / SR) * np.exp(-t / 0.03)
    x = (0.28 * noise + 0.45 * tone) * v
    return _attack(x, 0.4)


_HAT_PARTIALS = np.array([3470.0, 5110, 6290, 7760, 9120, 10640])


def hat(v, r, bright=0.0, open_=False, length=None):
    L = length or (0.75 if open_ else 0.16)
    n = int(L * SR)
    t = _t(n)
    nz = fft_filter(r.standard_normal(n), hp_mag(6800 + 1200 * bright, 4))
    nz /= np.std(nz) + 1e-9
    metal = np.zeros(n)
    for fpart in _HAT_PARTIALS * r.uniform(0.985, 1.015, len(_HAT_PARTIALS)):
        ph = 2 * np.pi * fpart * t + r.random() * 6.28
        metal += np.sin(ph) + (np.sin(3 * ph) / 3 if 3 * fpart < 20000 else 0)
    metal = fft_filter(metal, hp_mag(7000, 3))
    metal = fft_filter(metal, lp_mag(15000, 2))
    metal /= np.std(metal) + 1e-9
    dec = (0.3 * r.uniform(0.9, 1.1)) if open_ else (0.022 + 0.022 * v) * r.uniform(0.85, 1.15)
    x = (0.75 * nz + 0.35 * metal) * np.exp(-t / dec)
    if open_:
        x *= np.minimum(1, t / 0.004)
    return _attack(x * 0.22 * v, 0.3)


def ride(v, r):
    n = int(0.9 * SR)
    t = _t(n)
    metal = np.zeros(n)
    for fp in np.array([1630.0, 2410, 3330, 4570, 5920, 7380]) * r.uniform(0.99, 1.01, 6):
        metal += np.sin(2 * np.pi * fp * t + r.random() * 6.28) * np.exp(-t / r.uniform(0.25, 0.6))
    nz = fft_filter(r.standard_normal(n), bp_mag(7000, 0.6)) * np.exp(-t / 0.09)
    nz /= np.std(nz[:2000]) + 1e-9
    x = (0.05 * metal + 0.06 * nz) * v
    return _attack(x, 0.4)


def tom(v, r, midi=45):
    n = int(0.5 * SR)
    t = _t(n)
    f0 = float(mtof(midi))
    f = f0 * (1 + 0.5 * np.exp(-t / 0.03))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    x += 0.15 * fft_filter(r.standard_normal(n), bp_mag(1800, 1.0)) * np.exp(-t / 0.01)
    return _attack(np.tanh(1.3 * x) * 0.55 * v, 0.5)


def crash(v, r, long=False, big=False):
    L = 3.2 if (long or big) else 2.2
    n = int(L * SR)
    t = _t(n)
    out = []
    for ch in range(2):
        nz = fft_filter(r.standard_normal(n), hp_mag(3200, 3))
        nz = fft_filter(nz, lp_mag(13000, 2))
        nz /= np.std(nz) + 1e-9
        metal = np.zeros(n)
        for fp in r.uniform(3000, 9000, 14):
            metal += np.sin(2 * np.pi * fp * t + r.random() * 6.28)
        metal /= np.std(metal)
        tau = 1.3 if (long or big) else 0.85
        e = np.exp(-t / tau) * (0.65 + 0.35 * np.exp(-t / 0.08))
        out.append((0.8 * nz + 0.25 * metal) * e)
    x = np.stack(out) * 0.07 * v
    return np.stack([_attack(c, 2.0) for c in x])


def boom(v, r, midi=29):
    n = int(2.6 * SR)
    t = _t(n)
    f0 = float(mtof(midi))
    f = f0 * (1 + 1.0 * np.exp(-t / 0.04))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    x = np.tanh(1.4 * x) / np.tanh(1.4)
    return _attack(x * 0.55 * v, 2.0)


def render_drums(D, buses, verb):
    """buses: dict name -> Bus. verb: reverb send Bus."""
    for i, (t, v, kw) in enumerate(D["kick"]):
        r = rng_for(f"kick{i}")
        x = kick(v, r, soft=kw.get("soft", False), drop=kw.get("drop", False))
        buses["kick"].add(x, t, 0.9)
    for i, (t, v, kw) in enumerate(D["clap"]):
        r = rng_for(f"clap{i}")
        x = clap(v, r, ghost=kw.get("ghost", False))
        st = pan_st(x, r.uniform(-0.08, 0.08))
        buses["perc"].add(st, t)
        verb.add(st, t, 0.35)
    for i, (t, v, kw) in enumerate(D["snare"]):
        r = rng_for(f"snare{i}")
        x = snare(v, r, kw.get("pitch", 1.0), kw.get("soft", False), kw.get("roll", False))
        st = pan_st(x, r.uniform(-0.12, 0.12))
        buses["perc"].add(st, t)
        verb.add(st, t, 0.3)
    hat_times = [h[0] for h in D["hat"]]
    for i, (t, v, kw) in enumerate(D["hat"]):
        r = rng_for(f"hat{i}")
        x = hat(v, r, kw.get("bright", 0.0))
        buses["perc"].add(pan_st(x, 0.22 + r.uniform(-0.05, 0.05)), t)
    for i, (t, v, kw) in enumerate(D["ohat"]):
        r = rng_for(f"ohat{i}")
        nxt = [h for h in hat_times if h > t + 0.05]
        L = min(0.75, (nxt[0] - t + 0.01) if nxt else 0.75)
        x = hat(v, r, 0.3, open_=True, length=max(L, 0.1))
        k = min(len(x), int(0.012 * SR))
        x[-k:] *= np.linspace(1, 0, k)
        st = pan_st(x, -0.25)
        buses["perc"].add(st, t)
        verb.add(st, t, 0.12)
    for i, (t, v, kw) in enumerate(D["ride"]):
        r = rng_for(f"ride{i}")
        buses["perc"].add(pan_st(ride(v, r), 0.35), t)
    for i, (t, v, kw) in enumerate(D["tom"]):
        r = rng_for(f"tom{i}")
        st = pan_st(tom(v, r, kw.get("midi", 45)), {48: -0.3, 44: 0.0, 41: 0.3}.get(kw.get("midi"), 0))
        buses["perc"].add(st, t)
        verb.add(st, t, 0.3)
    for i, (t, v, kw) in enumerate(D["crash"]):
        r = rng_for(f"crash{i}")
        st = crash(v, r, kw.get("long", False), kw.get("big", False))
        buses["perc"].add(st, t)
        verb.add(st, t, 0.25)
    for i, (t, v, kw) in enumerate(D["boom"]):
        r = rng_for(f"boom{i}")
        buses["kick"].add(boom(v, r, kw.get("midi", 29)), t)


# ================================================================ bass

def render_bass(notes, sub_bus, hi_bus):
    """sub: sine fundamental (mono, < 100 Hz). hi: filtered saw an octave up range, high-passed later."""
    plucks = []
    for i, nt in enumerate(notes):
        r = rng_for(f"bass{i}")
        f = float(mtof(nt["m"]))
        if nt["kind"] == "sub":
            n = int((nt["d"] + 0.25) * SR)
            t = _t(n)
            ph = 2 * np.pi * (f * t + r.random())
            x = np.sin(ph) + 0.12 * np.sin(2 * ph)
            e = env_adsr(n, 0.03, 0.4, 0.85, 0.12, nt["d"])
            sub_bus.add(x * e * 0.5 * nt["v"], nt["t"])
            # a quiet filtered saw so the sub is heard on small speakers too
            hi = fft_filter(saw(2 * f, n, r), lp_mag(260, 2))
            hi_bus.add(hi * e * 0.16 * nt["v"], nt["t"])
        else:
            plucks.append((i, nt, r, f))
    if not plucks:
        return
    L = int(0.42 * SR)
    t = _t(L)
    X, FC, E, SUB = [], [], [], []
    for i, nt, r, f in plucks:
        sc = scene_at(nt["t"])
        x = 0.7 * saw(f, L, r) + 0.3 * pulse(f * 1.003, L, r, 0.35)
        if nt["kind"] == "pulse":
            fc = 140 + 420 * nt["v"] * np.exp(-t / 0.05)
            e = env_adsr(L, 0.004, 0.06, 0.25, 0.03, nt["d"])
        else:
            bright = {"site": 1.15, "repodemo": 1.3, "webdemo": 1.35, "results": 1.2}.get(sc, 1.0)
            if nt["t"] >= DROP:
                bright = 1.5
            dec = {"site": 0.06, "code": 0.09}.get(sc, 0.08)
            fc = 160 + 1300 * bright * nt["v"] * np.exp(-t / dec) * r.uniform(0.9, 1.1)
            e = env_adsr(L, 0.002, 0.12, 0.65, 0.03, nt["d"])
        X.append(x)
        FC.append(fc)
        E.append(e * nt["v"])
        SUB.append(np.sin(2 * np.pi * (f * t + r.random())) * e * nt["v"])
    X = np.array(X)
    FC = np.array(FC)
    y = svf_batch(svf_batch(X, FC, 0.9), FC, 0.6)
    for k, (i, nt, r, f) in enumerate(plucks):
        hi_bus.add(np.tanh(1.5 * y[k] * E[k]) * 0.45, nt["t"])
        sub_bus.add(SUB[k] * 0.45, nt["t"])


# ================================================================ pads

def pad_cutoff(t):
    """Pad filter automation (Hz) as a function of film time (vectorised)."""
    t = np.asarray(t, dtype=float)
    c = np.full(t.shape, 1800.0)
    def seg(a, b, f):
        m = (t >= a) & (t < b)
        c[m] = f(t[m])
    seg(-1, 12, lambda x: 320 * (1500 / 320) ** np.clip(x / 12, 0, 1))
    seg(12, 30, lambda x: 1400 + 400 * np.sin(2 * np.pi * (x - 12) / 16))
    seg(30, 56, lambda x: 2100 + 600 * np.sin(2 * np.pi * (x - 30) / 16))
    seg(56, 82, lambda x: 2400 + 800 * np.sin(2 * np.pi * (x - 56) / 8 + 1))
    seg(82, 100, lambda x: 1000 + 350 * np.sin(2 * np.pi * (x - 82) / 12) + 900 * np.clip((x - 96) / 4, 0, 1))
    seg(100, 164, lambda x: 3200 + 700 * np.sin(2 * np.pi * (x - 100) / 16))
    seg(164, 180, lambda x: 1100 + 200 * np.sin(2 * np.pi * (x - 164) / 8))
    seg(180, 205, lambda x: 900 * (7000 / 900) ** (np.clip((x - 180) / 24.5, 0, 1) ** 2.2))
    seg(205, 210, lambda x: 5000 + 0 * x)
    seg(210, 223, lambda x: 4200 * (700 / 4200) ** np.clip((x - 210) / 11, 0, 1))
    return c


PAD_LEVEL = {"hook": 0.8, "stack": 0.75, "code": 0.62, "site": 0.6, "blind": 0.85, "repodemo": 0.55,
             "webdemo": 0.55, "safety": 0.8, "results": 0.65, "end": 0.9}


def render_pads(pad_bus):
    tmp = np.zeros((2, pad_bus.x.shape[1]))
    vo = pad_voicings()
    for ci, (s, e, name, notes) in enumerate(vo):
        sc = scene_at(s)
        if sc == "end":
            e = 222.0
        att = 1.4 if s == 0 else (0.25 if sc not in ("blind", "safety", "end") else 0.6)
        if s == 0:
            att = 0.35
        rel = 1.2 if sc != "end" else 6.0
        gate = e - s
        if s < GAP[0] < e:
            gate = GAP[0] - s
            rel = 0.05
        L = gate + rel * 3
        n = int(L * SR)
        if s >= DROP and sc != "end":
            att = 0.01
        for vi, m in enumerate(notes):
            r = rng_for(f"pad{ci}-{vi}")
            f = float(mtof(m))
            env = env_adsr(n, att, 1.0, 1.0, rel, gate)
            p = -0.55 + 1.1 * vi / max(1, len(notes) - 1)
            for dc, pp in ((-8, -0.25), (0, 0.0), (7, 0.25)):
                det = f * 2 ** ((dc + r.normal(0, 1.5)) / 1200)
                x = saw(det, n, r) * env * PAD_LEVEL[sc] * 0.06
                st = pan_st(x, np.clip(p + pp, -1, 1))
                a = int(round(s * SR))
                b = min(tmp.shape[1], a + n)
                tmp[:, a:b] += st[:, :b - a]

    def gain(tc, f):
        fc = pad_cutoff(tc)[:, None]
        g = reso_lp(f[None, :], fc, 1.25, order=3)
        return g * hp_mag(190, 2)(f)[None, :]
    y = stft_filter(tmp, gain)
    pad_bus.x += y.astype(np.float32)


def render_stab(bus, verb):
    """The chord stab on the drop (205) and the ringing chord at 210: wide supersaw."""
    for k, (t0, L, notes, g) in enumerate(((DROP, 1.6, [53, 60, 65, 68, 72, 77], 1.0),)):
        n = int(L * SR)
        tt = _t(n)
        acc = np.zeros((2, n))
        for vi, m in enumerate(notes):
            r = rng_for(f"stab{k}-{vi}")
            f = float(mtof(m))
            for dc in (-12, -4, 5, 13):
                x = saw(f * 2 ** (dc / 1200), n, r)
                acc += pan_st(x, np.clip(dc / 14 + r.uniform(-0.2, 0.2), -1, 1))
        fc = 1200 + 6000 * np.exp(-tt / 0.25)
        acc = np.stack([svf_batch(c[None], fc[None], 0.8)[0] for c in acc])
        acc *= np.exp(-tt / 0.5) * 0.06 * g
        acc = np.stack([_attack(c, 1.0) for c in acc])
        bus.add(acc, t0)
        verb.add(acc, t0, 0.3)


# ================================================================ arp

def arp_cutoff(t):
    t = float(t)
    if t < 12:
        return 450 * (2000 / 450) ** (t / 12)
    if t < 30:
        return 1700 + 500 * math.sin(2 * math.pi * (t - 12) / 8)
    if t < 56:
        return 2300 + 900 * math.sin(2 * math.pi * (t - 30) / 16)
    if t < 82:
        return 2800 + 1100 * math.sin(2 * math.pi * (t - 56) / 8 + 0.5)
    if t < 180:
        return 2600 + 700 * math.sin(2 * math.pi * (t - 100) / 16)
    if t < 205:
        return 900 * (6500 / 900) ** (max(0.0, (t - 180) / 24.5) ** 2)
    if t < 210:
        return 5200
    return 3500 * (500 / 3500) ** min(1, (t - 210) / 9)


def arp_gain(t, sc):
    g = {"hook": 0.6, "stack": 0.62, "code": 0.62, "site": 0.6, "repodemo": 0.55, "webdemo": 0.55,
         "results": 0.5, "end": 0.6}[sc]
    if sc == "hook":
        g *= 0.55 + 0.45 * min(1, t / 8)
    if sc == "results" and t < 205:
        g *= 0.7 + 0.5 * max(0.0, (t - 180) / 24.5) ** 1.5
    if sc == "end":
        g *= max(0.0, 1 - (t - 210) / 9.0) ** 1.5
    return g


def render_arp(notes, bus, delay):
    L = int(0.4 * SR)
    t = _t(L)
    X, FC, E, meta = [], [], [], []
    for i, nt in enumerate(notes):
        r = rng_for(f"arp{i}")
        f = float(mtof(nt["m"]))
        x = 0.6 * saw(f, L, r) + 0.4 * pulse(f, L, r, 0.28 + 0.06 * r.random())
        base = arp_cutoff(nt["t"])
        fc = base * (1 + 2.2 * nt["v"] * np.exp(-t / 0.05))
        e = env_adsr(L, 0.0015, 0.08, 0.3, 0.05, nt["gate"])
        X.append(x)
        FC.append(fc)
        E.append(e * nt["v"] * arp_gain(nt["t"], nt["sc"]))
        meta.append((nt, r))
    y = svf_batch(np.array(X), np.array(FC), 1.6)
    y = svf_batch(y, np.array(FC) * 1.5, 0.707)
    for k, (nt, r) in enumerate(meta):
        x = y[k] * E[k] * 0.11
        p = 0.3 * math.sin(2 * math.pi * nt["t"] / 6.0) + (0.12 if k % 2 else -0.12)
        st = pan_st(x, p)
        bus.add(st, nt["t"])
        delay.add(st, nt["t"], 0.25)


# ================================================================ lead and bells

def render_lead(notes, bus, delay, verb):
    groups = {}
    for i, nt in enumerate(notes):
        L = 0.9 if nt["d"] < 0.5 else (1.6 if nt["d"] < 1.2 else 3.6)
        groups.setdefault(L, []).append((i, nt))
    for L, items in groups.items():
        n = int(L * SR)
        t = _t(n)
        X, FC, E = [], [], []
        for i, nt in items:
            r = rng_for(f"lead{i}")
            f = float(mtof(nt["m"]))
            vib = 1 + 0.0045 * np.sin(2 * np.pi * 5.2 * t + r.random() * 6) * np.clip((t - 0.18) / 0.3, 0, 1)
            x = 0.5 * saw(f * vib * 2 ** (-6 / 1200), n, r) + 0.5 * saw(f * vib * 2 ** (6 / 1200), n, r)
            x += 0.3 * pulse(f * vib / 2, n, r, 0.5) if not nt.get("harm") else 0
            X.append(x)
            FC.append(1500 + 3200 * nt["v"] * np.exp(-t / 0.22) + 400 * np.exp(-t / 2))
            rel = 0.12 if nt["d"] < 2 else 1.2
            E.append(env_adsr(n, 0.008, 0.3, 0.75, rel, nt["d"]) * nt["v"])
        y = svf_batch(np.array(X), np.array(FC), 1.1)
        for k, (i, nt) in enumerate(items):
            x = y[k] * E[k] * (0.075 if not nt.get("harm") else 0.06)
            st = pan_st(x, -0.08 if not nt.get("harm") else 0.25)
            bus.add(st, nt["t"])
            delay.add(st, nt["t"], 0.45)
            verb.add(st, nt["t"], 0.25)


def fm_bell(f, n, r, ratio=2.0, index=2.5, tau=1.3, tau_i=0.35):
    t = _t(n)
    I = index * np.exp(-t / tau_i)
    mod = np.sin(2 * np.pi * f * ratio * t + r.random() * 6.28)
    x = np.sin(2 * np.pi * f * t + I * mod) * np.exp(-t / tau)
    x += 0.25 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / (tau * 0.4))
    return _attack(x, 1.5)


def render_bells(notes, bus, delay, verb):
    for i, nt in enumerate(notes):
        r = rng_for(f"bell{i}")
        f = float(mtof(nt["m"]))
        n = int((nt["d"] + 2.5) * SR)
        x = fm_bell(f, n, r, ratio=2.0 + 0.003 * r.normal(), index=1.6 + 0.6 * nt["v"], tau=1.1 + 0.4 * nt["d"])
        x *= nt["v"] * 0.12
        st = pan_st(x, r.uniform(-0.35, 0.35))
        bus.add(st, nt["t"])
        delay.add(st, nt["t"], 0.5)
        verb.add(st, nt["t"], 0.6)


def render_end_chord(bus, verb):
    """At 210 the main chord rings: soft FM bells on Fm(add9) plus the pad (rendered in pads)."""
    for vi, m in enumerate([53, 60, 65, 67, 68, 72]):
        r = rng_for(f"endchord{vi}")
        f = float(mtof(m))
        n = int(9.0 * SR)
        x = fm_bell(f, n, r, ratio=1.0, index=1.2, tau=2.8, tau_i=0.6) * 0.07
        st = pan_st(x, -0.5 + vi / 5)
        bus.add(st, 210.0)
        verb.add(st, 210.0, 0.5)


# ================================================================ riser (tonal, no noise)

def render_riser(bus):
    """197-204.5: a dominant (C) saw stack gliding up an octave, opening, with a gate that speeds up."""
    t0, t1 = 197.0, GAP[0]
    n = int((t1 - t0) * SR)
    t = _t(n)
    x01 = t / (t1 - t0)
    acc = np.zeros((2, n))
    for vi, m in enumerate((48, 55, 60, 64)):
        r = rng_for(f"riser{vi}")
        f = float(mtof(m)) * 2 ** (x01 ** 1.6)
        for dc in (-9, 8):
            acc += pan_st(saw(f * 2 ** (dc / 1200), n, r), -0.4 + 0.8 * (vi % 2) + dc / 40)
    # gate: free until 200, then 16ths, then 32nds from 203
    tt = t + t0
    rate = np.where(tt < 200, 0.0, np.where(tt < 203, 8.0, 16.0))
    ph = np.cumsum(rate) / SR
    gate = np.where(rate > 0, 0.55 + 0.45 * np.cos(2 * np.pi * ph) ** 2, 1.0)
    amp = x01 ** 2.2 * gate * 0.05
    acc *= amp

    def gain(tc, f):
        fc = 300 * (7000 / 300) ** np.clip((tc) / (t1 - t0), 0, 1) ** 1.5
        return reso_lp(f[None, :], fc[:, None], 1.6, order=3) * hp_mag(120, 2)(f)[None, :]
    y = stft_filter(acc, gain)
    k = int(0.006 * SR)
    y[:, -k:] *= np.linspace(1, 0, k)
    bus.add(y, t0)
