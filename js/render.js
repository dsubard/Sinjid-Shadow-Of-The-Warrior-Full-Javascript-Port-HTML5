// Canvas 2D renderer for the display list.
'use strict';
(function () {
  var LIB = window.LIB;
  var mul = $.mat.mul, inv = $.mat.inv;
  $.images = {};
  var view = $.view = { canvas: null, ctx: null, S: 1 };

  // ---------------------------------------------------------------- colours
  function combine(p, c) {
    if (!c) return p;
    if (!p) return c;
    return [p[0] * c[0], p[1] * c[1], p[2] * c[2], p[3] * c[3],
      p[0] * c[4] + p[4], p[1] * c[5] + p[5], p[2] * c[6] + p[6], p[3] * c[7] + p[7]];
  }
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
  function rgba(c, cx) {
    var a = c[3] / 255;
    if (!cx) return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    var na = (c[3] * cx[3] + cx[7]) / 255;
    return 'rgba(' + cl(c[0] * cx[0] + cx[4]) + ',' + cl(c[1] * cx[1] + cx[5]) + ',' + cl(c[2] * cx[2] + cx[6]) + ',' + (na < 0 ? 0 : na > 1 ? 1 : na) + ')';
  }
  function isAlphaOnly(cx) { return !cx || (cx[0] === 1 && cx[1] === 1 && cx[2] === 1 && !cx[4] && !cx[5] && !cx[6] && !cx[7]); }

  // ---------------------------------------------------------------- shape geometry
  var NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
  function lerpPath(a, b, t) {
    if (t <= 0) return a; if (t >= 1) return b;
    var nb = b.match(NUM), i = 0;
    return a.replace(NUM, function (x) { var y = nb ? +nb[i] : +x; i++; return Math.round((+x + (y - +x) * t) * 100) / 100; });
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpArr(a, b, t) { var r = new Array(a.length); for (var i = 0; i < a.length; i++) r[i] = lerp(a[i], b[i], t); return r; }
  function morphLayers(o) {
    var d = o.def, r = o.ratio;
    if (o.$mr === r && o.$ml && o.$md === d) return o.$ml;
    var t = r / 65535, out = [];
    for (var i = 0; i < d.L.length; i++) {
      var L = d.L[i], M = { d: lerpPath(L.d, L.d2, t) };
      if (L.fill) {
        var f = L.fill, g = { t: f.t };
        if (f.t === 's') g.c = lerpArr(f.c, f.c2, t);
        else if (f.t === 'b') { g.id = f.id; g.rep = f.rep; g.sm = f.sm; g.m = lerpArr(f.m, f.m2, t); }
        else { g.m = lerpArr(f.m, f.m2, t); g.spread = f.spread; g.focal = f.focal; g.stops = f.stops.map(function (s, k) { return lerpArr(s, f.stops2[k], t); }); }
        M.fill = g;
      }
      if (L.line) M.line = { w: lerp(L.line.w, L.line.w2, t), c: lerpArr(L.line.c, L.line.c2, t) };
      out.push(M);
    }
    o.$mr = r; o.$ml = out; o.$md = d;
    return out;
  }
  $.layersOf = function (o) { return o.def.k === 'morph' ? morphLayers(o) : o.def.L; };
  $.pathOf = function (L) { return L.$p || (L.$p = new Path2D(L.d)); };

  // ---------------------------------------------------------------- fills
  var GR = 16384; // gradient square half-size (fill matrices map gradient units to pixels)
  function gradient(ctx, f, cx) {
    var g = f.t === 'l' ? ctx.createLinearGradient(-GR, 0, GR, 0)
      : ctx.createRadialGradient(f.t === 'f' && f.focal ? f.focal * GR : 0, 0, 0, 0, 0, GR);
    var st = f.stops;
    for (var i = 0; i < st.length; i++) g.addColorStop(Math.max(0, Math.min(1, st[i][0] / 255)), rgba([st[i][1], st[i][2], st[i][3], st[i][4]], cx));
    return g;
  }
  function gradPath(L, f) {
    if (L.$gp && L.$gm === f.m) return L.$gp;
    var p = new Path2D(), m = inv(f.m);
    p.addPath($.pathOf(L), new DOMMatrix(m));
    L.$gp = p; L.$gm = f.m;
    return p;
  }
  var tinted = new Map();
  function imageFor(id, cx) {
    var img = $.images[id];
    if (!img || !img.complete || !img.naturalWidth) return null;
    if (isAlphaOnly(cx)) return img;
    var key = id + ':' + cx.slice(0, 3).concat(cx.slice(4, 7)).map(function (v) { return Math.round(v * 100); }).join(',');
    var c = tinted.get(key);
    if (c) return c;
    c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    var x = c.getContext('2d'); x.drawImage(img, 0, 0);
    var d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (var i = 0; i < p.length; i += 4) { p[i] = cl(p[i] * cx[0] + cx[4]); p[i + 1] = cl(p[i + 1] * cx[1] + cx[5]); p[i + 2] = cl(p[i + 2] * cx[2] + cx[6]); }
    x.putImageData(d, 0, 0);
    if (tinted.size > 64) tinted.clear();
    tinted.set(key, c);
    return c;
  }
  function fillLayer(ctx, L, f, wm, cx, path) {
    var S = view.S;
    switch (f.t) {
      case 's':
        ctx.fillStyle = rgba(f.c, cx);
        ctx.fill(path, L.eo ? 'evenodd' : 'nonzero');
        break;
      case 'b': {
        var img = imageFor(f.id, cx);
        if (!img) return;
        var pat = ctx.createPattern(img, f.rep ? 'repeat' : 'no-repeat');
        if (!pat) return;
        pat.setTransform(new DOMMatrix(f.m));
        ctx.imageSmoothingEnabled = f.sm !== false;
        var oa = ctx.globalAlpha;
        if (cx) ctx.globalAlpha = oa * Math.max(0, Math.min(1, cx[3] + cx[7] / 255));
        ctx.fillStyle = pat;
        ctx.fill(path);
        ctx.globalAlpha = oa;
        break;
      }
      default: {
        var m = mul(wm, f.m);
        ctx.setTransform(S * m[0], S * m[1], S * m[2], S * m[3], S * m[4], S * m[5]);
        ctx.fillStyle = gradient(ctx, f, cx);
        ctx.fill(L.$morph ? (function () { var p = new Path2D(); p.addPath(path, new DOMMatrix(inv(f.m))); return p; })() : gradPath(L, f));
        ctx.setTransform(S * wm[0], S * wm[1], S * wm[2], S * wm[3], S * wm[4], S * wm[5]);
      }
    }
  }
  function worldScale(wm) { return Math.sqrt(Math.abs(wm[0] * wm[3] - wm[1] * wm[2])) * view.S; }
  function drawGraphic(ctx, o, wm, cx) {
    var morph = o.def.k === 'morph';
    var layers = morph ? morphLayers(o) : o.def.L;
    var S = view.S;
    ctx.setTransform(S * wm[0], S * wm[1], S * wm[2], S * wm[3], S * wm[4], S * wm[5]);
    var ws = worldScale(wm) || 1;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      var path = morph ? new Path2D(L.d) : $.pathOf(L);
      if (L.fill) {
        if (morph) L.$morph = true;
        fillLayer(ctx, L, L.fill, wm, cx, path);
      } else if (L.line) {
        ctx.strokeStyle = rgba(L.line.c, cx);
        ctx.lineWidth = Math.max(L.line.w, 1 / ws);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke(path);
      }
    }
  }

  // ---------------------------------------------------------------- drawing API (MovieClip.lineTo & co)
  function hexColor(c, a, cx) { return rgba([(c >> 16) & 255, (c >> 8) & 255, c & 255, Math.round(Math.max(0, Math.min(100, a)) * 2.55)], cx); }
  function drawGfx(ctx, g, wm, cx) {
    var S = view.S, ws = worldScale(wm) || 1;
    ctx.setTransform(S * wm[0], S * wm[1], S * wm[2], S * wm[3], S * wm[4], S * wm[5]);
    var fill = null, fillPath = null, line = null, linePath = null, pen = [0, 0], start = null;
    function flushFill() { if (fill && fillPath) { ctx.fillStyle = fill; ctx.fill(fillPath); } fillPath = null; }
    function flushLine() { if (line && linePath) { ctx.strokeStyle = line.c; ctx.lineWidth = Math.max(line.w, 1 / ws); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(linePath); } linePath = null; }
    var cmds = g.cmds;
    for (var i = 0; i < cmds.length; i++) {
      var c = cmds[i];
      switch (c[0]) {
        case 'ls': flushLine(); line = c[1] === c[1] ? { w: c[1] || 0, c: hexColor(c[2], c[3], cx) } : null; break;
        case 'bf': flushFill(); flushLine(); fill = c[1] < 0 ? null : hexColor(c[1], c[2], cx); start = pen.slice(); break;
        case 'bg': flushFill(); flushLine(); fill = gradientFill(ctx, c, cx); start = pen.slice(); break;
        case 'ef': flushFill(); flushLine(); fill = null; break;
        case 'm':
          pen = [c[1], c[2]];
          if (fillPath) fillPath.moveTo(c[1], c[2]);
          if (linePath) linePath.moveTo(c[1], c[2]);
          break;
        case 'l': case 'q':
          if (fill && !fillPath) { fillPath = new Path2D(); fillPath.moveTo(pen[0], pen[1]); }
          if (line && !linePath) { linePath = new Path2D(); linePath.moveTo(pen[0], pen[1]); }
          if (c[0] === 'l') { if (fillPath) fillPath.lineTo(c[1], c[2]); if (linePath) linePath.lineTo(c[1], c[2]); pen = [c[1], c[2]]; }
          else { if (fillPath) fillPath.quadraticCurveTo(c[1], c[2], c[3], c[4]); if (linePath) linePath.quadraticCurveTo(c[1], c[2], c[3], c[4]); pen = [c[3], c[4]]; }
          break;
      }
    }
    flushFill(); flushLine();
  }
  function gradientFill(ctx, c, cx) {
    var colors = c[2] || [], alphas = c[3] || [], ratios = c[4] || [], m = c[5] || {};
    var g;
    var n = $.n, gm = $.gm;
    if (gm(m, 'matrixType') === 'box') {
      var x = n(gm(m, 'x')), y = n(gm(m, 'y')), w = n(gm(m, 'w')), h = n(gm(m, 'h'));
      g = c[1] === 'radial' ? ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) / 2) : ctx.createLinearGradient(x, y, x + w, y);
    } else g = ctx.createLinearGradient(0, 0, 100, 0);
    for (var i = 0; i < colors.length; i++) { var col = n(colors[i]) | 0; g.addColorStop(Math.max(0, Math.min(1, n(ratios[i]) / 255)), hexColor(col, n(alphas[i]), cx)); }
    return g;
  }
  $.hitGfx = function (g, x, y) { var b = g.bounds; return !!b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; };

  // ---------------------------------------------------------------- masks
  function maskPath(o, wm, out) {
    if (!o.visible && out.depth > 0) return;
    out.depth++;
    if (o instanceof $.Graphic) {
      var layers = $.layersOf(o), dm = new DOMMatrix(wm);
      for (var i = 0; i < layers.length; i++) if (layers[i].fill) out.p.addPath(o.def.k === 'morph' ? new Path2D(layers[i].d) : $.pathOf(layers[i]), dm);
    } else if (o instanceof $.EditText) {
      var r = new Path2D(); r.rect(o.bx, o.by, o.bw, o.bh); out.p.addPath(r, new DOMMatrix(wm));
    } else if (o.kids) {
      for (var k = 0; k < o.kids.length; k++) { var c = o.kids[k]; if (!c.clipDepth) maskPath(c, mul(wm, c.m), out); }
      if (o.gfx && o.gfx.bounds) { var b = o.gfx.bounds, p = new Path2D(); p.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); out.p.addPath(p, new DOMMatrix(wm)); }
    }
  }

  // ---------------------------------------------------------------- display list
  function drawList(ctx, kids, wm, cx) {
    for (var i = 0; i < kids.length; i++) {
      var o = kids[i];
      if (o.clipDepth) {
        var j = i + 1, group = [];
        while (j < kids.length && kids[j].depth <= o.clipDepth) { group.push(kids[j]); j++; }
        var mp = { p: new Path2D(), depth: 0 };
        var S = view.S;
        maskPath(o, mul([S, 0, 0, S, 0, 0], mul(wm, o.m)), mp);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clip(mp.p);
        for (var g = 0; g < group.length; g++) drawObj(ctx, group[g], wm, cx);
        ctx.restore();
        i = j - 1;
        continue;
      }
      drawObj(ctx, o, wm, cx);
    }
  }
  function drawObj(ctx, o, pwm, pcx) {
    if (!o.visible) return;
    var cx = combine(pcx, o.cx);
    if (cx && cx[3] <= 0 && cx[7] <= 0) return;
    var wm = mul(pwm, o.m);
    if (o.kids) {
      if (o.gfx && o.gfx.cmds.length) drawGfx(ctx, o.gfx, wm, cx);
      drawList(ctx, o.kids, wm, cx);
    } else if (o instanceof $.Graphic) {
      drawGraphic(ctx, o, wm, cx);
    } else if (o instanceof $.EditText) {
      var S = view.S;
      ctx.setTransform(S * wm[0], S * wm[1], S * wm[2], S * wm[3], S * wm[4], S * wm[5]);
      o.draw(ctx, cx);
    }
  }
  $.drawObj = drawObj;

  // ---------------------------------------------------------------- entry points
  $.setupView = function (canvas) { view.canvas = canvas; view.ctx = canvas.getContext('2d'); };
  $.resizeView = function (cssW) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var S = Math.max(0.25, cssW * dpr / LIB.w);
    view.S = S;
    view.canvas.width = Math.round(LIB.w * S);
    view.canvas.height = Math.round(LIB.h * S);
  };
  $.render = function () {
    var ctx = view.ctx, S = view.S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgb(' + LIB.bg[0] + ',' + LIB.bg[1] + ',' + LIB.bg[2] + ')';
    ctx.fillRect(0, 0, view.canvas.width, view.canvas.height);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, LIB.w * S, LIB.h * S); ctx.clip();
    if ($.root) drawObj(ctx, $.root, [1, 0, 0, 1, 0, 0], null);
    ctx.restore();
  };
})();
