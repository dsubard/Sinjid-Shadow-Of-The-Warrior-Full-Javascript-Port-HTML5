#!/bin/sh
# Full conversion: SWF -> out/ (library, transpiled scripts, assets). Usage: tools/build.sh path/to/game.swf
set -e
cd "$(dirname "$0")/.."
SWF="${1:-work/game.swf}"
mkdir -p work out
[ "$SWF" = work/game.swf ] || cp "$SWF" work/game.swf
(cd tools && [ -d node_modules ] || npm install --no-audit --no-fund)
sh tools/patch-deps.sh
node tools/dump.mjs work/game.swf work/movie.json
python3 tools/assets.py
node tools/export.mjs
node tools/gen_scripts.mjs
