// TextField: dynamic and input text drawn with the browser's fonts (the game uses device fonts),
// a small HTML subset, word wrapping, variable binding and keyboard editing.
'use strict';
(function () {
  var LIB = window.LIB;
  var NF = $.NF, str = $.str, num = $.n, DP = $.DisplayObject.prototype;

  var FACES = {
    '_sans': 'Arial, Helvetica, "Liberation Sans", sans-serif',
    '_serif': '"Times New Roman", Times, "Liberation Serif", serif',
    '_typewriter': '"Courier New", Courier, "Liberation Mono", monospace',
    'arial': 'Arial, Helvetica, "Liberation Sans", sans-serif',
    'arial baltic': 'Arial, Helvetica, "Liberation Sans", sans-serif',
    'times new roman': '"Times New Roman", Times, "Liberation Serif", serif',
    'verdana': 'Verdana, Geneva, "DejaVu Sans", sans-serif',
    'fff estudio extended': '"Lucida Console", Monaco, "DejaVu Sans Mono", monospace',
  };
  // ascent / descent per em for the browser fonts
  var METRICS = { sans: [0.905, 0.212], serif: [0.891, 0.216], mono: [0.833, 0.300] };
  function cssFace(name) {
    var l = (name || '_sans').toLowerCase();
    return FACES[l] || ('"' + name + '", Arial, Helvetica, sans-serif');
  }
  function metricsOf(face) { return /mono|Courier/.test(face) ? METRICS.mono : (/serif"?, serif|Times/.test(face) && !/sans/.test(face) ? METRICS.serif : METRICS.sans); }
  function fontName(id) { var f = id !== null && id !== undefined && LIB.fonts[id]; return f ? f.name : '_sans'; }

  var measureCtx = null;
  function mctx() { if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d'); return measureCtx; }
  function cssFont(fmt) { return (fmt.italic ? 'italic ' : '') + (fmt.bold ? 'bold ' : '') + fmt.size + 'px ' + cssFace(fmt.font); }
  var widthCache = new Map();
  function textWidth(s, fmt) {
    var f = cssFont(fmt), key = f + '|' + s;
    var w = widthCache.get(key);
    if (w === undefined) {
      var c = mctx(); c.font = f;
      w = c.measureText(s).width + (fmt.spacing || 0) * s.length;
      if (widthCache.size > 20000) widthCache.clear();
      widthCache.set(key, w);
    }
    return w;
  }

  // ---------------------------------------------------------------- formats
  function Fmt(o) { for (var k in o) this[k] = o[k]; }
  function cloneFmt(f) { return new Fmt(f); }
  function colorStr(c) { return 'rgb(' + ((c >> 16) & 255) + ',' + ((c >> 8) & 255) + ',' + (c & 255) + ')'; }
  function rgbNum(a) { return (a[0] << 16) | (a[1] << 8) | a[2]; }
  var ALIGNS = ['left', 'right', 'center', 'justify'];

  // ---------------------------------------------------------------- HTML subset
  function decodeEntities(s) {
    return s.replace(/&(#x?[0-9a-f]+|lt|gt|amp|quot|apos|nbsp);/gi, function (m, e) {
      var l = e.toLowerCase();
      if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'amp') return '&'; if (l === 'quot') return '"'; if (l === 'apos') return "'"; if (l === 'nbsp') return ' ';
      if (l.charAt(1) === 'x') return String.fromCharCode(parseInt(l.slice(2), 16));
      return String.fromCharCode(parseInt(l.slice(1), 10));
    });
  }
  function attrs(tag) {
    var o = {}, re = /([a-zA-Z_:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, m;
    while ((m = re.exec(tag))) o[m[1].toLowerCase()] = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[5]);
    return o;
  }
  // parse HTML into runs [{t: text, f: fmt}] ; paragraphs separated by "\r"
  function parseHtml(html, base) {
    var runs = [], stack = [cloneFmt(base)], i = 0, first = true;
    var cur = function () { return stack[stack.length - 1]; };
    var push = function (t) { if (t) runs.push({ t: t, f: cur() }); };
    var re = /<[^>]*>/g, m, last = 0;
    while ((m = re.exec(html))) {
      push(decodeEntities(html.slice(last, m.index)));
      last = re.lastIndex;
      var tag = m[0], close = tag.charAt(1) === '/';
      var name = (tag.match(/^<\/?\s*([a-zA-Z0-9]+)/) || [])[1];
      if (!name) continue;
      name = name.toLowerCase();
      if (close) {
        if (name === 'p' || name === 'li') { push('\r'); }
        if (stack.length > 1 && ['font', 'b', 'i', 'u', 'p', 'a', 'li', 'textformat', 'span'].indexOf(name) >= 0) stack.pop();
        continue;
      }
      if (name === 'br' || name === 'sbr') { push('\r'); continue; }
      var f = cloneFmt(cur()), a = attrs(tag);
      switch (name) {
        case 'b': f.bold = true; break;
        case 'i': f.italic = true; break;
        case 'u': f.underline = true; break;
        case 'font':
          if (a.face) f.font = a.face;
          if (a.size) { var sz = a.size; f.size = /^[+-]/.test(sz) ? f.size + (+sz) : +sz; }
          if (a.color) f.color = parseInt(a.color.replace('#', ''), 16) || 0;
          if (a.letterspacing) f.spacing = +a.letterspacing;
          break;
        case 'p': if (a.align) f.align = a.align.toLowerCase(); break;
        case 'textformat':
          if (a.leading) f.leading = +a.leading; if (a.leftmargin) f.ml = +a.leftmargin; if (a.rightmargin) f.mr = +a.rightmargin;
          if (a.indent) f.indent = +a.indent; if (a.blockindent) f.block = +a.blockindent;
          break;
        case 'li': f.bullet = true; break;
        case 'a': if (a.href) f.url = a.href; break;
      }
      if (['font', 'b', 'i', 'u', 'p', 'a', 'li', 'textformat', 'span'].indexOf(name) >= 0) stack.push(f);
    }
    push(decodeEntities(html.slice(last)));
    // HTML text ends paragraphs with \r; the last one is dropped like Flash does
    if (runs.length && runs[runs.length - 1].t === '\r') runs.pop();
    return runs;
  }
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ---------------------------------------------------------------- EditText
  function EditText(def, id) {
    $.DisplayObject.call(this);
    this.def = def; this.charId = id;
    this.vars = Object.create($.TextFieldProto);
    var b = def.b;
    this.bx = b[0]; this.by = b[1]; this.bw = b[2] - b[0]; this.bh = b[3] - b[1];
    this.fmt = new Fmt({
      font: def.face || fontName(def.font), size: def.size, color: rgbNum(def.color), bold: def.font !== null && LIB.fonts[def.font] ? LIB.fonts[def.font].bold : false,
      italic: def.font !== null && LIB.fonts[def.font] ? LIB.fonts[def.font].italic : false, underline: false, align: ALIGNS[def.align] || 'left',
      leading: def.leading, ml: def.ml, mr: def.mr, indent: def.indent, block: 0, spacing: 0, url: '',
    });
    this.alphaText = def.color[3] / 255;
    this.html = !!def.html;
    this.multiline = def.multi; this.wordWrap = def.wrap; this.password = def.password;
    this.input = !def.readonly; this.selectable = def.selectable;
    this.border = def.border; this.background = def.border; this.borderColor = 0; this.backgroundColor = 0xffffff;
    this.autoSize = def.autoSize ? 'left' : 'none';
    this.maxChars = def.maxLen;
    this.variable = def.variable;
    this.scroll = 1;
    this.restrict = null;
    this.runs = [];
    this.layout = null;
    this.caret = 0;
    this.setRaw(def.text || '', this.html);
    this.$bindInit = false;
  }
  EditText.prototype = Object.create(DP);
  EditText.prototype.constructor = EditText;
  $.EditText = EditText;
  var EP = EditText.prototype;
  EP.isInput = function () { return this.input; };
  EP.setRaw = function (s, asHtml) {
    if (asHtml) this.runs = parseHtml(s, this.fmt);
    else this.runs = s ? [{ t: s.replace(/\r\n|\n/g, '\r'), f: this.fmt }] : [];
    this.layout = null;
    if (this.autoSize !== 'none') this.doAutoSize();
  };
  EP.getText = function () { var s = ''; for (var i = 0; i < this.runs.length; i++) s += this.runs[i].t; return s; };
  EP.getHtml = function () {
    var out = '', paras = this.getText().split('\r');
    var f = this.fmt;
    for (var i = 0; i < paras.length; i++) {
      out += '<P ALIGN="' + f.align.toUpperCase() + '"><FONT FACE="' + f.font + '" SIZE="' + f.size + '" COLOR="#' + ('00000' + f.color.toString(16).toUpperCase()).slice(-6) + '">' + escapeHtml(paras[i]) + '</FONT></P>';
    }
    return out;
  };
  EP.setText = function (s) { this.setRaw(s, false); };
  EP.setHtmlText = function (s) { this.setRaw(s, this.html); };
  EP.localBounds = function () { return [this.bx, this.by, this.bx + this.bw, this.by + this.bh]; };

  // layout: lines of [{x, t, f}] with baselines
  EP.doLayout = function () {
    if (this.layout) return this.layout;
    var maxW = this.bw - 4;
    var lines = [], line = null, y = 2;
    var self = this;
    function newLine(f) { line = { items: [], w: 0, asc: 0, desc: 0, lead: 0, f: f, x0: 0 }; lines.push(line); }
    function metrics(f) { var m = metricsOf(cssFace(f.font)); return [m[0] * f.size, m[1] * f.size]; }
    function addItem(t, f) {
      var w = textWidth(t, f), m = metrics(f);
      line.items.push({ t: t, f: f, x: line.w, w: w });
      line.w += w;
      if (m[0] > line.asc) line.asc = m[0];
      if (m[1] > line.desc) line.desc = m[1];
      if ((f.leading || 0) > line.lead) line.lead = f.leading || 0;
    }
    var text = this.password ? null : null;
    newLine(this.runs.length ? this.runs[0].f : this.fmt);
    var first = true;
    for (var r = 0; r < this.runs.length; r++) {
      var run = this.runs[r], f = run.f, t = this.password ? run.t.replace(/[^\r]/g, '*') : run.t;
      var paras = t.split('\r');
      for (var p = 0; p < paras.length; p++) {
        if (p > 0) { if (!this.multiline && !this.html) { /* single-line fields still break on \r in Flash */ } newLine(f); }
        var seg = paras[p];
        if (!seg) continue;
        line.f = line.items.length ? line.f : f;
        if (!this.wordWrap) { addItem(seg, f); continue; }
        // word wrap
        var avail = maxW - (f.ml || 0) - (f.mr || 0) - (f.block || 0) - (line === lines[0] || line.items.length === 0 ? (f.indent || 0) : 0);
        var words = seg.split(/( +)/);
        var buf = '';
        for (var wi = 0; wi < words.length; wi++) {
          var wd = words[wi];
          if (!wd) continue;
          var tryS = buf + wd;
          if (line.w + textWidth(tryS, f) <= avail || (line.w === 0 && buf === '')) { buf = tryS; continue; }
          if (/^ +$/.test(wd)) { buf += wd; continue; }
          if (buf) addItem(buf, f);
          buf = '';
          if (line.w > 0) newLine(f);
          // very long word: break by characters
          if (textWidth(wd, f) > avail) {
            var part = '';
            for (var ci = 0; ci < wd.length; ci++) {
              if (textWidth(part + wd.charAt(ci), f) > avail && part) { addItem(part, f); newLine(f); part = ''; }
              part += wd.charAt(ci);
            }
            buf = part;
          } else buf = wd;
        }
        if (buf) addItem(buf, f);
      }
    }
    // vertical positions
    var maxLineW = 0;
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!L.items.length) { var m0 = metrics(L.f); L.asc = m0[0]; L.desc = m0[1]; L.lead = L.f.leading || 0; }
      L.base = y + L.asc;
      y += L.asc + L.desc + L.lead;
      // trailing spaces do not count for alignment
      var tw = L.w;
      if (L.items.length) { var lastIt = L.items[L.items.length - 1]; var tr = lastIt.t.match(/ +$/); if (tr) tw -= textWidth(tr[0], lastIt.f); }
      var lf = L.items.length ? L.items[0].f : L.f;
      var left = 2 + (lf.ml || 0) + (lf.block || 0) + (i === 0 || isParaStart(lines, i) ? (lf.indent || 0) : 0);
      var right = this.bw - 2 - (lf.mr || 0);
      var al = lf.align || 'left';
      L.x0 = al === 'center' ? left + (right - left - tw) / 2 : (al === 'right' ? right - tw : left);
      if (tw > maxLineW) maxLineW = tw;
    }
    this.layout = { lines: lines, height: y - (lines.length ? lines[lines.length - 1].lead : 0) + 2, width: maxLineW };
    return this.layout;
  };
  function isParaStart() { return false; }
  EP.doAutoSize = function () {
    this.layout = null;
    var L = this.doLayout();
    var w = L.width + 4, h = L.height;
    if (!this.wordWrap) {
      var oldW = this.bw;
      if (this.autoSize === 'center') this.bx += (oldW - w) / 2;
      else if (this.autoSize === 'right') this.bx += oldW - w;
      this.bw = w;
    }
    this.bh = h;
    this.layout = null;
  };
  EP.maxScroll = function () {
    var L = this.doLayout(), lines = L.lines, h = this.bh;
    if (!lines.length) return 1;
    var bottom = lines[lines.length - 1].base + lines[lines.length - 1].desc;
    if (bottom <= h) return 1;
    for (var i = 0; i < lines.length; i++) { if (bottom - (lines[i].base - lines[i].asc) + 2 <= h) return i + 1; }
    return lines.length;
  };

  // drawing (called by the renderer with the object's transform already applied)
  EP.draw = function (ctx, cx) {
    var x0 = this.bx, y0 = this.by;
    var a = cx ? Math.max(0, Math.min(1, cx[3] + cx[7] / 255)) : 1;
    if (a <= 0) return;
    if (this.background || this.border) {
      ctx.globalAlpha = a;
      if (this.background) { ctx.fillStyle = tint(this.backgroundColor, cx); ctx.fillRect(x0, y0, this.bw, this.bh); }
      if (this.border) { ctx.strokeStyle = tint(this.borderColor, cx); ctx.lineWidth = Math.max(1 / ($.view ? $.view.S : 1), 0.5); ctx.strokeRect(x0 + 0.5, y0 + 0.5, this.bw - 1, this.bh - 1); }
    }
    var L = this.doLayout();
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, this.bw, this.bh); ctx.clip();
    var sc = Math.max(1, this.scroll | 0) - 1;
    var dy = sc > 0 && L.lines[sc] ? -(L.lines[sc].base - L.lines[sc].asc - 2) : 0;
    ctx.textBaseline = 'alphabetic';
    for (var i = sc; i < L.lines.length; i++) {
      var line = L.lines[i];
      var by = y0 + line.base + dy;
      if (by - line.asc > y0 + this.bh) break;
      for (var j = 0; j < line.items.length; j++) {
        var it = line.items[j];
        ctx.font = cssFont(it.f);
        ctx.fillStyle = tint(it.f.color, cx);
        ctx.globalAlpha = a * this.alphaText;
        var tx = x0 + line.x0 + it.x;
        if (it.f.spacing) { var px = tx; for (var k = 0; k < it.t.length; k++) { ctx.fillText(it.t.charAt(k), px, by); px += textWidth(it.t.charAt(k), it.f); } }
        else ctx.fillText(it.t, tx, by);
        if (it.f.underline) ctx.fillRect(tx, by + 1, it.w, Math.max(1, it.f.size / 16));
      }
    }
    // caret
    if ($.focus === this && this.input && (Date.now() >> 9) % 2 === 0) {
      var pos = this.caretPos(L);
      ctx.globalAlpha = a;
      ctx.fillStyle = tint(this.fmt.color, cx);
      ctx.fillRect(x0 + pos[0], y0 + pos[1] + dy, Math.max(1, 1 / ($.view ? $.view.S : 1)), pos[2]);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  };
  EP.caretPos = function (L) {
    var text = this.getText(), n = Math.min(this.caret, text.length), count = 0;
    for (var i = 0; i < L.lines.length; i++) {
      var line = L.lines[i], lineLen = 0;
      for (var j = 0; j < line.items.length; j++) lineLen += line.items[j].t.length;
      if (n <= count + lineLen || i === L.lines.length - 1) {
        var rem = n - count, x = line.x0;
        for (var k = 0; k < line.items.length && rem > 0; k++) {
          var it = line.items[k];
          if (rem >= it.t.length) { x = line.x0 + it.x + it.w; rem -= it.t.length; }
          else { x = line.x0 + it.x + textWidth(it.t.slice(0, rem), it.f); rem = 0; }
        }
        return [x, line.base - line.asc, line.asc + line.desc];
      }
      count += lineLen + 1; // paragraph break
    }
    return [2, 2, this.fmt.size];
  };
  function tint(c, cx) {
    var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    if (cx) { r = clamp(r * cx[0] + cx[4]); g = clamp(g * cx[1] + cx[5]); b = clamp(b * cx[2] + cx[6]); }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

  // ---------------------------------------------------------------- AS properties
  var TF_PROPS = {
    text: [function () { return this.getText(); }, function (v) { this.setText(str(v)); }],
    htmltext: [function () { return this.html ? this.getHtml() : this.getText(); }, function (v) { this.setHtmlText(str(v)); }],
    html: [function () { return this.html; }, function (v) { this.html = $.bool(v); }],
    textcolor: [function () { return this.fmt.color; }, function (v) { this.fmt.color = num(v) | 0; for (var i = 0; i < this.runs.length; i++) { this.runs[i].f = cloneFmt(this.runs[i].f); this.runs[i].f.color = this.fmt.color; } this.layout = null; }],
    autosize: [function () { return this.autoSize; }, function (v) { this.autoSize = v === true ? 'left' : (v === false || v === undefined ? 'none' : str(v).toLowerCase()); if (this.autoSize !== 'none') this.doAutoSize(); }],
    border: [function () { return this.border; }, function (v) { this.border = $.bool(v); }],
    bordercolor: [function () { return this.borderColor; }, function (v) { this.borderColor = num(v) | 0; }],
    background: [function () { return this.background; }, function (v) { this.background = $.bool(v); }],
    backgroundcolor: [function () { return this.backgroundColor; }, function (v) { this.backgroundColor = num(v) | 0; }],
    multiline: [function () { return this.multiline; }, function (v) { this.multiline = $.bool(v); this.layout = null; }],
    wordwrap: [function () { return this.wordWrap; }, function (v) { this.wordWrap = $.bool(v); this.layout = null; }],
    selectable: [function () { return this.selectable; }, function (v) { this.selectable = $.bool(v); }],
    type: [function () { return this.input ? 'input' : 'dynamic'; }, function (v) { this.input = str(v).toLowerCase() === 'input'; }],
    variable: [function () { return this.variable === null ? null : this.variable; }, function (v) { this.variable = v === null || v === undefined ? null : str(v); this.$bindInit = false; }],
    maxchars: [function () { return this.maxChars; }, function (v) { this.maxChars = v === null ? null : num(v) | 0; }],
    length: [function () { return this.getText().length; }, null],
    scroll: [function () { return this.scroll; }, function (v) { this.scroll = Math.max(1, Math.min(this.maxScroll(), num(v) | 0)); }],
    maxscroll: [function () { return this.maxScroll(); }, null],
    bottomscroll: [function () { return this.maxScroll(); }, null],
    textwidth: [function () { return this.doLayout().width; }, null],
    textheight: [function () { return this.doLayout().height - 4; }, null],
    password: [function () { return this.password; }, function (v) { this.password = $.bool(v); this.layout = null; }],
    embedfonts: [function () { return !!this.def.outlines; }, function () { }],
    restrict: [function () { return this.restrict; }, function (v) { this.restrict = v === null || v === undefined ? null : str(v); }],
    condensewhite: [function () { return false; }, function () { }],
  };
  EP.nativeGet = function (name) { var p = TF_PROPS[$.lower(name)]; return p ? p[0].call(this) : NF; };
  EP.nativeSet = function (name, v) { var p = TF_PROPS[$.lower(name)]; if (!p) return false; if (p[1]) p[1].call(this, v); return true; };
  EP.getMemberRaw = function (name) {
    // text field native properties take priority over prototype members
    var v = this.vars;
    if (Object.prototype.hasOwnProperty.call(v, name)) return v[name];
    var p = TF_PROPS[$.lower(name)];
    if (p) return p[0].call(this);
    return DP.getMemberRaw.call(this, name);
  };
  EP.getProp = function (p) {
    if (p === '_width') { var b = this.boundsIn(this.m); return b ? b[2] - b[0] : 0; }
    return DP.getProp.call(this, p);
  };
  EP.setSize = function (value, isWidth) {
    // a text field's _width/_height change its box, not its scale
    if (isWidth) this.bw = Math.max(0, value); else this.bh = Math.max(0, value);
    this.layout = null;
  };

  function fmtToAS(f) {
    var o = $.construct($.global.TextFormat, []);
    o.font = f.font; o.size = f.size; o.color = f.color; o.bold = !!f.bold; o.italic = !!f.italic; o.underline = !!f.underline;
    o.align = f.align; o.leading = f.leading || 0; o.leftMargin = f.ml || 0; o.rightMargin = f.mr || 0; o.indent = f.indent || 0;
    o.blockIndent = f.block || 0; o.url = f.url || ''; o.target = ''; o.bullet = !!f.bullet; o.letterSpacing = f.spacing || 0;
    return o;
  }
  function applyFmt(f, o) {
    var g = function (k) { var v = $.gm(o, k); return v === undefined || v === null ? undefined : v; };
    var v;
    if ((v = g('font')) !== undefined) f.font = str(v);
    if ((v = g('size')) !== undefined) f.size = num(v);
    if ((v = g('color')) !== undefined) f.color = num(v) | 0;
    if ((v = g('bold')) !== undefined) f.bold = $.bool(v);
    if ((v = g('italic')) !== undefined) f.italic = $.bool(v);
    if ((v = g('underline')) !== undefined) f.underline = $.bool(v);
    if ((v = g('align')) !== undefined) f.align = str(v).toLowerCase();
    if ((v = g('leading')) !== undefined) f.leading = num(v);
    if ((v = g('leftMargin')) !== undefined) f.ml = num(v);
    if ((v = g('rightMargin')) !== undefined) f.mr = num(v);
    if ((v = g('indent')) !== undefined) f.indent = num(v);
    if ((v = g('blockIndent')) !== undefined) f.block = num(v);
    if ((v = g('letterSpacing')) !== undefined) f.spacing = num(v);
  }
  $.TextFieldProto = Object.create($.ObjectProto);
  $.methods($.TextFieldProto, {
    setTextFormat: function () {
      if (!(this instanceof EditText)) return;
      var a = arguments, tf = a[a.length - 1];
      if (!tf || typeof tf !== 'object') return;
      if (a.length === 1) { applyFmt(this.fmt, tf); for (var i = 0; i < this.runs.length; i++) { this.runs[i].f = cloneFmt(this.runs[i].f); applyFmt(this.runs[i].f, tf); } }
      else { for (var j = 0; j < this.runs.length; j++) { this.runs[j].f = cloneFmt(this.runs[j].f); applyFmt(this.runs[j].f, tf); } }
      this.layout = null;
      if (this.autoSize !== 'none') this.doAutoSize();
    },
    setNewTextFormat: function (tf) { if (this instanceof EditText && tf && typeof tf === 'object') applyFmt(this.fmt, tf); },
    getTextFormat: function () { return this instanceof EditText ? fmtToAS(this.runs.length ? this.runs[0].f : this.fmt) : undefined; },
    getNewTextFormat: function () { return this instanceof EditText ? fmtToAS(this.fmt) : undefined; },
    replaceSel: function (s) { if (this instanceof EditText) { this.insertText(str(s)); } },
    removeTextField: function () { if (this instanceof EditText && this.parent && this.depth >= $.DEPTH_OFFSET) this.parent.removeChild(this); },
    getDepth: function () { return this.depth - $.DEPTH_OFFSET; },
    swapDepths: $.MovieClipProto.swapDepths,
    addListener: function () { return true; }, removeListener: function () { return true; },
    getFontList: function () { return ['_sans', '_serif', '_typewriter', 'Arial', 'Times New Roman']; },
  });

  // ---------------------------------------------------------------- variable binding
  // A text field with a variable shows that variable of its parent timeline (polled every frame).
  EP.bindTarget = function () {
    var path = this.variable, p = this.parent;
    while (p && !p.$isClip) p = p.parent;
    if (!p) return null;
    var i = Math.max(path.lastIndexOf('.'), path.lastIndexOf(':'));
    var obj = p, prop = path;
    if (i >= 0) {
      obj = $.resolvePath(p.scope(), path.slice(0, i) || '/');
      prop = path.slice(i + 1);
    }
    if (obj === undefined || obj === null) return null;
    return [obj, prop];
  };
  EP.syncBinding = function () {
    if (this.variable === null || this.removed) return;
    var b = this.bindTarget();
    if (!b) return;
    var obj = b[0], prop = b[1];
    var raw = $.getRaw(obj, prop);
    if (!this.$bindInit) {
      this.$bindInit = true;
      if (raw === NF) { var t = this.getText(); if (t !== '') $.sm(obj, prop, t); return; }
    }
    if (raw === NF) return;
    var s = str(raw);
    if (s !== this.$bound) { this.$bound = s; if (this.html) this.setRaw(s, true); else this.setRaw(s, false); }
  };
  EP.pushBinding = function () {
    if (this.variable === null) return;
    var b = this.bindTarget();
    if (b) { var t = this.getText(); this.$bound = t; $.sm(b[0], b[1], t); }
  };
  EP.postInstantiate = function () { $.textFields.push(this); this.syncBinding(); };
  $.textFields = [];
  $.updateBindings = function () {
    var l = $.textFields, j = 0;
    for (var i = 0; i < l.length; i++) { var t = l[i]; if (t.removed) continue; l[j++] = t; t.syncBinding(); }
    l.length = j;
  };

  // ---------------------------------------------------------------- editing
  EP.onFocus = function () { this.caret = this.getText().length; };
  EP.insertText = function (s) {
    var t = this.getText();
    if (this.restrict !== null && this.restrict !== '') {
      var re; try { re = new RegExp('^[' + this.restrict.replace(/\\/g, '\\\\').replace(/]/g, '\\]') + ']$'); } catch (e) { re = null; }
      if (re) s = s.split('').filter(function (c) { return re.test(c); }).join('');
    }
    if (this.maxChars !== null && this.maxChars > 0) s = s.slice(0, Math.max(0, this.maxChars - t.length));
    if (!s) return;
    var c = Math.min(this.caret, t.length);
    this.runs = [{ t: t.slice(0, c) + s + t.slice(c), f: this.runs.length ? this.runs[0].f : this.fmt }];
    this.caret = c + s.length;
    this.changed();
  };
  EP.changed = function () {
    this.layout = null;
    if (this.autoSize !== 'none') this.doAutoSize();
    this.pushBinding();
    var self = this, f = this.getMember('onChanged');
    if (typeof f === 'function') $.queueCall(this, function () { f.call(self, self); });
  };
  EP.keyInput = function (e) {
    var t = this.getText(), c = Math.min(this.caret, t.length);
    switch (e.key) {
      case 'Backspace': if (c > 0) { this.runs = [{ t: t.slice(0, c - 1) + t.slice(c), f: this.runs[0].f }]; this.caret = c - 1; this.changed(); } return true;
      case 'Delete': if (c < t.length) { this.runs = [{ t: t.slice(0, c) + t.slice(c + 1), f: this.runs[0].f }]; this.changed(); } return true;
      case 'ArrowLeft': this.caret = Math.max(0, c - 1); return true;
      case 'ArrowRight': this.caret = Math.min(t.length, c + 1); return true;
      case 'Home': this.caret = 0; return true;
      case 'End': this.caret = t.length; return true;
      case 'Enter': if (this.multiline) this.insertText('\r'); return true;
    }
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) { this.insertText(e.key); return true; }
    return false;
  };
})();
