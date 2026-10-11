/**
 * derive_browser.js — derive a font-substitution cipher AT RUNTIME, in the
 * page, from the fonts the page itself loaded. No font download, no native
 * code, no hardcoded tables: rotation-proof by construction (Issue A in the
 * field reports — Qidian-style per-load font renames don't matter because we
 * read the computed font-family off the chapter text, not a stored name).
 *
 * How: render each suspicious codepoint and each ASCII reference at 96px on a
 * canvas in the PAGE'S font, normalize the inked bitmaps, match by IoU.
 * Copies of the font's own glyphs match at ~1.0; confusables (O/0, l/1) sit
 * far below. Bitmaps include the dots, so i/j work without sequence tricks
 * (Issue B). Works for full ladders AND partial substitution (vowels-only
 * schemes: only the substituted set needs to decode). Fails gracefully when
 * the font ships no ASCII glyphs of its own — then shapes can't be compared
 * in-font and callers fall back.
 *
 * Exposed: deriveCipherInPage(text, containerEl) -> Map<string,string> | null
 * and looksSubstituted(text) for cheap pre-checks.
 */
(function (global) {
  "use strict";

  // Blocks where substituted characters get parked (extend as hosts evolve;
  // matches derive_cipher.py's DEFAULT_RANGES plus the wide-CJK decoy range).
  var SUSPICIOUS_RANGES = [
    [0x2f00, 0x2fdf],   // Kangxi radicals (storyseedling)
    [0xe000, 0xf8ff],   // Private Use (Chaleuria-style)
    [0x3400, 0x4dbf]    // CJK ext A
  ];
  // Genuine-prose marker: if the text is full of common CJK it's a real
  // Chinese/Japanese page, not a substitution victim.
  var CJK_RANGE = [0x4e00, 0x9fff];
  // English-likeness vocabulary for validating a decode.
  var COMMON_WORDS = [" the ", " and ", " to ", " of ", " a ", " in ", " that ",
    " is ", " was ", " it ", " for ", " with ", " he ", " she ", " they "];

  function inRange(cp, r) { return cp >= r[0] && cp <= r[1]; }

  function suspiciousRatio(text) {
    if (!text.length) return 0;
    var sus = 0;
    for (var i = 0; i < text.length; i++) {
      var cp = text.charCodeAt(i);
      for (var j = 0; j < SUSPICIOUS_RANGES.length; j++) {
        if (inRange(cp, SUSPICIOUS_RANGES[j])) { sus++; break; }
      }
    }
    return sus / text.length;
  }

  function genuineCjkRatio(text) {
    if (!text.length) return 0;
    var cjk = 0;
    for (var i = 0; i < text.length; i++) {
      if (inRange(text.charCodeAt(i), CJK_RANGE)) cjk++;
    }
    return cjk / text.length;
  }

  /** Cheap gate: worth attempting a derivation? (partial schemes included) */
  function looksSubstituted(text) {
    return suspiciousRatio(text) >= 0.08 && genuineCjkRatio(text) < 0.15;
  }

  // --- canvas glyph masks ---------------------------------------------------

  var SIZE = 48;      // normalized mask edge
  var RENDER = 96;    // render px — big enough for antialias stability

  function glyphMask(ch, fontFamily) {
    var canvas = document.createElement("canvas");
    canvas.width = RENDER; canvas.height = RENDER;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, RENDER, RENDER);
    ctx.fillStyle = "#000";
    ctx.font = RENDER * 0.7 + "px " + fontFamily;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(ch, RENDER * 0.2, RENDER * 0.8);
    var data = ctx.getImageData(0, 0, RENDER, RENDER).data;
    // find inked bbox
    var minX = RENDER, minY = RENDER, maxX = -1, maxY = -1;
    for (var y = 0; y < RENDER; y++) {
      for (var x = 0; x < RENDER; x++) {
        if (data[(y * RENDER + x) * 4 + 3] > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null; // nothing drawn
    // crop bbox, scale to SIZE x SIZE binary mask
    var mask = new Uint8Array(SIZE * SIZE);
    var bw = maxX - minX + 1, bh = maxY - minY + 1;
    // scale preserving aspect into SIZE box
    var scale = SIZE / Math.max(bw, bh);
    var dw = Math.max(1, Math.round(bw * scale));
    var dh = Math.max(1, Math.round(bh * scale));
    var ox = (SIZE - dw) >> 1, oy = (SIZE - dh) >> 1;
    for (var yy = 0; yy < dh; yy++) {
      var sy = minY + Math.floor(yy / scale / 1);
      for (var xx = 0; xx < dw; xx++) {
        var sx = minX + Math.floor(xx / scale / 1);
        var a = data[((sy | 0) * RENDER + (sx | 0)) * 4 + 3];
        if (a > 60) mask[(oy + yy) * SIZE + ox + xx] = 1;
      }
    }
    return mask;
  }

  function iou(a, b) {
    var inter = 0, union = 0;
    for (var i = 0; i < a.length; i++) {
      var x = a[i] | b[i];
      union += x;
      inter += a[i] & b[i];
    }
    return union ? inter / union : 0;
  }

  /**
   * Derive a cipher map for `text` as rendered inside `containerEl`'s font.
   * Returns Map char -> char (or string for ligatures), or null when the
   * glyphs can't be matched confidently (caller should fall back).
   */
  function deriveCipherInPage(text, containerEl) {
    if (!looksSubstituted(text)) return null;
    // Resolve the font from an actual paragraph, not the container: sites
    // apply the substitution font to <p> via class while the container
    // inherits the site default (learned on storyseedling.com — the container
    // resolved to Poppins and every mask rendered as tofu).
    var probeEl = containerEl.querySelector("p") || containerEl;
    var fontFamily = window.getComputedStyle(probeEl).fontFamily;

    // distinct suspicious codepoints actually used (usually <= 62)
    var used = {};
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var cp = ch.charCodeAt(0);
      for (var j = 0; j < SUSPICIOUS_RANGES.length; j++) {
        if (inRange(cp, SUSPICIOUS_RANGES[j])) { used[ch] = true; break; }
      }
    }
    var suspects = Object.keys(used);
    if (!suspects.length) return null;

    // reference glyphs: letters + digits + common punctuation, same font
    var refs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.,!?-";
    var refMasks = {};
    for (var r = 0; r < refs.length; r++) {
      var m = glyphMask(refs[r], fontFamily);
      if (m) refMasks[refs[r]] = m;
    }

    var map = {};
    for (var s = 0; s < suspects.length; s++) {
      var mask = glyphMask(suspects[s], fontFamily);
      if (!mask) continue;
      var best = null, bestScore = 0, second = 0;
      for (var key in refMasks) {
        var score = iou(mask, refMasks[key]);
        if (score > bestScore) { second = bestScore; bestScore = score; best = key; }
        else if (score > second) { second = score; }
      }
      // Accept confident matches only: near-identical copies score ~0.9+;
      // confusables (O/0, l/I) sit much lower and with less margin.
      if (best && bestScore >= 0.70 && bestScore - second >= 0.08) {
        map[suspects[s]] = best;
      }
    }

    var mapped = Object.keys(map).length;
    if (mapped < Math.max(3, suspects.length * 0.6)) return null; // too shaky

    // sanity: decoded sample must look like English
    var sample = text.slice(0, 1200);
    var decoded = sample.replace(/[\s\S]/g, function (c) { return map[c] || c; });
    var hits = 0;
    var lower = " " + decoded.toLowerCase() + " ";
    for (var w = 0; w < COMMON_WORDS.length; w++) {
      if (lower.indexOf(COMMON_WORDS[w]) !== -1) hits++;
    }
    if (hits < 2) return null;
    return map;
  }

  // --- content container (the anti-comments-trap utility) -------------------
  // Comment sections can hold more paragraph text than the chapter itself
  // (reported: Wuxiaworld et al); naive "most visible <p> text" scoring then
  // crowns the comments. Try known platform content selectors first — each
  // trusted only when it holds >= 3 visible paragraphs and >= 400 chars —
  // then fall back to ancestor scoring. Returns an Element or null.
  var KNOWN_CONTENT_SELECTORS = [
    "div.chapter-inner", ".cha-words",        // Qidian/Webnovel (reported)
    ".novel-content",                          // Chrysanthemum Garden (reported)
    "#chr-content", ".chapter-content",        // Wuxiaworld, Foxaholic (reported)
    "#chapter-c",                              // Novel Full & aggregators (reported)
    ".post-content", ".entry-content",         // Creative Novels, WordPress blogs (reported)
    "article"
  ];

  function elVisible(el) {
    var p = el;
    while (p && p !== document.body) {
      var s = window.getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden" ||
          parseFloat(s.opacity) <= 0.01) return false;
      p = p.parentElement;
    }
    return el.getBoundingClientRect().height > 0;
  }

  function findContentContainer() {
    for (var i = 0; i < KNOWN_CONTENT_SELECTORS.length; i++) {
      var cand = document.querySelector(KNOWN_CONTENT_SELECTORS[i]);
      if (!cand) continue;
      var ps = cand.querySelectorAll("p");
      var vis = 0, chars = 0;
      for (var j = 0; j < ps.length; j++) {
        if (!elVisible(ps[j])) continue;
        var t = (ps[j].innerText || "").trim();
        if (t.length > 1) { vis++; chars += t.length; }
      }
      if (vis >= 3 && chars >= 400) return cand;
    }
    // Fallback: every visible <p> credits text length to each ancestor;
    // the highest-scoring ancestor wins. Decoy-proof against hidden text
    // because only computed-visible paragraphs vote.
    var score = new Map();
    var paras = document.querySelectorAll("p");
    for (var k = 0; k < paras.length; k++) {
      if (!elVisible(paras[k])) continue;
      var text = (paras[k].innerText || "").trim();
      if (text.length < 2) continue;
      var climb = paras[k].parentElement;
      while (climb && climb !== document.body) {
        score.set(climb, (score.get(climb) || 0) + text.length);
        climb = climb.parentElement;
      }
    }
    var best = null, bestScore = 0;
    score.forEach(function (v, el) { if (v > bestScore) { best = el; bestScore = v; } });
    return bestScore >= 400 ? best : null;
  }

  global.FontDecipher = {
    looksSubstituted: looksSubstituted,
    suspiciousRatio: suspiciousRatio,
    deriveCipherInPage: deriveCipherInPage,
    findContentContainer: findContentContainer
    // decode left to callers: str.replace(/./g, c => map[c] || c) — kept out
    // so callers control their own dominance thresholds.
  };
})(typeof window !== "undefined" ? window : globalThis);
