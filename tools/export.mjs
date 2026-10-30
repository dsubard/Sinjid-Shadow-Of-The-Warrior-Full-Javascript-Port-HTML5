// Converts the parsed SWF (work/movie.json) into the data the HTML5 runtime loads:
//   out/data/library.js : window.LIB = { characters, timelines, fonts, exports, sounds, bitmaps }
//   work/scripts.json   : every AVM1 code blob, referenced by numeric id from the library
import fs from 'node:fs';
import { rawTags } from './rawtags.mjs';
import { parseMorph, pairMorph } from './morph.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const movie = JSON.parse(fs.readFileSync(ROOT + 'work/movie.json', 'utf8'));
const swfBytes = fs.readFileSync(ROOT + 'work/game.swf');
const OUT = ROOT + 'out/data';
fs.mkdirSync(OUT, { recursive: true });

const r2 = (v) => { const r = Math.round(v * 100) / 100; return Object.is(r, -0) ? 0 : r; };
const r5 = (v) => { const r = Math.round(v * 100000) / 100000; return Object.is(r, -0) ? 0 : r; };
const px = (tw) => r2(tw / 20);
const fx16 = (f) => f.epsilons / 65536;
const fx8 = (f) => f.epsilons / 256;
const rgba = (c) => [c.r, c.g, c.b, c.a === undefined ? 255 : c.a];
const rect = (r) => [px(r.xMin), px(r.yMin), px(r.xMax), px(r.yMax)];
// placement matrix in pixels: [a, b, c, d, tx, ty]
const mat = (m) => (m ? [fx16(m.scaleX), fx16(m.rotateSkew0), fx16(m.rotateSkew1), fx16(m.scaleY), m.translateX / 20, m.translateY / 20].map(r5) : null);
// fill matrix (maps gradient/bitmap space -> shape twips) converted to pixel units
const fmat = (m) => { const a = mat(m); return [a[0] / 20, a[1] / 20, a[2] / 20, a[3] / 20, a[4], a[5]].map((v) => r5(v)); };
const cxf = (c) => (c ? [fx8(c.redMult), fx8(c.greenMult), fx8(c.blueMult), fx8(c.alphaMult), c.redAdd, c.greenAdd, c.blueAdd, c.alphaAdd] : null);
const isIdentityCx = (c) => c && c[0] === 1 && c[1] === 1 && c[2] === 1 && c[3] === 1 && !c[4] && !c[5] && !c[6] && !c[7];

// ------------------------------------------------------------------------------------------ scripts
const scripts = [];
function addScript(where, b64, kind) { scripts.push({ id: scripts.length, where, kind, b64 }); return scripts.length - 1; }

// ------------------------------------------------------------------------------------------ fills
function fillSpec(f, morph) {
  switch (f.type) {
    case 4: { const o = { t: 's', c: rgba(f.color) }; if (morph) o.c2 = rgba(f.morphColor); return o; }
    case 0: {
      const o = { t: 'b', id: f.bitmapId, m: fmat(f.matrix), rep: !!f.repeating, sm: !!f.smoothed };
      if (morph) o.m2 = fmat(f.morphMatrix);
      return o;
    }
    case 1: case 2: case 3: {
      const o = {
        t: f.type === 2 ? 'l' : (f.type === 3 ? 'r' : 'f'), m: fmat(f.matrix),
        stops: f.gradient.colors.map((s) => [s.ratio, ...rgba(s.color)]), spread: f.gradient.spread || 0,
      };
      if (f.focalPoint) o.focal = fx8(f.focalPoint);
      if (morph) { o.m2 = fmat(f.morphMatrix); o.stops2 = f.gradient.colors.map((s) => [s.morphRatio, ...rgba(s.morphColor)]); }
      return o;
    }
    default: throw new Error('fill type ' + f.type);
  }
}
function lineSpec(l, morph) {
  const c = l.fill ? l.fill.color : l.color;
  const o = { w: l.width / 20, c: c ? rgba(c) : [0, 0, 0, 255] };
  if (morph) { o.w2 = l.morphWidth / 20; const c2 = l.fill ? l.fill.morphColor : l.morphColor; o.c2 = c2 ? rgba(c2) : o.c; }
  return o;
}

// ------------------------------------------------------------------------------------------ shape geometry
// Edges are {l, r, ln, a:{x0,y0,cx,cy,x1,y1}, b?} in twips. Style groups split at every NewStyles record.
function plainToGroups(shape) {
  const groups = [];
  let g = { fills: shape.initialStyles.fill, lines: shape.initialStyles.line, edges: [] };
  groups.push(g);
  let x = 0, y = 0, l = 0, r = 0, ln = 0;
  for (const rec of shape.records) {
    if (rec.type === 1) {
      if (rec.newStyles) { g = { fills: rec.newStyles.fill, lines: rec.newStyles.line, edges: [] }; groups.push(g); l = r = ln = 0; }
      if (rec.moveTo) { x = rec.moveTo.x; y = rec.moveTo.y; }
      if (rec.leftFill !== undefined) l = rec.leftFill;
      if (rec.rightFill !== undefined) r = rec.rightFill;
      if (rec.lineStyle !== undefined) ln = rec.lineStyle;
    } else {
      let e;
      if (rec.controlDelta) {
        // swf-parser gives the anchor delta relative to the edge start (not to the control point)
        e = { x0: x, y0: y, cx: x + rec.controlDelta.x, cy: y + rec.controlDelta.y, x1: x + rec.delta.x, y1: y + rec.delta.y };
      } else e = { x0: x, y0: y, cx: null, cy: null, x1: x + rec.delta.x, y1: y + rec.delta.y };
      g.edges.push({ l, r, ln, a: e });
      x = e.x1; y = e.y1;
    }
  }
  return groups;
}
function morphToGroups(styles, paired) {
  const g = { fills: styles.fill, lines: styles.line, edges: [] };
  let l = 0, r = 0, ln = 0;
  for (const rec of paired) {
    if (rec.type === 1) {
      if (rec.leftFill !== undefined) l = rec.leftFill;
      if (rec.rightFill !== undefined) r = rec.rightFill;
      if (rec.lineStyle !== undefined) ln = rec.lineStyle;
    } else g.edges.push({ l, r, ln, a: rec.a, b: rec.b });
  }
  return [g];
}
const rev = (e) => (e ? { x0: e.x1, y0: e.y1, cx: e.cx, cy: e.cy, x1: e.x0, y1: e.y0 } : e);
const startKey = (E) => E.a.x0 + ',' + E.a.y0 + (E.b ? ';' + E.b.x0 + ',' + E.b.y0 : '');
const endKey = (E) => E.a.x1 + ',' + E.a.y1 + (E.b ? ';' + E.b.x1 + ',' + E.b.y1 : '');

// Link directed edges into closed contours (fills). Returns an array of contours (arrays of edges).
function stitch(edges) {
  const byStart = new Map();
  edges.forEach((E, i) => { const k = startKey(E); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(i); });
  const used = new Uint8Array(edges.length);
  const contours = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const c = [];
    let cur = i;
    const k0 = startKey(edges[i]);
    while (cur !== -1 && !used[cur]) {
      used[cur] = 1;
      c.push(edges[cur]);
      const ek = endKey(edges[cur]);
      if (ek === k0) break;
      const cands = byStart.get(ek);
      cur = -1;
      if (cands) { for (const j of cands) if (!used[j]) { cur = j; break; } }
    }
    contours.push(c);
  }
  return contours;
}
function pathFor(contours, which, close) {
  let d = '';
  for (const c of contours) {
    let lx = null, ly = null;
    for (const E of c) {
      const e = E[which];
      if (e.x0 !== lx || e.y0 !== ly) d += `M${px(e.x0)} ${px(e.y0)}`;
      d += e.cx === null ? `L${px(e.x1)} ${px(e.y1)}` : `Q${px(e.cx)} ${px(e.cy)} ${px(e.x1)} ${px(e.y1)}`;
      lx = e.x1; ly = e.y1;
    }
    if (close) d += 'Z';
  }
  return d;
}
function groupsToLayers(groups, morph) {
  const layers = [];
  for (const g of groups) {
    const fillIdx = new Map();
    const lineIdx = new Map();
    for (const E of g.edges) {
      if (E.r) { if (!fillIdx.has(E.r)) fillIdx.set(E.r, []); fillIdx.get(E.r).push(E); }
      if (E.l) { if (!fillIdx.has(E.l)) fillIdx.set(E.l, []); fillIdx.get(E.l).push({ a: rev(E.a), b: rev(E.b) }); }
      if (E.ln) { if (!lineIdx.has(E.ln)) lineIdx.set(E.ln, []); lineIdx.get(E.ln).push(E); }
    }
    for (const idx of [...fillIdx.keys()].sort((a, b) => a - b)) {
      const f = g.fills[idx - 1];
      if (!f) continue;
      if (f.type === 0 && f.bitmapId === 65535) continue; // missing bitmap: Flash draws nothing
      const contours = stitch(fillIdx.get(idx));
      const L = { fill: fillSpec(f, morph), d: pathFor(contours, 'a', true) };
      if (morph) L.d2 = pathFor(contours, 'b', true);
      layers.push(L);
    }
    for (const idx of [...lineIdx.keys()].sort((a, b) => a - b)) {
      const l = g.lines[idx - 1];
      if (!l) continue;
      const es = lineIdx.get(idx);
      const L = { line: lineSpec(l, morph), d: pathFor([es], 'a', false) };
      if (morph) L.d2 = pathFor([es], 'b', false);
      layers.push(L);
    }
  }
  return layers;
}

// ------------------------------------------------------------------------------------------ fonts / static text
const glyphFonts = new Map(); // id -> {glyphs, em}
const fontInfo = {};          // id -> {name, bold, italic, codes}
function walkAll(tags, fn) { for (const t of tags) { fn(t); if (t.type === 24) walkAll(t.tags, fn); } }
walkAll(movie.tags, (t) => {
  if (t.type === 12) {
    glyphFonts.set(t.id, { glyphs: t.glyphs || [], em: t.emSquareSize || 1024 });
    fontInfo[t.id] = { name: t.fontName, bold: !!t.isBold, italic: !!t.isItalic, codes: t.codeUnits || [], layout: t.layout ? { ascent: t.layout.ascent, descent: t.layout.descent, leading: t.layout.leading } : null };
  }
  if (t.type === 16) glyphFonts.set(t.id, { glyphs: t.glyphs || [], em: 1024 });
  if (t.type === 14) fontInfo[t.fontId] = { name: t.fontName, bold: !!t.isBold, italic: !!t.isItalic, codes: t.codeUnits || [] };
});
function glyphPath(glyph, k, ox, oy, m) {
  // glyph em units * k -> twips, offset by pen, then text matrix, then px
  let d = '', x = 0, y = 0;
  const P = (gx, gy) => {
    const tx = gx * k + ox, ty = gy * k + oy;
    return `${r2((m[0] * tx + m[2] * ty) / 20 + m[4])} ${r2((m[1] * tx + m[3] * ty) / 20 + m[5])}`;
  };
  let open = false;
  for (const rec of glyph.records) {
    if (rec.type === 1) {
      if (rec.moveTo) { if (open) d += 'Z'; x = rec.moveTo.x; y = rec.moveTo.y; d += 'M' + P(x, y); open = true; }
    } else if (rec.controlDelta) {
      const cx = x + rec.controlDelta.x, cy = y + rec.controlDelta.y;
      x += rec.delta.x; y += rec.delta.y;
      d += 'Q' + P(cx, cy) + ' ' + P(x, y);
    } else { x += rec.delta.x; y += rec.delta.y; d += 'L' + P(x, y); }
  }
  if (open) d += 'Z';
  return d;
}
function buildStaticText(t) {
  const m = mat(t.matrix) || [1, 0, 0, 1, 0, 0];
  const layers = [];
  let font = null, size = 0, color = [0, 0, 0, 255], x = 0, y = 0;
  const glyphs = [];
  for (const rec of t.records) {
    if (rec.fontId !== undefined) font = glyphFonts.get(rec.fontId) || null;
    if (rec.fontSize !== undefined) size = rec.fontSize;
    if (rec.color) color = rgba(rec.color);
    if (rec.offsetX !== undefined) x = rec.offsetX;
    if (rec.offsetY !== undefined) y = rec.offsetY;
    let d = '';
    for (const e of rec.entries) {
      const g = font && font.glyphs[e.index];
      if (g && g.records.length) d += glyphPath(g, size / font.em, x, y, m);
      x += e.advance;
    }
    if (d) {
      const last = layers[layers.length - 1];
      if (last && last.fill.c.join() === color.join()) last.d += d;
      else layers.push({ fill: { t: 's', c: color }, d, eo: 1 });
    }
  }
  return layers;
}

// ------------------------------------------------------------------------------------------ timelines
const CLIP_EVENTS = ['load', 'enterFrame', 'unload', 'mouseMove', 'mouseDown', 'mouseUp', 'keyDown', 'keyUp', 'data', 'initialize', 'press', 'release', 'releaseOutside', 'rollOver', 'rollOut', 'dragOver', 'dragOut', 'keyPress', 'construct'];
function timeline(tags, where) {
  const frames = [];
  const labels = {};
  let ops = [];
  let f = 1, n = 0;
  for (const t of tags) {
    switch (t.type) {
      case 49: { // PlaceObject / PlaceObject2
        const ext = {};
        if (t.matrix) ext.m = mat(t.matrix);
        if (t.colorTransform) { const c = cxf(t.colorTransform); ext.cx = isIdentityCx(c) ? 0 : c; }
        if (t.ratio !== undefined) ext.ratio = t.ratio;
        if (t.name !== undefined) ext.name = t.name;
        if (t.clipDepth !== undefined) ext.clip = t.clipDepth;
        if (t.clipActions && t.clipActions.length) {
          ext.ev = t.clipActions.map((c) => {
            const evs = CLIP_EVENTS.filter((e) => c.events[e]);
            const o = { e: evs, s: addScript(`${where}#f${f}#d${t.depth}#on(${evs.join(',')})`, c.actions.$b64, 'clip') };
            if (c.keyCode !== undefined) o.k = c.keyCode;
            return o;
          });
        }
        ops.push(['P', t.depth, t.characterId === undefined ? 0 : t.characterId, t.isUpdate ? 1 : 0, ext]);
        break;
      }
      case 54: ops.push(['R', t.depth]); break;
      case 31: ops.push(['A', addScript(`${where}#f${f}#${n++}`, t.actions.$b64, 'frame')]); break;
      case 32: ops.push(['I', addScript(`init(sprite${t.spriteId})`, t.actions.$b64, 'init')]); break;
      case 38: if (!(t.name in labels)) labels[t.name] = f; break;
      case 61: {
        const si = t.soundInfo || {};
        const info = {};
        if (si.syncStop) info.stop = 1;
        if (si.syncNoMultiple) info.noMulti = 1;
        if (si.loopCount) info.loops = si.loopCount;
        if (si.inPoint) info.inPt = si.inPoint;
        if (si.outPoint) info.outPt = si.outPoint;
        ops.push(['S', t.soundId, info]);
        break;
      }
      case 58: frames.push(ops); ops = []; f++; n = 0; break;
      default: break;
    }
  }
  if (ops.length) frames.push(ops);
  return { frames, labels };
}

// ------------------------------------------------------------------------------------------ build
const chars = {};
const exportsMap = {};
const sounds = {};
const bitmaps = {};
const assetIndex = fs.existsSync(ROOT + 'out/assets/index.json') ? JSON.parse(fs.readFileSync(ROOT + 'out/assets/index.json', 'utf8')) : { images: {}, sounds: {} };

// morph shapes are parsed from the raw tags (see morph.mjs)
const morphs = new Map();
for (const rt of rawTags(swfBytes)) if (rt.code === 46) { const mo = parseMorph(rt.body); morphs.set(mo.id, mo); }

walkAll(movie.tags, (t) => {
  switch (t.type) {
    case 22: chars[t.id] = { k: 'shape', b: rect(t.bounds), L: groupsToLayers(plainToGroups(t.shape), false) }; break;
    case 25: chars[t.id] = { k: 'shape', b: rect(t.bounds), L: buildStaticText(t), text: 1 }; break;
    case 11: {
      chars[t.id] = {
        k: 'edit', b: rect(t.bounds), font: t.fontId === undefined ? null : t.fontId, size: t.fontSize === undefined ? 12 : px(t.fontSize),
        color: t.color ? rgba(t.color) : [0, 0, 0, 255], align: t.align || 0, wrap: !!t.wordWrap, multi: !!t.multiline,
        password: !!t.password, readonly: !!t.readonly, autoSize: !!t.autoSize, selectable: !t.noSelect, border: !!t.border,
        html: !!t.html, outlines: !!t.useGlyphFont, ml: px(t.marginLeft || 0), mr: px(t.marginRight || 0), indent: px(t.indent || 0),
        leading: px(t.leading || 0), maxLen: t.maxLength === undefined ? null : t.maxLength, variable: t.variableName || null, text: t.text || '',
      };
      break;
    }
    case 24: { const tl = timeline(t.tags, 'sprite' + t.id); chars[t.id] = { k: 'sprite', n: t.frameCount, frames: tl.frames, labels: tl.labels }; break; }
    case 6: {
      const states = { up: [], over: [], down: [], hit: [] };
      for (const r of t.records) {
        const rec = { id: r.characterId, depth: r.depth, m: mat(r.matrix) };
        if (r.colorTransform) { const c = cxf(r.colorTransform); if (!isIdentityCx(c)) rec.cx = c; }
        if (r.stateUp) states.up.push(rec);
        if (r.stateOver) states.over.push(rec);
        if (r.stateDown) states.down.push(rec);
        if (r.stateHitTest) states.hit.push(rec);
      }
      const actions = (t.actions || []).map((a) => {
        const cond = Object.entries(a.conditions || {}).filter(([k, v]) => v && k !== 'keyPress').map(([k]) => k);
        const o = { c: cond, s: addScript('button' + t.id, a.actions.$b64, 'button') };
        if (a.conditions && a.conditions.keyPress) o.key = a.conditions.keyPress;
        return o;
      });
      chars[t.id] = { k: 'button', states, actions, menu: !!t.trackAsMenu };
      break;
    }
    case 23: sounds[t.id] = Object.assign({ rate: t.soundRate, samples: t.sampleCount }, assetIndex.sounds[t.id] || {}); chars[t.id] = { k: 'sound' }; break;
    case 5: bitmaps[t.id] = assetIndex.images[t.id] || null; chars[t.id] = { k: 'bitmap' }; break;
    case 35: for (const a of t.assets) exportsMap[a.name] = a.id; break;
    default: break;
  }
});
for (const [id, mo] of morphs) {
  chars[id] = { k: 'morph', b: rect(mo.bounds), b2: rect(mo.morphBounds), L: groupsToLayers(morphToGroups(mo.styles, pairMorph(mo.start, mo.end)), true) };
}

const main = timeline(movie.tags, 'main');
const fonts = {};
for (const [id, f] of Object.entries(fontInfo)) fonts[id] = { name: f.name, bold: f.bold, italic: f.italic, layout: f.layout || null };
const bgTag = movie.tags.find((t) => t.type === 56);
const lib = {
  fps: movie.header.frameRate.epsilons / 256,
  w: movie.header.frameSize.xMax / 20, h: movie.header.frameSize.yMax / 20,
  bg: bgTag ? [bgTag.color.r, bgTag.color.g, bgTag.color.b] : [255, 255, 255],
  version: movie.header.swfVersion,
  main: { n: movie.header.frameCount, frames: main.frames, labels: main.labels },
  chars, fonts, exports: exportsMap, sounds, bitmaps,
};
const js = '// Generated from the original SWF by tools/export.mjs\nvar LIB = ' + JSON.stringify(lib) + ';\n';
fs.writeFileSync(OUT + '/library.js', js);
fs.writeFileSync(ROOT + 'work/scripts.json', JSON.stringify(scripts));
console.log('library.js', (js.length / 1e6).toFixed(2), 'MB,', Object.keys(chars).length, 'characters,', scripts.length, 'scripts,', morphs.size, 'morphs');
