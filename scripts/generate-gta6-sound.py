#!/usr/bin/env python3
"""Generate the "GTA 6 - Beat" sound used by the Coolerup GTA 6 update.

Everything here is synthesised from scratch (no samples, no commercial
recordings), so the track is copyright-safe like the rest of the sound library.
It is a short, loopable synthwave/vice-city style beat written to
public/sounds/gta6/gta6-beat.mp3.

Usage:
    python3 scripts/generate-gta6-sound.py

Requires ffmpeg on PATH for the mp3 encode (wav is written first).
"""
from __future__ import annotations

import math
import os
import struct
import subprocess
import tempfile
import wave

SAMPLE_RATE = 44100
BPM = 112.0
BEAT = 60.0 / BPM  # seconds per quarter note
STEP = BEAT / 4.0  # 16th note

NOTES = {
    "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
    "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11,
}


def freq(note: str) -> float:
    """'A4' -> 440.0"""
    name, octave = note[:-1], int(note[-1])
    semitone = NOTES[name] + (octave - 4) * 12
    return 440.0 * (2 ** ((semitone - 9) / 12))


def saw(f: float, t: float) -> float:
    """Band-limited-ish saw built from the first few harmonics."""
    out = 0.0
    for h in range(1, 7):
        out += math.sin(2 * math.pi * f * h * t) / h
    return out * 0.55


# Chord progression: Am - F - C - G, one bar per chord.
PROGRESSION = ["A2", "F2", "C2", "G2"]

# Lead hook, one entry per 16th step of a 2-bar phrase ("-" = rest).
LEAD = [
    "E5", "-", "A5", "-", "C6", "-", "A5", "-",
    "F5", "-", "A5", "-", "C6", "-", "D6", "-",
    "E6", "-", "C6", "-", "G5", "-", "C6", "-",
    "D6", "-", "B5", "-", "G5", "-", "D5", "-",
]


def render() -> list[float]:
    bars = 8  # 8 bars = 2 passes of the progression
    steps = bars * 16
    length = int(steps * STEP * SAMPLE_RATE) + SAMPLE_RATE // 2
    buf = [0.0] * length

    def add(idx: int, value: float) -> None:
        if 0 <= idx < length:
            buf[idx] += value

    for step in range(steps):
        bar = step // 16
        pos = step % 16
        root = PROGRESSION[bar % len(PROGRESSION)]
        root_f = freq(root)
        start = int(step * STEP * SAMPLE_RATE)

        # --- Bass: driving 16th arpeggio, octave jump on the off-beats -------
        bass_f = root_f * (2 if pos % 4 == 2 else 1)
        n = int(STEP * SAMPLE_RATE * 0.92)
        for i in range(n):
            t = i / SAMPLE_RATE
            env = math.exp(-9.0 * t) * min(1.0, t * 900)
            add(start + i, 0.30 * env * saw(bass_f, t))

        # --- Pad: sustained chord tone every 4 steps -------------------------
        if pos % 4 == 0:
            pad_f = root_f * 4
            n = int(STEP * 4 * SAMPLE_RATE)
            for i in range(n):
                t = i / SAMPLE_RATE
                env = min(1.0, t * 8) * math.exp(-1.4 * t)
                add(start + i, 0.055 * env * saw(pad_f * 1.005, t))

        # --- Drums -----------------------------------------------------------
        if pos in (0, 6, 8, 14):  # kick
            n = int(0.16 * SAMPLE_RATE)
            for i in range(n):
                t = i / SAMPLE_RATE
                f = 130 * math.exp(-26 * t) + 42
                env = math.exp(-11 * t)
                add(start + i, 0.55 * env * math.sin(2 * math.pi * f * t))

        if pos in (4, 12):  # snare / clap
            n = int(0.18 * SAMPLE_RATE)
            for i in range(n):
                t = i / SAMPLE_RATE
                env = math.exp(-16 * t)
                noise = math.sin(2 * math.pi * 1900 * t) * 0.5 + math.sin(
                    2 * math.pi * 3100 * t
                ) * 0.3
                add(start + i, 0.22 * env * noise)

        if pos % 2 == 0:  # closed hat on 8ths
            n = int(0.045 * SAMPLE_RATE)
            for i in range(n):
                t = i / SAMPLE_RATE
                env = math.exp(-70 * t)
                add(start + i, 0.10 * env * math.sin(2 * math.pi * 8200 * t))

        # --- Lead hook -------------------------------------------------------
        note = LEAD[(bar % 2) * 16 + pos]
        if note != "-":
            f = freq(note)
            n = int(STEP * SAMPLE_RATE * 1.6)
            for i in range(n):
                t = i / SAMPLE_RATE
                env = math.exp(-3.4 * t) * min(1.0, t * 400)
                add(start + i, 0.16 * env * saw(f, t))

    # Feedback delay for that wide neon-night feel.
    delay = int(0.19 * SAMPLE_RATE)
    for i in range(delay, length):
        buf[i] += 0.22 * buf[i - delay]

    peak = max(1e-9, max(abs(x) for x in buf))
    return [x / peak * 0.88 for x in buf]


def write_wav(path: str, samples: list[float]) -> None:
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for s in samples:
            frames += struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767))
        w.writeframes(bytes(frames))


def main() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "sounds", "gta6")
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    samples = render()
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, "gta6-beat.wav")
        write_wav(wav_path, samples)
        mp3_path = os.path.join(out_dir, "gta6-beat.mp3")
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
                "-codec:a", "libmp3lame", "-b:a", "128k", "-ar", "44100",
                "-ac", "1", mp3_path,
            ],
            check=True,
        )
    print(f"wrote {mp3_path} ({len(samples) / SAMPLE_RATE:.1f}s)")


if __name__ == "__main__":
    main()
