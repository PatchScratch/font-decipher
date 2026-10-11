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
