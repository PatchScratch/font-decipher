#!/usr/bin/env python3
"""
decipher.py — Python port of decipher.js (server-side / pipelined decoding).

    python3 decipher.py                      # read stdin, write stdout
    python3 decipher.py obfuscated.txt -o clean.txt
    from decipher import decipher, looks_substituted, load_map
"""
import argparse
import json
import sys

# storyseedling.com / Vagre: U+2F42..U+2F5B -> A-Z, U+2F5C..U+2F75 -> a-z
BUILTIN_MAP = {}
for _c in range(0x2F42, 0x2F5B + 1):
    BUILTIN_MAP[chr(_c)] = chr(65 + _c - 0x2F42)
for _c in range(0x2F5C, 0x2F75 + 1):
    BUILTIN_MAP[chr(_c)] = chr(97 + _c - 0x2F5C)

DOMINANCE_THRESHOLD = 0.3


def load_map(path):
    """Load a JSON map produced by derive_cipher.py ({"U+2F42": "A", ...})."""
    with open(path) as f:
        raw = json.load(f)
    return {chr(int(k.replace("U+", ""), 16)): v for k, v in raw.items()}


def looks_substituted(text, mapping=BUILTIN_MAP, threshold=DOMINANCE_THRESHOLD):
    if not text:
        return False
    return sum(ch in mapping for ch in text) / len(text) >= threshold


def decipher(text, mapping=BUILTIN_MAP, threshold=DOMINANCE_THRESHOLD):
    """Decode when substitution dominates; never touch genuine CJK prose."""
    if not text or not looks_substituted(text, mapping, threshold):
        return text
    return "".join(mapping.get(ch, ch) for ch in text)


def main():
    ap = argparse.ArgumentParser(description="Decode font-substituted text")
    ap.add_argument("file", nargs="?", help="input file, default stdin")
    ap.add_argument("-o", "--out", help="output file, default stdout")
    ap.add_argument("-m", "--map", help="JSON map from derive_cipher.py "
                                        "(default: built-in StorySeedling ladder)")
    args = ap.parse_args()

    mapping = load_map(args.map) if args.map else BUILTIN_MAP
    data = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()
    result = decipher(data, mapping)

    if args.out:
        open(args.out, "w", encoding="utf-8").write(result)
    else:
        sys.stdout.write(result)


if __name__ == "__main__":
    main()
