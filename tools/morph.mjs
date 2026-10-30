// DefineMorphShape (v1) parser.
// swf-parser rejects morph shapes whose start and end record lists do not line up one to one
// (Flash allows an end shape with move-to records the start shape does not have, and vice versa),
// so morph shapes are parsed here and the two record lists are paired afterwards, the way Ruffle does it.

class Bits {
  constructor(buf, pos = 0) { this.b = buf; this.p = pos; this.bit = 0; }
  align() { if (this.bit) { this.bit = 0; this.p++; } }
  u8() { this.align(); return this.b[this.p++]; }
  u16() { this.align(); const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
  u32() { this.align(); const v = (this.b[this.p] | (this.b[this.p + 1] << 8) | (this.b[this.p + 2] << 16)) + this.b[this.p + 3] * 16777216; this.p += 4; return v; }
  ub(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = v * 2 + ((this.b[this.p] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.p++; }
    }
    return v;
  }
  sb(n) { if (!n) return 0; const v = this.ub(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v; }
  rgba() { this.align(); const c = { r: this.b[this.p], g: this.b[this.p + 1], b: this.b[this.p + 2], a: this.b[this.p + 3] }; this.p += 4; return c; }
  rect() { this.align(); const n = this.ub(5); const r = { xMin: this.sb(n), xMax: this.sb(n), yMin: this.sb(n), yMax: this.sb(n) }; this.align(); return r; }
  matrix() {
    this.align();
    const m = { scaleX: { epsilons: 65536 }, scaleY: { epsilons: 65536 }, rotateSkew0: { epsilons: 0 }, rotateSkew1: { epsilons: 0 }, translateX: 0, translateY: 0 };
    if (this.ub(1)) { const n = this.ub(5); m.scaleX = { epsilons: this.sb(n) }; m.scaleY = { epsilons: this.sb(n) }; }
    if (this.ub(1)) { const n = this.ub(5); m.rotateSkew0 = { epsilons: this.sb(n) }; m.rotateSkew1 = { epsilons: this.sb(n) }; }
    const n = this.ub(5); m.translateX = this.sb(n); m.translateY = this.sb(n);
    this.align();
    return m;
  }
}

function shapeRecords(r, fillBits, lineBits) {
  const recs = [];
  let x = 0, y = 0;
  for (;;) {
    if (r.ub(1)) {
      const straight = r.ub(1);
      const nb = r.ub(4) + 2;
      if (straight) {
        let dx = 0, dy = 0;
        if (r.ub(1)) { dx = r.sb(nb); dy = r.sb(nb); } else if (r.ub(1)) dy = r.sb(nb); else dx = r.sb(nb);
        recs.push({ type: 0, delta: { x: dx, y: dy } });
      } else {
        const cx = r.sb(nb), cy = r.sb(nb), ax = r.sb(nb), ay = r.sb(nb);
        recs.push({ type: 0, controlDelta: { x: cx, y: cy }, delta: { x: cx + ax, y: cy + ay } }); // delta: start -> anchor (as swf-parser)
      }
    } else {
      const flags = r.ub(5);
      if (!flags) break;
      const rec = { type: 1 };
      if (flags & 1) { const n = r.ub(5); rec.moveTo = { x: r.sb(n), y: r.sb(n) }; }
      if (flags & 2) rec.leftFill = r.ub(fillBits);
      if (flags & 4) rec.rightFill = r.ub(fillBits);
      if (flags & 8) rec.lineStyle = r.ub(lineBits);
      if (flags & 16) throw new Error('new styles in morph shape');
      recs.push(rec);
    }
  }
  r.align();
  return recs;
}

export function parseMorph(buf) {
  const r = new Bits(buf);
  const id = r.u16();
  const bounds = r.rect();
  const morphBounds = r.rect();
  const offset = r.u32();
  const endEdgesPos = r.p + offset;
  let n = r.u8(); if (n === 0xff) n = r.u16();
  const fill = [];
  for (let i = 0; i < n; i++) {
    const type = r.u8();
    if (type === 0) { fill.push({ type: 4, color: r.rgba(), morphColor: r.rgba() }); continue; }
    if (type === 0x10 || type === 0x12 || type === 0x13) {
      const matrix = r.matrix(), morphMatrix = r.matrix();
      const k = r.u8() & 15;
      const colors = [];
      for (let j = 0; j < k; j++) { const ratio = r.u8(), color = r.rgba(), morphRatio = r.u8(), morphColor = r.rgba(); colors.push({ ratio, color, morphRatio, morphColor }); }
      fill.push({ type: type === 0x10 ? 2 : (type === 0x12 ? 3 : 1), matrix, morphMatrix, gradient: { spread: 0, colorSpace: 0, colors } });
      continue;
    }
    if (type >= 0x40 && type <= 0x43) {
      const bitmapId = r.u16(); const matrix = r.matrix(), morphMatrix = r.matrix();
      fill.push({ type: 0, bitmapId, matrix, morphMatrix, repeating: type === 0x40 || type === 0x42, smoothed: type < 0x42 });
      continue;
    }
    throw new Error('morph fill type ' + type);
  }
  n = r.u8(); if (n === 0xff) n = r.u16();
  const line = [];
  for (let i = 0; i < n; i++) {
    const width = r.u16(), morphWidth = r.u16(), color = r.rgba(), morphColor = r.rgba();
    line.push({ width, morphWidth, fill: { type: 4, color, morphColor }, startCap: 0, join: { type: 0 } });
  }
  r.align();
  const fb = r.ub(4), lb = r.ub(4);
  const start = shapeRecords(r, fb, lb);
  r.p = endEdgesPos; r.bit = 0;
  const fb2 = r.ub(4), lb2 = r.ub(4);
  const end = shapeRecords(r, fb2, lb2);
  return { type: 19, id, bounds, morphBounds, styles: { fill, line }, start, end };
}

// Pair start/end records into a single list whose edges carry both versions (like Ruffle's build_morph_frame).
// Output records use absolute coordinates: style changes {style fields, a:{x,y}|null, b:{x,y}|null}
// and edges {a:{x0,y0,x1,y1,cx,cy}, b:{...}}.
export function pairMorph(start, end) {
  const out = [];
  let i = 0, j = 0;
  let ax = 0, ay = 0, bx = 0, by = 0;
  const edge = (rec, x, y) => {
    const x1 = x + rec.delta.x, y1 = y + rec.delta.y;
    if (rec.controlDelta) return { x0: x, y0: y, cx: x + rec.controlDelta.x, cy: y + rec.controlDelta.y, x1, y1 };
    return { x0: x, y0: y, cx: null, cy: null, x1, y1 };
  };
  while (i < start.length && j < end.length) {
    const s = start[i], e = end[j];
    if (s.type === 1 && e.type === 1) {
      const rec = { type: 1, leftFill: s.leftFill, rightFill: s.rightFill, lineStyle: s.lineStyle };
      if (s.moveTo || e.moveTo) {
        if (s.moveTo) { ax = s.moveTo.x; ay = s.moveTo.y; }
        if (e.moveTo) { bx = e.moveTo.x; by = e.moveTo.y; }
        rec.move = { a: { x: ax, y: ay }, b: { x: bx, y: by } };
      }
      out.push(rec); i++; j++;
    } else if (s.type === 1) {
      const rec = { type: 1, leftFill: s.leftFill, rightFill: s.rightFill, lineStyle: s.lineStyle };
      if (s.moveTo) { ax = s.moveTo.x; ay = s.moveTo.y; rec.move = { a: { x: ax, y: ay }, b: { x: bx, y: by } }; }
      out.push(rec); i++;
    } else if (e.type === 1) {
      if (e.moveTo) { bx = e.moveTo.x; by = e.moveTo.y; out.push({ type: 1, move: { a: { x: ax, y: ay }, b: { x: bx, y: by } } }); }
      j++;
    } else {
      const A = edge(s, ax, ay), B = edge(e, bx, by);
      // a straight edge paired with a curve becomes a curve with its control point in the middle
      if (A.cx === null && B.cx !== null) { A.cx = (A.x0 + A.x1) / 2; A.cy = (A.y0 + A.y1) / 2; }
      if (B.cx === null && A.cx !== null) { B.cx = (B.x0 + B.x1) / 2; B.cy = (B.y0 + B.y1) / 2; }
      out.push({ type: 0, a: A, b: B });
      ax = A.x1; ay = A.y1; bx = B.x1; by = B.y1;
      i++; j++;
    }
  }
  return out;
}
