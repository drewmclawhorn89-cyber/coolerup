#!/usr/bin/env python3
"""Generate the 10 Christmas sounds used by the Coolerup Christmas update.

Every melody here is a traditional carol that is in the public domain, so the
generated audio is copyright-safe (same rule as the rest of the sound library:
no commercial recordings). Each track is a short, loopable bell/synth
arrangement written to public/sounds/christmas/<slug>.mp3.

Usage:
    python3 scripts/generate-christmas-sounds.py

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
BEAT = 0.30  # seconds per quarter note

NOTES = {
    "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
    "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11,
}


def freq(note: str) -> float:
    """'A4' -> 440.0"""
    name, octave = note[:-1], int(note[-1])
    semitone = NOTES[name] + (octave - 4) * 12
    return 440.0 * (2 ** ((semitone - 9) / 12))


# Each melody is a list of (note, beats). "-" is a rest.
MELODIES: dict[str, list[tuple[str, float]]] = {
    "jingle-bells": [
        ("E4", 1), ("E4", 1), ("E4", 2),
        ("E4", 1), ("E4", 1), ("E4", 2),
        ("E4", 1), ("G4", 1), ("C4", 1.5), ("D4", 0.5), ("E4", 4),
        ("F4", 1), ("F4", 1), ("F4", 1.5), ("F4", 0.5),
        ("F4", 1), ("E4", 1), ("E4", 1), ("E4", 0.5), ("E4", 0.5),
        ("E4", 1), ("D4", 1), ("D4", 1), ("E4", 1), ("D4", 2), ("G4", 2),
        ("E4", 1), ("E4", 1), ("E4", 2),
        ("E4", 1), ("E4", 1), ("E4", 2),
        ("E4", 1), ("G4", 1), ("C4", 1.5), ("D4", 0.5), ("E4", 4),
        ("F4", 1), ("F4", 1), ("F4", 1.5), ("F4", 0.5),
        ("F4", 1), ("E4", 1), ("E4", 1), ("E4", 0.5), ("E4", 0.5),
        ("G4", 1), ("G4", 1), ("F4", 1), ("D4", 1), ("C4", 4),
    ],
    "we-wish-you-a-merry-christmas": [
        ("C4", 1), ("F4", 1), ("F4", 0.5), ("G4", 0.5), ("F4", 1), ("E4", 1), ("D4", 2),
        ("C4", 1), ("F4", 1), ("F4", 0.5), ("G4", 0.5), ("F4", 1), ("E4", 1), ("D4", 2),
        ("C4", 1), ("F4", 1), ("F4", 0.5), ("G4", 0.5), ("F4", 1), ("E4", 1), ("D4", 2),
        ("C4", 1), ("F4", 1), ("F4", 0.5), ("G4", 0.5), ("F4", 1), ("E4", 1), ("D4", 2),
        ("C4", 1), ("F4", 1), ("F4", 1), ("F4", 1), ("E4", 1), ("D4", 1), ("C4", 2),
        ("G4", 1), ("A4", 1), ("A4", 1), ("A4", 1), ("G4", 1), ("F4", 1), ("E4", 2),
        ("F4", 1), ("F4", 1), ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1), ("C4", 3),
    ],
    "deck-the-halls": [
        ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
        ("C4", 1), ("D4", 1), ("E4", 1), ("F4", 1),
        ("G4", 1), ("G4", 1), ("G4", 2),
        ("A4", 1), ("A4", 1), ("A4", 2),
        ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
        ("C4", 1), ("D4", 1), ("E4", 1), ("F4", 1),
        ("G4", 1), ("G4", 1), ("G4", 2),
        ("F4", 1), ("E4", 1), ("D4", 1), ("C4", 3),
        ("D4", 1), ("D4", 1), ("E4", 1), ("F4", 1),
        ("G4", 1), ("G4", 1), ("G4", 2),
        ("F4", 1), ("F4", 1), ("F4", 1), ("E4", 1),
        ("D4", 1), ("D4", 1), ("D4", 2),
        ("E4", 1), ("E4", 1), ("E4", 1), ("D4", 1),
        ("C4", 1), ("C4", 1), ("C4", 2),
        ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
        ("C4", 4),
    ],
    "silent-night": [
        ("G4", 2), ("A4", 1), ("G4", 1), ("E4", 4),
        ("G4", 2), ("A4", 1), ("G4", 1), ("E4", 4),
        ("D5", 2), ("D5", 1), ("B4", 3),
        ("C5", 2), ("C5", 1), ("G4", 3),
        ("A4", 2), ("A4", 1), ("C5", 1), ("B4", 2), ("A4", 1), ("G4", 1),
        ("A4", 2), ("A4", 1), ("C5", 1), ("B4", 2), ("A4", 1), ("G4", 1),
        ("A4", 2), ("A4", 1), ("C5", 1), ("B4", 2), ("A4", 1), ("G4", 1),
        ("E4", 2), ("G4", 1), ("G4", 1), ("D4", 1), ("B4", 2), ("C5", 3),
    ],
    "o-christmas-tree": [
        ("G4", 1), ("G4", 1), ("G4", 1), ("E4", 1),
        ("F4", 1), ("F4", 1), ("F4", 1), ("D4", 1),
        ("C4", 1), ("C4", 1), ("D4", 1), ("E4", 1),
        ("F4", 1), ("F4", 1), ("G4", 1), ("G4", 1),
        ("G4", 1), ("G4", 1), ("G4", 1), ("E4", 1),
        ("F4", 1), ("F4", 1), ("F4", 1), ("D4", 1),
        ("C4", 1), ("C4", 1), ("D4", 1), ("E4", 1),
        ("F4", 1), ("F4", 1), ("G4", 1), ("G4", 1),
        ("D4", 1), ("D4", 1), ("D4", 1), ("D4", 1),
        ("E4", 1), ("E4", 1), ("E4", 1), ("E4", 1),
        ("F4", 1), ("F4", 1), ("F4", 1), ("F4", 1),
        ("E4", 1), ("E4", 1), ("E4", 1), ("E4", 1),
        ("D4", 1), ("D4", 1), ("D4", 1), ("D4", 1),
        ("C4", 1), ("C4", 1), ("C4", 1), ("C4", 1),
        ("E4", 1), ("E4", 1), ("E4", 1), ("E4", 1),
        ("G4", 1), ("G4", 1), ("G4", 1), ("G4", 1),
        ("C5", 4),
    ],
    "joy-to-the-world": [
        ("D5", 1), ("C5", 1), ("B4", 1), ("A4", 1),
        ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
        ("E4", 1), ("F4", 1), ("G4", 1), ("A4", 1),
        ("B4", 1), ("C5", 1), ("D5", 2),
        ("D5", 1), ("C5", 1), ("B4", 1), ("A4", 1),
        ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
        ("C4", 1), ("D4", 1), ("E4", 1), ("F4", 1),
        ("G4", 1), ("A4", 1), ("G4", 2),
        ("G4", 1), ("A4", 1), ("B4", 1), ("C5", 1),
        ("D5", 1), ("E5", 1), ("D5", 2),
        ("D5", 1), ("C5", 1), ("B4", 1), ("A4", 1),
        ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 1),
        ("C4", 1), ("E4", 1), ("G4", 1), ("C5", 1),
        ("C5", 4),
    ],
    "the-first-noel": [
        ("G4", 1), ("G4", 1), ("A4", 1), ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 3),
        ("E4", 1), ("F4", 1), ("G4", 1), ("A4", 1), ("B4", 1), ("C5", 1), ("B4", 3),
        ("A4", 1), ("G4", 1), ("A4", 1), ("B4", 1), ("A4", 1), ("G4", 1), ("F4", 1), ("E4", 1),
        ("D4", 1), ("E4", 1), ("F4", 1), ("G4", 1), ("A4", 1), ("G4", 1), ("F4", 1), ("E4", 1),
        ("D4", 1), ("E4", 1), ("F4", 1), ("G4", 1), ("A4", 1), ("B4", 1), ("C5", 1), ("D5", 1),
        ("C5", 1), ("B4", 1), ("A4", 1), ("G4", 1), ("A4", 1), ("B4", 1), ("A4", 1), ("G4", 1),
        ("F4", 1), ("E4", 1), ("D4", 1), ("E4", 1), ("F4", 1), ("G4", 1), ("A4", 1), ("G4", 1),
        ("F4", 1), ("E4", 1), ("D4", 1), ("C4", 3),
    ],
    "away-in-a-manger": [
        ("C4", 1), ("C4", 1), ("G4", 1), ("G4", 1),
        ("A4", 1), ("A4", 1), ("G4", 2),
        ("F4", 1), ("F4", 1), ("E4", 1), ("E4", 1),
        ("D4", 1), ("D4", 1), ("C4", 2),
        ("G4", 1), ("G4", 1), ("F4", 1), ("F4", 1),
        ("E4", 1), ("E4", 1), ("D4", 2),
        ("G4", 1), ("G4", 1), ("F4", 1), ("F4", 1),
        ("E4", 1), ("E4", 1), ("D4", 2),
        ("C4", 1), ("C4", 1), ("G4", 1), ("G4", 1),
        ("A4", 1), ("A4", 1), ("G4", 2),
        ("F4", 1), ("F4", 1), ("E4", 1), ("E4", 1),
        ("D4", 1), ("D4", 1), ("C4", 3),
    ],
    "hark-the-herald-angels-sing": [
        ("G4", 1), ("G4", 1), ("G4", 1),
        ("G4", 1), ("A4", 1), ("B4", 2),
        ("A4", 1), ("G4", 1), ("A4", 1), ("B4", 1),
        ("C5", 2), ("B4", 2),
        ("G4", 1), ("G4", 1), ("G4", 1),
        ("G4", 1), ("A4", 1), ("B4", 2),
        ("A4", 1), ("G4", 1), ("A4", 1), ("B4", 1),
        ("C5", 2), ("B4", 2),
        ("B4", 1), ("B4", 1), ("B4", 1), ("B4", 1),
        ("C5", 1), ("B4", 1), ("A4", 1), ("G4", 1),
        ("A4", 1), ("A4", 1), ("A4", 1), ("A4", 1),
        ("B4", 1), ("A4", 1), ("G4", 1), ("F4", 1),
        ("G4", 1), ("A4", 1), ("B4", 1), ("C5", 1),
        ("D5", 2), ("C5", 2),
        ("B4", 1), ("A4", 1), ("G4", 1), ("A4", 1),
        ("B4", 1), ("C5", 1), ("B4", 1), ("A4", 1),
        ("G4", 4),
    ],
    "o-come-all-ye-faithful": [
        ("G4", 1), ("G4", 1), ("A4", 1), ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 2),
        ("G4", 1), ("A4", 1), ("B4", 1), ("C5", 1), ("B4", 1), ("A4", 1), ("G4", 2),
        ("G4", 1), ("G4", 1), ("A4", 1), ("G4", 1), ("F4", 1), ("E4", 1), ("D4", 2),
        ("G4", 1), ("A4", 1), ("B4", 1), ("C5", 1), ("B4", 1), ("A4", 1), ("G4", 2),
        ("D5", 1), ("D5", 1), ("B4", 1), ("G4", 1), ("A4", 1), ("B4", 1), ("C5", 2),
        ("D5", 1), ("C5", 1), ("B4", 1), ("A4", 1), ("G4", 1), ("A4", 1), ("B4", 2),
        ("D5", 1), ("D5", 1), ("B4", 1), ("G4", 1), ("A4", 1), ("B4", 1), ("C5", 2),
        ("D5", 1), ("C5", 1), ("B4", 1), ("A4", 1), ("G4", 1), ("A4", 1), ("G4", 3),
    ],
}


def synth(melody: list[tuple[str, float]]) -> list[float]:
    """Render a melody into a mono float buffer (bell-ish tone + soft bass)."""
    total = sum(beats for _, beats in melody) * BEAT
    length = int(total * SAMPLE_RATE) + SAMPLE_RATE // 2
    buf = [0.0] * length

    t_cursor = 0.0
    for note, beats in melody:
        dur = beats * BEAT
        start = int(t_cursor * SAMPLE_RATE)
        if note != "-":
            f = freq(note)
            n = int(dur * SAMPLE_RATE)
            for i in range(n):
                t = i / SAMPLE_RATE
                env = math.exp(-3.2 * t) * min(1.0, t * 220)
                # fundamental + a couple of quiet partials = music-box timbre
                sample = (
                    math.sin(2 * math.pi * f * t)
                    + 0.35 * math.sin(2 * math.pi * f * 2 * t)
                    + 0.12 * math.sin(2 * math.pi * f * 3 * t)
                )
                idx = start + i
                if idx < length:
                    buf[idx] += 0.30 * env * sample
            # bass an octave down on the beat
            bf = f / 2
            for i in range(min(n, int(0.5 * SAMPLE_RATE))):
                t = i / SAMPLE_RATE
                env = math.exp(-5.0 * t)
                idx = start + i
                if idx < length:
                    buf[idx] += 0.16 * env * math.sin(2 * math.pi * bf * t)
        t_cursor += dur

    # Simple feedback delay for a bit of room.
    delay = int(0.14 * SAMPLE_RATE)
    for i in range(delay, length):
        buf[i] += 0.18 * buf[i - delay]

    peak = max(1e-9, max(abs(x) for x in buf))
    return [x / peak * 0.85 for x in buf]


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
    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "sounds", "christmas")
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    for slug, melody in MELODIES.items():
        samples = synth(melody)
        with tempfile.TemporaryDirectory() as tmp:
            wav_path = os.path.join(tmp, f"{slug}.wav")
            write_wav(wav_path, samples)
            mp3_path = os.path.join(out_dir, f"{slug}.mp3")
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
