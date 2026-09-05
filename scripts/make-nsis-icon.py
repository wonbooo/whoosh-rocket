from pathlib import Path
import struct

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src-tauri" / "icons" / "icon.png"
OUT = ROOT / "src-tauri" / "icons" / "installer.ico"
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64)]


def image_to_dib(im: Image.Image) -> bytes:
    w, h = im.size
    pixels = im.load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            xor += bytes((b, g, r, a))
    row_and = ((w + 31) // 32) * 4
    mask = bytearray()
    for y in range(h - 1, -1, -1):
        row = [0] * row_and
        for x in range(w):
            if pixels[x, y][3] < 128:
                row[x // 8] |= 0x80 >> (x % 8)
        mask += bytes(row)
    header = struct.pack(
        "<IiiHHIIiiII",
        40,
        w,
        h * 2,
        1,
        32,
        0,
        len(xor),
        0,
        0,
        0,
        0,
    )
    return header + xor + mask


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    dibs = [image_to_dib(src.resize(size, Image.Resampling.LANCZOS)) for size in SIZES]
    offset = 6 + 16 * len(SIZES)
    entries = bytearray()
    blobs = bytearray()
    for (w, h), dib in zip(SIZES, dibs, strict=True):
        entries += struct.pack(
            "<BBBBHHII",
            w,
            h,
            0,
            0,
            1,
            32,
            len(dib),
            offset,
        )
        blobs += dib
        offset += len(dib)
    ico = struct.pack("<HHH", 0, 1, len(SIZES)) + entries + blobs
    OUT.write_bytes(ico)
    data = ico
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    print(f"wrote {OUT} bytes={len(data)} reserved={reserved} type={kind} count={count}")
    pos = 6
    for index in range(count):
        width, height, _colors, _res, _planes, bpp, size, off = struct.unpack_from(
            "<BBBBHHII",
            data,
            pos,
        )
        bi_size = struct.unpack_from("<I", data, off)[0]
        print(f"  #{index} {width}x{height} bpp={bpp} size={size} biSize={bi_size}")
        pos += 16


if __name__ == "__main__":
    main()
