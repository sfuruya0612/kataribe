#!/usr/bin/env python3
"""Generate the macOS template tray icon as PNG files."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "build"


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def inside_rounded_rect(
    x: float,
    y: float,
    left: float,
    top: float,
    right: float,
    bottom: float,
    radius: float,
) -> bool:
    if x < left or x > right or y < top or y > bottom:
        return False
    inner_left = left + radius
    inner_right = right - radius
    inner_top = top + radius
    inner_bottom = bottom - radius
    if inner_left <= x <= inner_right or inner_top <= y <= inner_bottom:
        return True
    corner_x = inner_left if x < inner_left else inner_right
    corner_y = inner_top if y < inner_top else inner_bottom
    return (x - corner_x) ** 2 + (y - corner_y) ** 2 <= radius**2


def inside_microphone(x: float, y: float) -> bool:
    capsule = inside_rounded_rect(x, y, 0.32, 0.12, 0.68, 0.58, 0.18)
    stem = 0.46 <= x <= 0.54 and 0.54 <= y <= 0.76
    base = inside_rounded_rect(x, y, 0.28, 0.76, 0.72, 0.84, 0.04)
    return capsule or stem or base


def render(size: int) -> bytes:
    rows = []
    samples = 4
    for pixel_y in range(size):
        row = bytearray([0])
        for pixel_x in range(size):
            covered = 0
            for sample_y in range(samples):
                for sample_x in range(samples):
                    x = (pixel_x + (sample_x + 0.5) / samples) / size
                    y = (pixel_y + (sample_y + 0.5) / samples) / size
                    if inside_microphone(x, y):
                        covered += 1
            alpha = round(255 * covered / (samples * samples))
            row.extend((0, 0, 0, alpha))
        rows.append(bytes(row))

    raw = b"".join(rows)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "trayTemplate.png").write_bytes(render(16))
    (OUTPUT_DIR / "trayTemplate@2x.png").write_bytes(render(32))


if __name__ == "__main__":
    main()
