"""v7 score: F minor, 120 BPM, 4/4 (beat 0.5 s, bar 2 s). Scenes, chords, voicings and the note
and hit lists every instrument plays. Pure data + seeded humanisation; no sound is made here.
"""
import numpy as np

from dsp import rng_for

BEAT = 0.5
BAR = 2.0
S16 = 0.125

SCENES = [("hook", 0, 12), ("stack", 12, 30), ("code", 30, 56), ("site", 56, 82), ("blind", 82, 100),
          ("repodemo", 100, 132), ("webdemo", 132, 164), ("safety", 164, 180), ("results", 180, 210),
          ("end", 210, 222)]

GAP = (204.5, 205.0)      # the one-beat silence before the drop
DROP = 205.0

# pitch classes (C = 0)
F, Gb, G, Ab, A, Bb, B, C, Db, D, Eb, E = 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4
CHORD = {
    # name: (root, chord tones, colour tone used by pads/arp)
    "Fm": (F, [F, Ab, C], G),
    "Db": (Db, [Db, F, Ab], C),
    "Ab": (Ab, [Ab, C, Eb], Bb),
    "Eb": (Eb, [Eb, G, Bb], F),
    "Bbm": (Bb, [Bb, Db, F], Ab),
    "C": (C, [C, E, G], Bb),
    "Csus": (C, [C, F, G], Bb),
}

# (start s, chord) - each chord lasts until the next start
_PROG = []


def _bars(t0, names):
    for i, n in enumerate(names):
        _PROG.append((t0 + BAR * i, n))


_bars(0, ["Fm", "Fm", "Db", "Db", "Eb", "C"])                                         # hook
_bars(12, ["Fm", "Fm", "Db", "Db", "Ab", "Ab", "Eb", "Eb", "C"])                      # stack
_bars(30, ["Fm", "Db", "Ab", "Eb", "Fm", "Db", "Ab", "Eb", "Fm", "Db", "Bbm", "Eb", "C"])   # code
_bars(56, ["Fm", "Db", "Bbm", "C", "Fm", "Db", "Bbm", "C", "Fm", "Ab", "Db", "Eb", "Eb"])   # site
_bars(82, ["Db", "Db", "Bbm", "Bbm", "Fm", "Fm", "Db", "Eb", "Eb"])                   # blind
_bars(100, ["Ab", "Eb", "Fm", "Db"] * 4)                                              # repodemo
_bars(132, ["Db", "Ab", "Eb", "Fm"] * 3 + ["Db", "Eb", "Fm", "Fm"])                   # webdemo
_bars(164, ["Db", "Db", "Ab", "Ab", "Bbm", "Bbm", "Eb", "Eb"])                        # safety
_bars(180, ["Fm", "Db", "Ab", "Eb", "Fm", "Db", "Ab", "Eb", "Bbm", "Db", "Eb", "Csus"])  # results build
_PROG += [(203.0, "C"), (205.0, "Fm"), (207.0, "Db"), (209.0, "Eb"), (210.0, "Fm")]
PROG = [(s, (_PROG[i + 1][0] if i + 1 < len(_PROG) else 222.0), n) for i, (s, n) in enumerate(_PROG)]


def chord_at(t):
    for s, e, n in PROG:
        if s <= t < e:
            return n
    return PROG[-1][2]


def scene_at(t):
    for name, s, e in SCENES:
        if s <= t < e:
            return name
    return "end"


def tones_in(pcs, lo, hi):
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


# ---------------------------------------------------------------- pads: voice-led chords

def pad_voicings():
    """Four-voice chords between A3 and F5, each chosen to move the least from the last one."""
    out = []
    prev = [60, 65, 68, 72]
    for s, e, n in PROG:
        root, tones, col = CHORD[n]
        pcs = tones + ([col] if n not in ("C", "Csus") else [])
        cands = tones_in(pcs, 57, 77)
        best, bc = None, 1e9
        # every 4-note combination that holds root, third (or sus) and fifth
        import itertools
        for comb in itertools.combinations(cands, 4):
            pc = {m % 12 for m in comb}
            if not set(tones).issubset(pc):
                continue
            if comb[-1] - comb[0] > 16 or min(np.diff(comb)) < 2:
                continue
            cost = sum(abs(a - b) for a, b in zip(comb, prev)) + 0.3 * abs(np.mean(comb) - 66)
            if cost < bc:
                best, bc = list(comb), cost
        prev = best
        out.append((s, e, n, best))
    return out


def bass_midi(n):
    """Root in F1..E2 (43-82 Hz): the sub sits under 100 Hz."""
    r = CHORD[n][0]
    return 24 + ((r - 0) % 12) if (24 + r % 12) >= 29 else 36 + r % 12


# ---------------------------------------------------------------- humanising

class Human:
    def __init__(self, name):
        self.r = rng_for("v7-" + name)

    def dt(self, ms=2.5, cap=6.0):
        return float(np.clip(self.r.normal(0, ms), -cap, cap)) * 1e-3

    def vel(self, v, spread=0.07):
        return float(np.clip(v * (1 + self.r.normal(0, spread)), 0.05, 1.2))

    def chance(self, p):
        return self.r.random() < p


# ---------------------------------------------------------------- drums

def in_gap(t):
    return GAP[0] - 1e-6 <= t < GAP[1]


def drums():
    """Return dict of hit lists: kick, clap, snare, hat, ohat, ride, tom, crash. Each hit is
    (time, velocity, extra dict)."""
    h = Human("drums")
    D = {k: [] for k in ("kick", "clap", "snare", "hat", "ohat", "ride", "tom", "crash", "boom")}

    def kick(t, v, **kw):
        if not in_gap(t):
            D["kick"].append((t + h.dt(1.2, 3), h.vel(v, 0.04), kw))

    def groove_bar(t0, sc, bar_in_phrase, phrase_len=8, energy=1.0, clap=True, hats=True, ohat=True,
                   kicks=True, ride=False, lighter=False):
        last4 = bar_in_phrase % 4 == 3
        last8 = bar_in_phrase % phrase_len == phrase_len - 1
        if kicks:
            for b in range(4):
                if last8 and b == 3 and h.chance(0.5):
                    continue
                kick(t0 + b * BEAT, (0.95 if b == 0 else 0.86) * energy)
        if clap:
            for b in (1, 3):
                D["clap"].append((t0 + b * BEAT + h.dt(3, 6), h.vel(0.85 * energy if not lighter else 0.72), {}))
            if last4 and not last8:   # small ghost before the next bar
                D["clap"].append((t0 + 3.75 * BEAT + h.dt(2, 5), h.vel(0.32), {"ghost": True}))
        if hats:
            pat = [0.62, 0.30, 0.0, 0.40] if not lighter else [0.5, 0.26, 0.0, 0.34]
            for s in range(16):
                v = pat[s % 4]
                if v == 0 and ohat:
                    continue
                if v == 0:
                    v = 0.5
                if s % 4 in (1, 3) and h.chance(0.07):
                    continue           # an occasional missing ghost
                swing = 0.011 if s % 2 == 1 else 0.0
                D["hat"].append((t0 + s * S16 + swing + h.dt(2.5, 6), h.vel(v * energy, 0.12),
                                 {"bright": h.r.uniform(-1, 1)}))
        if ohat:
            for b in range(4):
                if last8 and b == 3:
                    continue
                D["ohat"].append((t0 + b * BEAT + 2 * S16 + h.dt(2, 5), h.vel(0.55 * energy, 0.08), {}))
        if ride:
            for s in range(0, 16, 2):
                D["ride"].append((t0 + s * S16 + h.dt(2.5, 6), h.vel(0.45 if s % 4 else 0.6, 0.1), {}))
        if last8:   # fill on the last beat and a half
            n = 6
            for i in range(n):
                tt = t0 + 2.5 * BEAT + i * S16
                D["snare"].append((tt + h.dt(2, 4), h.vel(0.35 + 0.1 * i), {"pitch": 1.0 + 0.04 * i}))
            for i, m in enumerate((48, 44, 41)):
                if h.chance(0.7):
                    D["tom"].append((t0 + (3 + i * 0.33) * BEAT + h.dt(2, 4), h.vel(0.6), {"midi": m}))
        elif last4 and h.chance(0.6):
            for i in range(3):
                D["snare"].append((t0 + 3.25 * BEAT + i * S16 + h.dt(2, 4), h.vel(0.22 + 0.06 * i), {"pitch": 1.0}))

    # stack 12-30: soft kick, hats from 20 s, fill into 30
    for i, t0 in enumerate(np.arange(12, 30, BAR)):
        for b in range(4):
            if t0 == 28 and b == 3:
                continue
            kick(t0 + b * BEAT, 0.55 + 0.02 * i if b == 0 else 0.5 + 0.02 * i, soft=True)
        if t0 >= 20:
            for b in range(4):
                D["hat"].append((t0 + b * BEAT + 2 * S16 + h.dt(2.5, 6), h.vel(0.30 + 0.015 * i, 0.1),
                                 {"bright": h.r.uniform(-1, 0)}))
    for i in range(8):   # fill 29.0-30.0: 16th snares rising
        D["snare"].append((29.0 + i * S16 + h.dt(2, 4), h.vel(0.25 + 0.08 * i), {"pitch": 1.0 + 0.03 * i}))
    D["crash"].append((30.0, 0.7, {}))

    # code 30-56 and site 56-82
    for sc, a, b in (("code", 30, 56), ("site", 56, 82)):
        for i, t0 in enumerate(np.arange(a, b, BAR)):
            groove_bar(t0, sc, i if i < 12 else 7, energy=0.95 if sc == "code" else 1.0)
        if sc == "site":
            D["crash"].append((56.0, 0.75, {}))
    # into blind: one last low hit at 82 with a long tail, then nothing until 98
    kick(82.0, 0.9)
    D["crash"].append((82.0, 0.6, {"long": True}))
    D["boom"].append((82.0, 0.5, {"midi": 37}))
    for b in range(4):   # 98-100 the beat comes back softly
        kick(98.0 + b * BEAT, 0.45 + 0.1 * b, soft=True)
    for i in range(8):
        D["snare"].append((99.0 + i * S16 + h.dt(2, 4), h.vel(0.15 + 0.05 * i), {"pitch": 1.0 + 0.03 * i}))

    # repodemo 100-132, webdemo 132-164: groove, lighter and brighter
    D["crash"].append((100.0, 0.7, {}))
    for i, t0 in enumerate(np.arange(100, 132, BAR)):
        groove_bar(t0, "repodemo", i, energy=0.9, lighter=True)
    D["crash"].append((132.0, 0.7, {}))
    for i, t0 in enumerate(np.arange(132, 164, BAR)):
        groove_bar(t0, "webdemo", i, energy=0.9, lighter=True, ride=(140 <= t0 < 156), ohat=not (140 <= t0 < 156))

    # safety 164-180: half time - kick on 1 (and sometimes the and of 2), soft snare on 3, 8th hats
    for i, t0 in enumerate(np.arange(164, 180, BAR)):
        kick(t0, 0.6, soft=True)
        if i % 2 == 1:
            kick(t0 + 1.5 * BEAT, 0.42, soft=True)
        D["snare"].append((t0 + 2 * BEAT + h.dt(3, 6), h.vel(0.42), {"pitch": 0.9, "soft": True}))
        for s in range(0, 16, 2):
            D["hat"].append((t0 + s * S16 + h.dt(3, 6), h.vel(0.22 if s % 4 else 0.3, 0.12), {"bright": -0.8}))

    # results 180-205: build in layers
    D["crash"].append((180.0, 0.5, {}))
    for i, t0 in enumerate(np.arange(180, 204, BAR)):
        if t0 < 188:
            groove_bar(t0, "results", i, energy=0.8, clap=False, ohat=False)
        elif t0 < 196:
            groove_bar(t0, "results", i, energy=0.88)
        elif t0 < 202:
            groove_bar(t0, "results", 0, energy=0.95, clap=True)
        # 202-204.5: no kick, the roll and the riser carry it
    kick(204.0, 0.8)
    # snare roll from 197: 8ths, then 16ths, then 32nds, crescendo, pitch rising
    t = 197.0
    rolls = []
    while t < 204.5 - 1e-6:
        step = 0.25 if t < 200 else (0.125 if t < 203 else 0.0625)
        rolls.append(t)
        t += step
    for j, tt in enumerate(rolls):
        x = (tt - 197.0) / 7.5
        D["snare"].append((tt + h.dt(1.5, 3), 0.18 + 0.75 * x ** 1.4, {"pitch": 1.0 + 0.5 * x, "roll": True}))

    # THE DROP 205: big kick, boom, crash; then the full groove (bars counted from 205)
    D["kick"].append((DROP, 1.15, {"drop": True}))
    D["boom"].append((DROP, 1.0, {"midi": 29}))
    D["crash"].append((DROP, 1.0, {"big": True}))
    for b in range(1, 10):
        kick(DROP + b * BEAT, 0.95 if b % 4 == 0 else 0.86)
    for b in (1, 3, 5, 7, 9):
        D["clap"].append((DROP + b * BEAT + h.dt(3, 6), h.vel(0.9), {}))
    for s in range(40):
        tt = DROP + s * S16
        if s % 4 == 2:
            D["ohat"].append((tt + h.dt(2, 5), h.vel(0.6), {}))
        else:
            D["hat"].append((tt + (0.011 if s % 2 else 0) + h.dt(2.5, 6),
                             h.vel([0.65, 0.32, 0, 0.42][s % 4], 0.12), {"bright": h.r.uniform(0, 1)}))
    # the end: the chord rings with one soft low hit at 210
    D["boom"].append((210.0, 0.45, {"midi": 29}))
    for k in D:
        D[k] = [x for x in D[k] if not in_gap(x[0]) and 0 <= x[0] < 222]
        D[k].sort(key=lambda x: x[0])
    return D


def kick_times():
    return [(t, v) for t, v, _ in drums()["kick"]]


# ---------------------------------------------------------------- bass

def bass():
    """Notes (time, midi, dur, vel, kind). kind 'sub' = sustained sub, 'pluck' = filtered saw + sub."""
    h = Human("bass")
    out = []

    def note(t, m, d, v, kind="pluck", **kw):
        if in_gap(t):
            return
        d = min(d, GAP[0] - t) if t < GAP[0] < t + d else d
        out.append(dict(t=t + h.dt(2, 4), m=m, d=d, v=h.vel(v, 0.06), kind=kind, **kw))

    for s, e, n in PROG:
        r = bass_midi(n)
        sc = scene_at(s)
        L = e - s
        if sc == "hook":
            if s >= 4:
                note(s, r, L, 0.35, "sub")
        elif sc == "stack":
            note(s, r, L, 0.62, "sub")
        elif sc == "code":
            last = (s - 30) % 8 >= 6
            for k, st in enumerate((2, 6, 10, 14)):
                m = r + 12 if (last and k == 3) else r
                note(s + st * S16, m, 0.2, 0.8 if k % 2 == 0 else 0.72)
            if h.chance(0.35):
                note(s + 15 * S16, r + 12, 0.1, 0.5)
        elif sc == "site":
            # rolling 16ths on the three off-kick steps, octave on the last of each group
            for b in range(4):
                for j in (1, 2, 3):
                    m = r + 12 if (j == 3 and b % 2 == 1) else r
                    if b == 3 and j == 3 and (s - 56) % 8 >= 6:
                        m = r + 7
                    note(s + (b * 4 + j) * S16, m, 0.1, [0, 0.72, 0.62, 0.68][j])
        elif sc == "blind":
            note(s, r, L, 0.42, "sub")
        elif sc in ("repodemo", "webdemo"):
            pat = [(2, 0, 0.78), (3, 12, 0.5), (6, 0, 0.72), (8 + 3, 12, 0.55), (10, 0, 0.75), (13, 7, 0.55),
                   (14, 0, 0.7)]
            if sc == "webdemo":
                pat = [(2, 0, 0.78), (6, 0, 0.72), (7, 12, 0.55), (10, 0, 0.75), (12 + 2, 0, 0.7), (15, 12, 0.5)]
            for st, iv, v in pat:
                note(s + st * S16, r + iv, 0.16, v * 0.9)
        elif sc == "safety":
            for st in range(0, 16, 2):   # the soft pulse: muted 8ths
                note(s + st * S16, r, 0.12, 0.38 if st % 4 else 0.46, "pulse")
        elif sc == "results":
            if s < 188:
                note(s, r, L, 0.5, "sub")
            elif s < 196:
                for k, st in enumerate((2, 6, 10, 14)):
                    note(s + st * S16, r, 0.2, 0.78)
            elif s < 202:
                for b in range(4):
                    for j in (1, 2, 3):
                        note(s + (b * 4 + j) * S16, r + (12 if j == 3 else 0), 0.1, 0.72)
            elif s < 205:
                pass        # the bass leaves for the last bar of the build
            else:
                for b in range(int(round(L / BEAT))):
                    for j in (1, 2, 3):
                        note(s + (b * 4 + j) * S16, r + (12 if (j == 3 and b % 2) else 0), 0.1, 0.85)
        elif sc == "end":
            note(s, r, 9.0, 0.32, "sub")     # a soft low F under the ringing chord
    return out


# ---------------------------------------------------------------- arp

ARP_PATTERNS = {
    "hook": [0, 2, 1, 3, 0, 2, 1, 4, 0, 2, 1, 3, 0, 2, 4, 3],
    "stack": [0, 2, 1, 3, 0, 2, 1, 4, 0, 2, 1, 3, 0, 2, 4, 5],
    "code": [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 5],
    "site": [0, 2, 4, 1, 3, 5, 2, 4, 6, 3, 5, 0, 4, 6, 1, 5],    # 3-against-4 groups
    "demo": [0, None, 2, 3, None, 1, 4, None, 0, None, 2, 5, None, 3, 4, None],
    "results": [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6],
    "end": [0, 2, 1, 3, 0, 2, 1, 4, 0, 2, 1, 3, 0, 2, 4, 3],
}


def arp():
    """16th-note arpeggio notes (time, midi, vel, scene, cut) from each chord's tones in C5..F6."""
    h = Human("arp")
    out = []
    for s, e, n in PROG:
        sc = scene_at(s)
        if sc in ("blind", "safety"):
            continue
        root, tones, col = CHORD[n]
        lo, hi = (72, 91) if sc not in ("repodemo", "webdemo") else (65, 84)
        pool = tones_in(tones + ([col] if sc in ("code", "site", "results") else []), lo, hi)
        pat = ARP_PATTERNS["demo" if sc in ("repodemo", "webdemo") else sc]
        steps = int(round((e - s) / S16))
        for k in range(steps):
            t = s + k * S16
            if in_gap(t) or (sc == "results" and 202 <= t < 205 and k % 2):
                continue
            if sc == "end" and t > 219.0:
                break
            p = pat[k % 16]
            if p is None:
                continue
            m = pool[p % len(pool)]
            if sc == "site" and (k // 16) % 2 == 1 and p >= 3:
                m = pool[(p + 1) % len(pool)]     # every other bar the top shifts
            acc = 1.0 if k % 4 == 0 else (0.78 if k % 2 == 0 else 0.62)
            sw = 0.008 if k % 2 else 0.0
            out.append(dict(t=t + sw + h.dt(2, 4), m=m, v=h.vel(acc, 0.08), sc=sc,
                            gate=0.09 if sc != "demo" else 0.11))
    return out


# ---------------------------------------------------------------- lead (the hook in the demos and the drop)

_A = [(77 + 10, 0, .75), (84, .75, .75), (80, 1.5, 1.0), (84, 3, .5), (87, 3.5, .5),
      (82, 4, 1.5), (79, 5.5, .5), (82, 6, .5), (84, 6.5, 1.5),
      (80, 8, 1.5), (84, 9.5, .5), (89, 10, 1.0), (87, 11, .5), (84, 11.5, .5),
      (85, 12, 1.5), (84, 13.5, .5), (80, 14, 2.0)]
_A2 = _A[:13] + [(89, 12, 1.0), (87, 13, .5), (85, 13.5, .5), (84, 14, 2.0)]
_B = [(89, 0, .75), (85, .75, .75), (80, 1.5, 1.0), (85, 3, .5), (89, 3.5, .5),
      (87, 4, 1.5), (84, 5.5, .5), (87, 6, .5), (84, 6.5, 1.5),
      (82, 8, 1.5), (87, 9.5, .5), (91, 10, 1.0), (89, 11, .5), (87, 11.5, .5),
      (89, 12, 1.5), (87, 13.5, .5), (84, 14, 2.0)]
_B2 = _B[:13] + [(84, 12, 1.0), (85, 13, .5), (87, 13.5, .5), (89, 14, 2.0)]


def lead():
    h = Human("lead")
    out = []

    def phrase(t0, notes, vel=0.85, harm=False, oct_=0):
        for k, (m, b, d) in enumerate(notes):
            v = vel * (1.0 if b % 2 == 0 else 0.88)
            out.append(dict(t=t0 + b * BEAT + h.dt(3, 6), m=m + oct_, d=d * BEAT * 0.92, v=h.vel(v, 0.06)))
            if harm:   # a diatonic third below, from the chord sounding then
                ch = CHORD[chord_at(t0 + b * BEAT + 0.01)]
                pcs = ch[1] + [ch[2]]
                below = [x for x in range(m - 5, m - 2) if x % 12 in pcs]
                if below:
                    out.append(dict(t=t0 + b * BEAT + h.dt(3, 6), m=below[-1], d=d * BEAT * 0.92,
                                    v=h.vel(v * 0.55, 0.06), harm=True))

    phrase(108, _A, 0.8)
    phrase(116, _A2, 0.85)
    phrase(124, _A, 0.9, harm=True)
    phrase(132, _B, 0.85)
    phrase(140, _B2, 0.85)
    phrase(156, _B, 0.9, harm=True)
    # the drop: the hook comes back over Fm - Db - Eb, landing on F at 210
    drop = [(80, 0, 1.5), (84, 1.5, .5), (89, 2, 1.0), (87, 3, .5), (84, 3.5, .5),
            (85, 4, 1.5), (84, 5.5, .5), (82, 6, 1.0), (79, 7, 1.0), (84, 8, .5), (89, 8.5, .25)]
    phrase(DROP, drop, 0.95, harm=True)
    out.append(dict(t=210.0, m=89, d=3.0, v=0.7))
    return out


# ---------------------------------------------------------------- bell melody (the breakdown)

def bells():
    seq = [(82, [(77, 0, 3), (80, 3, 1)]), (84, [(84, 0, 2), (80, 2, 2)]),
           (86, [(85, 0, 3), (84, 3, 1)]), (88, [(82, 0, 2), (77, 2, 2)]),
           (90, [(80, 0, 3), (79, 3, 1)]), (92, [(84, 0, 2), (80, 2, 1), (79, 3, 1)]),
           (94, [(77, 0, 3), (80, 3, 1)]), (96, [(79, 0, 2), (82, 2, 2)]),
           (98, [(87, 0, 2), (85, 2, 1), (82, 3, 1)])]
    h = Human("bells")
    out = []
    for t0, ns in seq:
        for m, b, d in ns:
            out.append(dict(t=t0 + b * BEAT + h.dt(4, 8), m=m, d=d * BEAT, v=h.vel(0.7 if b == 0 else 0.55, 0.1)))
    # a few soft bell notes in the calm safety scene too (one per two bars)
    for t0, m in ((164, 80), (168, 84), (172, 82), (176, 79)):
        out.append(dict(t=t0 + h.dt(4, 8), m=m, d=1.0, v=0.4))
    return out
