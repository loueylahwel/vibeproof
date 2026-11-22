#!/usr/bin/env python3
"""v7 soundtrack: a music-led score (F minor, 120 BPM) with a few effects, all synthesized here.

    python3 tools/sound/music.py      # writes soundtrack-v7.wav, music-v7.wav, fx-v7.wav (48 kHz, 16-bit)

No samples, no audio files, no external audio tools: oscillators, noise, filters and envelopes in
numpy (v7_dsp, v7_instruments, v7_fx), arranged by v7_score. Every random choice is seeded, so a
re-run gives byte-identical files. The previous v6 soundtrack (synth.py) is untouched.
"""
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from dsp import SR, rng_for, room_ir  # noqa: E402
from loudness import integrated, max_short_window, true_peak_db  # noqa: E402
from synth import limit, write_wav  # noqa: E402  (v6 helpers, reused unchanged)
from v7_dsp import N, Bus, convolve_long, fft_hp_long, fft_lp_long  # noqa: E402
import v7_instruments as ins  # noqa: E402
import v7_score as sc  # noqa: E402
from v7_fx import effects  # noqa: E402

TARGET_LUFS = -16.0
CEILING_DB = -1.2          # limiter ceiling (dBTP, 4x oversampled); the spec allows -1.0
FADE = (215.5, 221.6)      # final fade to silence
DELAY_S = 0.375            # dotted 8th at 120 BPM
# fader levels of the buses (linear), set from the per-scene loudness table (V7_STATS=1)
MIX = {"kick": 0.55, "perc": 0.85, "sub": 0.55, "basshi": 1.45, "pads": 1.6, "arp": 5.0, "lead": 4.5, "bells": 2.2,
       "stab": 1.0, "riser": 1.8}
# an effect's peak may reach this far relative to the music's peak around it (dB); default -2
PEAK_CAP_DB = {"ui-click": 0.0, "click-confirm": 0.0}


def ramp(a, b):
    """0..1 cosine ramp between film times a and b, as a full-length array."""
    t = np.arange(N) / SR
    x = np.clip((t - a) / (b - a), 0, 1)
    return 0.5 - 0.5 * np.cos(np.pi * x)


def duck_curve(kicks, release=0.28):
    """Sidechain amount 0..1 from the kick list: fast dip on each kick, smooth return."""
    d = np.zeros(N, dtype=np.float32)
    L = int(release * SR)
    s = np.arange(L) / L
    shape = ((1 - s) ** 2).astype(np.float32)
    shape[:int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR), dtype=np.float32)
    for t, v in kicks:
        a = int(round(t * SR))
        b = min(N, a + L)
        if a < N:
            np.maximum(d[a:b], min(1.0, v) * shape[:b - a], out=d[a:b])
    return d


def gap_gate():
    """1 everywhere except the one-beat gap before the drop (8 ms fade out, hard in at 205.0)."""
    g = np.ones(N)
    a, b = int(sc.GAP[0] * SR), int(sc.GAP[1] * SR)
    k = int(0.008 * SR)
    g[a - k:a] = np.linspace(1, 0, k)
    g[a:b] = 0.0
    return g


def send_return(send, ir, gain):
    """Convolve a send bus; whatever started before the gap may not ring into the drop."""
    x = send.astype(np.float64)
    wet = convolve_long(x, ir)
    a, b = int(sc.GAP[0] * SR), int(sc.GAP[1] * SR)
    wet[:, a:] = 0.0
    post = x[:, b:].copy()
    wet[:, b:] = convolve_long(post, ir)
    return wet * gain


def pingpong(send, gain, fb=0.42, taps=6):
    x = fft_lp_long(fft_hp_long(send.astype(np.float64).sum(axis=0) * 0.5, 280), 3800)
    out = np.zeros((2, N))
    d = int(round(DELAY_S * SR))
    a, b = int(sc.GAP[0] * SR), int(sc.GAP[1] * SR)
    pre = x.copy()
    pre[a:] = 0
    post = x.copy()
    post[:b] = 0
    for src in (pre, post):
        o = np.zeros((2, N))
        for k in range(1, taps + 1):
            s = d * k
            o[(k + 1) % 2, s:] += src[:N - s] * (fb ** (k - 1))
        if src is pre:
            o[:, a:] = 0.0
        out += o
    return out * gain


def place_fx(music):
    """Level each effect against the music around it and dip the music a little under it."""
    fx = np.zeros((2, N))
    dip = np.ones(N)
    report = []
    for name, t, st, off_db, dip_db in effects():
        a = int(round(t * SR))
        w0, w1 = max(0, a - int(0.6 * SR)), min(N, a + int(0.6 * SR))
        ref = max_short_window(music[:, w0:w1])
        lvl = max_short_window(st)
        g = 10 ** ((ref + off_db - lvl) / 20)
        # short sounds (clicks) would be very peaky at equal loudness: keep each effect's peak
        # 2 dB under the music's own peak around it
        mpk = np.abs(music[:, w0:w1]).max()
        g = min(g, 10 ** (PEAK_CAP_DB.get(name, -2.0) / 20) * mpk / np.abs(st).max())
        st = st * g
        b = min(N, a + st.shape[1])
        fx[:, a:b] += st[:, :b - a]
        # music dip: 15 ms down, held for the loud part, 250 ms back
        L = int(min(st.shape[1] / SR, 0.9) * SR)
        env = np.abs(st).max(axis=0)[:L]
        hold = np.argmax(env < env.max() * 0.15) or L
        d = np.ones(N)
        k1, k2 = int(0.015 * SR), int(0.25 * SR)
        lo = 10 ** (-dip_db / 20)
        s0 = max(0, a - k1)
        d[s0:a] = np.linspace(1, lo, a - s0)
        d[a:a + hold] = lo
        d[a + hold:a + hold + k2] = np.linspace(lo, 1, k2)
        dip = np.minimum(dip, d)
        report.append((name, t, ref, off_db))
    ir = room_ir(rng_for("v7-fx-room"), seconds=2.0, tau=0.3, predelay=0.012, damp_hz=4500)
    fx = fx + convolve_long(fx, ir) * 10 ** (-14 / 20)
    return fx, dip, report


def main():
    t_start = time.time()
    Bus.CUT = sc.GAP
    names = ["kick", "perc", "sub", "basshi", "pads", "arp", "lead", "bells", "stab", "riser", "verb", "delay"]
    B = {k: Bus(k) for k in names}

    D = sc.drums()
    ins.render_drums(D, B, B["verb"])
    print(f"drums      {time.time() - t_start:6.1f} s  ({sum(len(v) for v in D.values())} hits)")
    bnotes = sc.bass()
    ins.render_bass(bnotes, B["sub"], B["basshi"])
    print(f"bass       {time.time() - t_start:6.1f} s  ({len(bnotes)} notes)")
    ins.render_pads(B["pads"])
    print(f"pads       {time.time() - t_start:6.1f} s")
    anotes = sc.arp()
    ins.render_arp(anotes, B["arp"], B["delay"])
    print(f"arp        {time.time() - t_start:6.1f} s  ({len(anotes)} notes)")
    lnotes = sc.lead()
    ins.render_lead(lnotes, B["lead"], B["delay"], B["verb"])
    bl = sc.bells()
    ins.render_bells(bl, B["bells"], B["delay"], B["verb"])
    ins.render_end_chord(B["bells"], B["verb"])
    ins.render_stab(B["stab"], B["verb"])
    ins.render_riser(B["riser"])
    print(f"lead/bells {time.time() - t_start:6.1f} s  ({len(lnotes)} + {len(bl)} notes)")

    # sidechain: pads, bass and arp breathe with the kick
    duck = duck_curve(sc.kick_times())
    f64 = lambda k: B[k].x.astype(np.float64)  # noqa: E731
    sub = f64("sub") * (1 - 0.85 * duck)
    basshi = fft_hp_long(f64("basshi"), 75, 2) * (1 - 0.55 * duck)
    pads = f64("pads") * (1 - 0.5 * duck)
    arp = f64("arp") * (1 - 0.25 * duck)
    drums = MIX["kick"] * f64("kick") + MIX["perc"] * f64("perc")
    drums = np.tanh(drums * 1.6) / 1.6          # soft-clip the drum bus (tames kick/clap peaks)
    print(f"buses      {time.time() - t_start:6.1f} s")

    hall = room_ir(rng_for("v7-hall"), seconds=3.2, tau=0.6, predelay=0.022, damp_hz=4200)
    verb = send_return(B["verb"].x + 0.12 * B["pads"].x + 0.5 * B["arp"].x, hall, 0.32)
    dly = pingpong(B["delay"].x, 0.8)
    print(f"sends      {time.time() - t_start:6.1f} s")

    music = (drums + MIX["sub"] * sub + MIX["basshi"] * basshi + MIX["pads"] * pads
             + MIX["arp"] * arp + MIX["lead"] * f64("lead") + MIX["bells"] * f64("bells")
             + MIX["stab"] * f64("stab") + MIX["riser"] * f64("riser") + verb + dly)
    if os.environ.get("V7_STATS"):
        comps = {"sub": sub, "basshi": basshi, "pads": pads, "arp": arp,
                 "lead": f64("lead"), "bells": f64("bells"), "stab": f64("stab"), "riser": f64("riser")}
        comps = {k: v * MIX[k] for k, v in comps.items()}
        comps.update(drums=drums, verb=verb, delay=dly, MUSIC=music)
        print("component  " + " ".join(f"{n:>8s}" for n, _, _ in sc.SCENES) + "   peak")
        for name, x in comps.items():
            row = []
            for _, a, b in sc.SCENES:
                seg = x[:, int(a * SR):int(b * SR)]
                row.append(integrated(seg) if np.abs(seg).max() > 1e-6 else -99)
            print(f"{name:10s} " + " ".join(f"{v:8.1f}" for v in row) + f" {20 * np.log10(np.abs(x).max() + 1e-12):6.1f}")
    music = fft_hp_long(music, 26, 2)
    music *= gap_gate()
    music *= 1 - ramp(*FADE)
    music[:, int(FADE[1] * SR):] = 0.0
    # tiny fade-in so sample 0 is not a click (sound is present from the first 10 ms)
    k = int(0.01 * SR)
    music[:, :k] *= np.linspace(0, 1, k)

    fx, dip, fxrep = place_fx(music)
    music *= dip
    fx *= 1 - ramp(218.0, FADE[1])
    fx[:, int(FADE[1] * SR):] = 0.0
    print(f"fx         {time.time() - t_start:6.1f} s")

    # master: loudness to target, then the true-peak limiter; iterate (the limiter takes a little)
    g = 10 ** ((TARGET_LUFS - integrated(music + fx)) / 20)
    for it in range(4):
        mix, gr = limit((music + fx) * g, CEILING_DB)
        err = TARGET_LUFS - integrated(mix)
        print(f"  master pass {it + 1}: limiter max GR {gr:.2f} dB, error {err:+.2f} LU")
        if abs(err) < 0.05:
            break
        g *= 10 ** (err / 20)
    m_l, gr_m = limit(music * g, CEILING_DB)
    print(f"  music stem alone: limiter max GR {gr_m:.2f} dB")
    f_l, _ = limit(fx * g, CEILING_DB)
    mix[:, int(FADE[1] * SR):] = 0.0

    write_wav(os.path.join(HERE, "soundtrack-v7.wav"), mix, "v7-mix")
    write_wav(os.path.join(HERE, "music-v7.wav"), m_l, "v7-music")
    write_wav(os.path.join(HERE, "fx-v7.wav"), f_l, "v7-fx")
    info = {
        "integrated_lufs": round(float(integrated(mix)), 2),
        "true_peak_dbtp": round(float(true_peak_db(mix)), 2),
        "fx": [{"id": n, "at": t, "music_ref_lufs_100ms": round(float(r), 1), "offset_db": o} for n, t, r, o in fxrep],
        "runtime_s": round(time.time() - t_start, 1),
    }
    with open(os.path.join(HERE, "v7-render.json"), "w") as f:
        json.dump(info, f, indent=1)
    print(json.dumps(info, indent=1))
    print("wrote soundtrack-v7.wav, music-v7.wav, fx-v7.wav")


if __name__ == "__main__":
    main()
