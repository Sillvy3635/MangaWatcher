"""Generate PNG renditions of the existing SVG mark with Python stdlib."""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / 'public'


def line_distance(x, y, a, b, c, d):
    dx, dy = c - a, d - b
    t = max(0, min(1, ((x - a) * dx + (y - b) * dy) / (dx * dx + dy * dy)))
    return ((x - a - t * dx) ** 2 + (y - b - t * dy) ** 2) ** 0.5


def icon(size):
    rows = []
    segments = [(0.25, 0.5, 0.385, 0.5), (0.385, 0.5, 0.455, 0.35), (0.455, 0.35, 0.55, 0.65), (0.55, 0.65, 0.62, 0.5), (0.62, 0.5, 0.75, 0.5)]
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            x, y = (px + 0.5) / size, (py + 0.5) / size
            diamond = abs(abs(x - 0.5) + abs(y - 0.5) - 0.37) < 0.024
            signal = any(line_distance(x, y, *segment) < 0.015 for segment in segments)
            rgb = (52, 211, 153) if signal else (81, 56, 237) if diamond else (13, 17, 27)
            row.extend((*rgb, 255))
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
        (ROOT / name).write_bytes(icon(size))
