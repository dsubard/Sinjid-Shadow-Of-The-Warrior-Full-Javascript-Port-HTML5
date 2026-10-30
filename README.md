# Sinjid: Shadow of the Warrior — HTML5 port

A JavaScript/HTML5 port of the 2006 Flash game *Sinjid: Shadow of the Warrior*. The original SWF's ActionScript 2 bytecode was decompiled and transpiled to JavaScript, and it runs on a small custom canvas runtime. No Flash or emulator is needed.

## Play

Open the GitHub Pages site for this repo, or serve the folder locally:

```
python -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from disk won't work because browsers block local file loading.

## Layout

- `index.html`: the page and loader
- `js/`: runtime (AVM1 semantics, display list and timeline, canvas renderer, text, audio, built-in objects)
- `data/library.js`: shapes, sprites, fonts and timelines exported from the SWF
- `data/scripts.js`: the game's ActionScript, transpiled to JavaScript
- `assets/`: bitmaps and sounds extracted from the SWF
- `tools/`: the pipeline that generates `data/` and `assets/` from the SWF (`build.sh`)

Saves go to the browser's localStorage in place of Flash SharedObjects.

## Deploy

`.github/workflows/pages.yml` publishes the site on every push to `main`. In the repo, under **Settings → Pages**, set **Source** to **GitHub Actions**.
