"""Renders the app's UI sounds to WAV files in assets/sounds/, the way Web Audio would play them.

A sound is a list of voices, each starting `at` ms in and lasting `ms`, shaped by a gain envelope
(linear rise to `gain` over `atk` ms, then an exponential fall to silence at the end):
- noise: white noise through a band-pass filter (centre `hz`, quality `q`);
- tone: an oscillator (`wave` sine or triangle) at `hz`, gliding to `to` if given, through a
  low-pass filter at `cut` if given.

    python scripts/make-sounds.py
"""
import math
import os
import random
import struct
import wave

RATE = 44100
# Master volume, as the sound tool plays them (pitch 1.0x, volume 200%).
VOLUME = 2.0

SOUNDS = {
    # Toggles and segmented choices (theme, effort): a quick paper-feed ratchet.
    'print': [
        dict(hz=hz, ms=6, gain=0.018, q=4, atk=1, at=at)
        for at, hz in zip(range(0, 243, 22), [5200, 4800, 4400] * 4)
    ],
    # The PC came online (the big tick): a rising glide, then three notes up and a shimmer.
    'landed': [
        dict(tone=1, hz=330, to=620, ms=120, gain=0.018, wave='triangle', cut=1400, atk=30, at=0),
        dict(tone=1, hz=784, ms=120, gain=0.04, wave='sine', cut=2600, atk=4, at=70),
        dict(tone=1, hz=1047, ms=130, gain=0.04, wave='sine', cut=2800, atk=4, at=140),
        dict(tone=1, hz=1319, ms=520, gain=0.044, wave='sine', cut=3000, atk=5, at=210),
        dict(tone=1, hz=2638, ms=320, gain=0.007, wave='sine', atk=8, at=215),
    ],
}


def bandpass(samples, hz, q):
    """RBJ band-pass biquad (constant 0 dB peak gain), as Web Audio's BiquadFilterNode 'bandpass'."""
    w0 = 2 * math.pi * hz / RATE
    alpha = math.sin(w0) / (2 * q)
    b0, b1, b2 = alpha, 0.0, -alpha
    a0, a1, a2 = 1 + alpha, -2 * math.cos(w0), 1 - alpha
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    out, x1, x2, y1, y2 = [], 0.0, 0.0, 0.0, 0.0
    for x in samples:
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out.append(y)
        x2, x1, y2, y1 = x1, x, y1, y
    return out


def lowpass(samples, hz, q=1.0):
    """RBJ low-pass biquad, as Web Audio's 'lowpass' (default Q 1)."""
    w0 = 2 * math.pi * hz / RATE
    alpha = math.sin(w0) / (2 * q)
    cos = math.cos(w0)
    b0, b1, b2 = (1 - cos) / 2, 1 - cos, (1 - cos) / 2
    a0, a1, a2 = 1 + alpha, -2 * cos, 1 - alpha
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    out, x1, x2, y1, y2 = [], 0.0, 0.0, 0.0, 0.0
    for x in samples:
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out.append(y)
        x2, x1, y2, y1 = x1, x, y1, y
    return out


def tone(b, n):
    """An oscillator over n samples; `to` glides the pitch exponentially, as Web Audio's ramp."""
    out, phase = [], 0.0
    for i in range(n):
        f = b['hz'] * (b['to'] / b['hz']) ** (i / n) if b.get('to') else b['hz']
        phase = (phase + f / RATE) % 1.0
        if b.get('wave') == 'triangle':
            out.append(4 * abs(phase - 0.5) - 1)
        else:
            out.append(math.sin(2 * math.pi * phase))
    return lowpass(out, b['cut']) if b.get('cut') else out


def render(bursts, seed=7):
    rnd = random.Random(seed)
    end_ms = max(b.get('at', 0) + b['ms'] for b in bursts) + 4
    mix = [0.0] * int(RATE * end_ms / 1000)
    for b in bursts:
        n = int(RATE * b['ms'] / 1000)
        if b.get('tone'):
            noise = tone(b, n)
        else:
            # A little noise before the burst so the filter has settled when it starts.
            lead = 64
            noise = bandpass([rnd.uniform(-1, 1) for _ in range(n + lead)], b['hz'], b['q'])[lead:]
        atk = max(1, int(RATE * b['atk'] / 1000))
        start = int(RATE * b.get('at', 0) / 1000)
        for i in range(n):
            if i < atk:
                env = b['gain'] * i / atk
            else:
                # Exponential ramp from `gain` to 0.0001 between the attack and the end.
                t = (i - atk) / max(1, n - atk)
                env = b['gain'] * (0.0001 / b['gain']) ** t
            if start + i < len(mix):
                mix[start + i] += noise[i] * env * VOLUME
    return mix


def write(name, mix):
    out = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sounds')
    os.makedirs(out, exist_ok=True)
    with wave.open(os.path.join(out, f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, int(s * 32767)))) for s in mix))


for name, bursts in SOUNDS.items():
    write(name, render(bursts))
    print(name, 'ok')
