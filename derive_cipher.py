#!/usr/bin/env python3
"""
derive_cipher.py — crack a font-substitution anti-scrape cipher.

Some sites (case study: storyseedling.com) defeat every DOM text extractor by
shipping a custom webfont whose Latin letters live at exotic codepoints
(Kangxi radicals, CJK blocks, private use…). The page RENDERS fine; the text
content is gibberish. The substitution lives in the font's character map —
and obfuscation fonts almost always COPY the letter outlines verbatim from the
font's own ASCII glyphs.

This tool compares each candidate codepoint's glyph outline against the
font's ASCII glyphs (normalized, translation-invariant) and emits the
codepoint -> character map as JSON. Dotted glyphs (i, j) and composites can
compare slightly differently; those are filled in by sequence inference
(the ciphers are almost always linear ladders).

Usage:
    pip install fonttools brotli
    python3 derive_cipher.py font.woff2            # prints JSON map
    python3 derive_cipher.py font.woff2 -o map.json
    python3 derive_cipher.py font.woff2 --range 2F00 2FFF

The font file: fetch it from a logged-in browser session (plain curl usually
hits Cloudflare). In devtools on a chapter page:

    [...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] } })
      .filter(r => r instanceof CSSFontFaceRule && /FONTNAME/i.test(r.style.fontFamily))
      .map(r => r.style.getPropertyValue('src'))
"""
import argparse
import json
import sys

from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

# Blocks where substituted letters are typically parked. Extend as new hosts
# are found. Private Use (E000-F8FF) is a common alternative.
DEFAULT_RANGES = [
    (0x2F00, 0x2FDF),   # Kangxi radicals (storyseedling.com / "Vagre")
    (0xE000, 0xF8FF),   # Private Use Area
]

ASCII = {cp: chr(cp) for cp in range(0x21, 0x7F)}


def outline_signature(glyph):
    """Translation-invariant shape signature: rounded relative coordinates."""
    if glyph is None:
        return None
    pen = RecordingPen()
    glyph.draw(pen)
    if not pen.value:
        return None
    points = []
    for op, args in pen.value:
        for arg in args:
            if hasattr(arg, "x"):  # penUtils point objects
                points.append((arg.x, arg.y))
            elif isinstance(arg, tuple) and len(arg) == 2:
                points.append(arg)
    if not points:
        return None
    x0, y0 = points[0]
    return tuple((round(x - x0, 1), round(y - y0, 1)) for x, y in points)


def derive(font_path, ranges):
    font = TTFont(font_path)
    glyphset = font.getGlyphSet()
    cmap = font.getBestCmap()

    ascii_sigs = {}
    for cp in ASCII:
        name = cmap.get(cp)
        if name:
            sig = outline_signature(glyphset.get(name))
            if sig:
                ascii_sigs[sig] = ASCII[cp]

    mapping = {}
    for lo, hi in ranges:
        for cp in sorted(c for c in cmap if lo <= c <= hi):
            name = cmap[cp]
            sig = outline_signature(glyphset.get(name))
            if sig and sig in ascii_sigs:
                mapping[cp] = ascii_sigs[sig]

    mapping = infer_missing_by_sequence(mapping, ranges, cmap)
    return {f"U+{cp:04X}": ch for cp, ch in sorted(mapping.items())}


def infer_missing_by_sequence(mapping, ranges, cmap):
    """
    Fill gaps by sequence inference: these ciphers are linear step-1 ladders
    (A..Z then a..z at consecutive codepoints). Dotted glyphs (i, j) compare
    slightly differently by outline, so when two matched letters sit exactly
    one-codepoint-per-letter apart, interpolate everything between them.
    """
    by_char = {ch: cp for cp, ch in mapping.items()}
    for seq in ("".join(chr(c) for c in range(0x41, 0x5B)),
                "".join(chr(c) for c in range(0x61, 0x7B)),
                "".join(str(d) for d in range(0, 10))):
        cps = [by_char.get(ch) for ch in seq]
        known = [(i, cp) for i, cp in enumerate(cps) if cp is not None]
        for (ia, cp_a), (ib, cp_b) in zip(known, known[1:]):
            missing = seq[ia + 1: ib]
            if missing and cp_b - cp_a == len(missing) + 1:  # uniform step 1
                for offset, ch in enumerate(missing, start=1):
                    cp = cp_a + offset
                    if cp not in mapping and cp in cmap:
                        mapping[cp] = ch
    return mapping


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("font", help="woff2/woff/ttf/otf file to analyze")
    ap.add_argument("-o", "--out", help="write the map here (JSON), default stdout")
    ap.add_argument("--range", nargs=2, metavar=("LO", "HI"), action="append",
                    help="extra codepoint range to scan, hex (repeatable); "
                         "defaults to Kangxi radicals + Private Use")
    args = ap.parse_args()

    ranges = [(int(lo, 16), int(hi, 16)) for lo, hi in (args.range or [])]
    if not ranges:
        ranges = DEFAULT_RANGES

    mapping = derive(args.font, ranges)
    if not mapping:
        print("no substituted codepoints found — try --range, or the font "
              "uses outlines that differ from its own ASCII (see README)",
              file=sys.stderr)
        sys.exit(1)

    out = json.dumps(mapping, indent=2)
    if args.out:
        with open(args.out, "w") as f:
            f.write(out + "\n")
        print(f"wrote {len(mapping)} mappings to {args.out}", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
