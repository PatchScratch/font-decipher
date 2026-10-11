/**
 * decipher.js — decode font-substitution anti-scrape text in the browser.
 *
 * Some sites render readable English through a custom webfont whose Latin
 * letters live at exotic codepoints (Kangxi radicals, Private Use…). The page
 * LOOKS fine; the DOM text is gibberish, defeating extractors, copy-paste,
 * search, screen readers, TTS — everything. This module turns the DOM text
 * back into real characters.
 *
 * Usage (browser or Node):
 *   const { decipher, looksSubstituted, loadMap } = require('./decipher.js')
 *   decipher("⽕⽣⽠ ⽣⽠⽜⽭⽯⽧⽠")            // => "Fire..." (built-in ladder)
 *   decipher(text, customMap)              // with a map from derive_cipher.py
 *   looksSubstituted(text)                 // => boolean (ladder dominance)
 *
 * Safety: decoding only fires when substituted codepoints dominate the text,
 * so genuine Chinese/Japanese prose in the wide CJK ranges is never touched.
 * The built-in map covers storyseedling.com's "Vagre" font (verified
 * 2026-10-11). Derive maps for other fonts with derive_cipher.py.
 */

// storyseedling.com / Vagre: U+2F42..U+2F5B -> A-Z, U+2F5C..U+2F75 -> a-z
const BUILTIN_MAP = (() => {
  const m = {};
  for (let c = 0x2f42; c <= 0x2f5b; c++) m[String.fromCodePoint(c)] = String.fromCharCode(65 + c - 0x2f42);
  for (let c = 0x2f5c; c <= 0x2f75; c++) m[String.fromCodePoint(c)] = String.fromCharCode(97 + c - 0x2f5c);
  return m;
})();

/** Ratio of characters covered by the map above which we decode (0-1). */
const DOMINANCE_THRESHOLD = 0.3;

function charRatio(text, map) {
  if (!text) return 0;
  let hits = 0;
  for (const ch of text) {
    if (Object.prototype.hasOwnProperty.call(map, ch)) hits++;
  }
  return hits / text.length;
}

/** True when the text is dominated by mapped (substituted) codepoints. */
function looksSubstituted(text, map = BUILTIN_MAP) {
  return charRatio(text, map) >= DOMINANCE_THRESHOLD;
}

/**
 * Decode text. Returns the decoded string when substitution dominates,
 * otherwise the original text untouched (protects real CJK prose).
 */
function decipher(text, map = BUILTIN_MAP, threshold = DOMINANCE_THRESHOLD) {
  if (!text || charRatio(text, map) < threshold) return text;
  let out = "";
  for (const ch of text) {
    out += Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch;
  }
  return out;
}

/**
 * Build a map object from the JSON derive_cipher.py emits
 * ({"U+2F42": "A", ...}) — handy for custom hosts:
 *   const map = loadMap(JSON.parse(fs.readFileSync("map.json", "utf8")))
 */
function loadMap(json) {
  const m = {};
  for (const [cp, ch] of Object.entries(json)) {
    m[String.fromCodePoint(parseInt(cp.replace("U+", ""), 16))] = ch;
  }
  return m;
}

if (typeof module !== "undefined") {
  module.exports = { decipher, looksSubstituted, loadMap, BUILTIN_MAP };
}
