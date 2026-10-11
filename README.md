# font-decipher

Decode **font-substitution anti-scraping**: sites that render readable text through a custom webfont whose characters live at exotic codepoints, so the DOM text content is gibberish.

You've met this if a page *displays* perfect English but `document.body.innerText`, copy-paste, your favorite extractor, TTS, or search returns garbage like:

```
⽕⽣⽠ ⽣⽠⽜⽭⽯⽧⽠ ⽪⽩⽠ ⽡⽭⽪⽨ ⽨⽪⽝
```

The substitution lives in the font's character map: obfuscation fonts almost always **copy their ASCII letter outlines verbatim** to the substituted codepoints. That's the crack — compare glyph outlines, recover the codepoint → character map, decode the text.

Case study that produced this tool: [storyseedling.com](https://storyseedling.com) ships a font ("Vagre") mapping Kangxi radicals `U+2F42..U+2F5B → A-Z` and `U+2F5C..U+2F75 → a-z`. Their font was decoded outline-for-outline; the built-in decoder ships that ladder, and the derivation tool reproduces it from the font file alone.

## What's here

| File | What it does |
|---|---|
| `derive_cipher.py` | **The cracker.** Takes a woff2/woff/ttf, compares candidate codepoints' glyph outlines against the font's own ASCII, fills gaps by sequence inference (dotted `i`/`j` glyphs compare differently), emits the JSON map. |
| `decipher.js` | Drop-in decoder for browsers/Node. Built-in StorySeedling ladder; load custom maps via `loadMap()`. Decodes only when substitution dominates the text, so genuine CJK prose is never touched. |
| `decipher.py` | Same decoder as a Python module/CLI (stdin/stdout or files). |
| `examples/storyseedling-vagre.json` | The derived map for storyseedling.com's font (54 mappings, reproduced by the tool). |
| `derive_browser.js` | **Runtime derivation, in the page.** Canvas-renders suspicious codepoints and the font's own ASCII, matches by pixel IoU — no font download, no hardcoded table, rotation-proof (reads the computed font-family off a live paragraph, so per-load renamed families don't matter). Handles Private-Use ladders, shuffled permutations, and partial substitution; dotted `i`/`j` work for free. Returns `null` when the font ships no ASCII of its own. |

## Quick start

### Decode text (known ladder)

```js
// Node or browser
const { decipher } = require("./decipher.js");
decipher("⽕⽣⽠ ⽣⽠⽜⽭⽯⽧⽠");          // built-in StorySeedling ladder
```

```bash
echo "⽕⽣⽠ ⽣⽠⽜⽭⽯⽧⽠" | python3 decipher.py
```

### Crack a new font

1. **Get the font file** — from a logged-in browser (plain `curl` usually hits Cloudflare). In devtools on a text page:

   ```js
   [...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] } })
     .filter(r => r instanceof CSSFontFaceRule && /FONTNAME/i.test(r.style.fontFamily))
     .map(r => r.style.getPropertyValue('src'))
   ```

   Fetch the URL from the page's own context (devtools `fetch(...)` → copy base64, or the Network tab → save response).

2. **Derive the map**:

   ```bash
   pip install fonttools brotli
   python3 derive_cipher.py font.woff2 -o map.json
   # substitutions parked outside the default ranges (Kangxi + Private Use)?
   python3 derive_cipher.py font.woff2 --range 3400 4DBF
   ```

3. **Decode with it**:

   ```js
   const { decipher, loadMap } = require("./decipher.js");
   const map = loadMap(JSON.parse(fs.readFileSync("map.json", "utf8")));
   decipher(pageText, map);
   ```

   ```bash
   python3 decipher.py page.txt -m map.json
   ```

### Derive at runtime in the page (rotation / PUA / partial substitution)

When you can't preprocess a font file — or the host rotates fonts per load —
run `derive_browser.js` where the page already lives:

```html
<script src="derive_browser.js"></script>
<script>
  const container = document.querySelector("article");
  const text = container.innerText;
  const map = FontDecipher.deriveCipherInPage(text, container);  // Map | null
  if (map) console.log([...text].map(c => map[c] || c).join(""));
</script>
```

It gates itself on substitution heuristics (suspicious-block ratio, low
genuine-CJK ratio), accepts only high-confidence glyph matches, and validates
that the decoded sample reads like English before returning a map — a failed
derivation returns `null` so you can fall back.

## Field guide: techniques and their mitigations

Intel from the NovelUpdates translation ecosystem (reported by field
observers 2026-10-11; **only StorySeedling is verified by this project** —
treat the rest as leads to test against, not facts).

| Technique | Who (reported) | Mitigation in this toolkit |
|---|---|---|
| Font substitution, fixed ladder (Kangxi radicals) | storyseedling.com *(verified)* | `decipher.js`/`.py` built-in ladder; `derive_cipher.py` re-derives from the font file |
| Font substitution, rotated per page load (renamed families like `g_font_3821a`) | Webnovel/Qidian | `deriveCipherInPage()` reads the computed font-family off a live paragraph every run — nothing is cached to go stale |
| Ladders parked in Private Use (U+E000–U+F8FF) / CJK ranges, aimed at TTS | Chrysanthemum Garden, Danmei/BL hubs | the runtime derivation scans those blocks by default and matches glyph bitmaps wherever the letters live |
| Partial substitution (only high-frequency letters like e/t/a) | Flying Lines, Wuxiaworld clones | the derivation maps only the substituted set — a small map is a success, gated by English-likeness validation rather than ladder dominance |
| Hidden decoy/honeypot text (display:none, opacity:0, zero-size) | Wuxiaworld, WordPress anti-copy plugins | `findContentContainer()` votes with computed-style-visible paragraphs only |
| Watermark tokens embedded in paragraphs (`cls1b7bcfa179…`) | storyseedling.com *(verified)* | strip with `/cls[0-9a-f]{12,}/g` before/after decoding |
| Comments outweighing the chapter (scoring traps) | Wuxiaworld | `findContentContainer()` tries validated platform selectors first |
| Chapters as image slices / canvas drawing | Foxaholic, light-novel hubs | no text exists to decode — detect (image-dense, textless) and render the images instead |

**Pitfalls we tested so you can skip them:**

- **`measureText` width matching** (a tempting shortcut): widths collide
  across letters (`i`/`l`/`I`, `n`/`u`, `b`/`d`), and a width-keyed object
  silently overwrites collisions. Pixel-IoU on rendered glyph bitmaps matches
  copied outlines at exactly 1.0 for the same cost.
- **`cloneNode` + innerText for cleanup**: a detached clone has no layout, so
  `getComputedStyle` returns nothing and `innerText` degrades to
  `textContent` — class-hidden honeypots slip back in. Filter the live DOM.
- **`canvas.toDataURL()` for canvas-rendered chapters**: cross-origin taint
  throws almost everywhere it matters. Harvest `img`/`data-src` URLs instead.
- **Dotted `i`/`j`**: outline-table comparisons miss them (two contours);
  bitmaps include the dots, so runtime derivation needs no special case. For
  font-file derivation, `derive_cipher.py` fills them by sequence inference.

## Safety model

`decipher()` is deliberately conservative: it only rewrites text when **substituted codepoints make up ≥ 30% of it** (configurable). Genuine Chinese/Japanese text lives in the wide CJK ranges and sails through untouched; a Latin sentence with one stray radical is left alone. `looksSubstituted(text)` exposes the check if you want to gate it yourself.

## Limits & notes

- The outline comparison needs the font to contain its own **real ASCII glyphs** (obfuscation fonts include them for UI chrome — so far they always do). If a font draws only substituted glyphs, compare against a reference font instead (same outline-normalization idea).
- Some fonts substitute digits/punctuation too — extend `ASCII` in `derive_cipher.py` or check the emitted map.
- Hosts can rotate fonts per build. Re-run the derivation; the map is the only thing that changes.
- This tool decodes text you can already read on screen with your own eyes — for accessibility, archival, personal reading, and interoperability. Respect sites' terms and copyright where you live.

## License

[MIT](LICENSE) — © 2026 Wayne Yow (PatchScratch)

Extracted from [NovelNotifier](https://github.com/PatchScratch/NovelNotifier), where it powers the in-app reader on hosts that defeat every other extractor.
