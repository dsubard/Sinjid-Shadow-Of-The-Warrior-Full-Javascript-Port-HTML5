// Display list, timelines, clip events, the action queue and mouse/keyboard dispatch.
// The frame lifecycle follows Flash Player's AVM1 model (as documented by Ruffle):
//  - every frame, clips run in "execution list" order (newest first): load/enterFrame event, then the
//    playhead advances and the frame's tags are processed;
//  - frame scripts and event handlers are queued and run after the display list is updated;
//  - a clip placed by the timeline immediately runs its first frame.
'use strict';
(function () {
  var LIB = window.LIB;
  var NF = $.NF, str = $.str, num = $.n, isDO = $.isDO, hasOwn = Object.prototype.hasOwnProperty;
  var DEPTH_OFFSET = 16384;           // AS depth = internal depth - 16384 (timeline depths are below it)
  $.DEPTH_OFFSET = DEPTH_OFFSET;

  // ================================================================ matrices [a, b, c, d, tx, ty]
  var ID = [1, 0, 0, 1, 0, 0];
  function mul(p, c) {
    return [p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1], p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3],
      p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5]];
  }
  function inv(m) {
    var det = m[0] * m[3] - m[1] * m[2];
    if (!det) return [0, 0, 0, 0, 0, 0];
    var a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
  function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  function boundsXf(m, b) {
    if (!b) return null;
    var p = [apply(m, b[0], b[1]), apply(m, b[2], b[1]), apply(m, b[0], b[3]), apply(m, b[2], b[3])];
    return [Math.min(p[0][0], p[1][0], p[2][0], p[3][0]), Math.min(p[0][1], p[1][1], p[2][1], p[3][1]),
      Math.max(p[0][0], p[1][0], p[2][0], p[3][0]), Math.max(p[0][1], p[1][1], p[2][1], p[3][1])];
  }
  function unionB(r, b) { if (!b) return r; if (!r) return b.slice(); r[0] = Math.min(r[0], b[0]); r[1] = Math.min(r[1], b[1]); r[2] = Math.max(r[2], b[2]); r[3] = Math.max(r[3], b[3]); return r; }
  $.mat = { mul: mul, inv: inv, apply: apply, boundsXf: boundsXf, ID: ID };

  // ================================================================ action queue
  var queues = [[], [], []];              // 0: initialize, 1: construct, 2: normal
  var PRI_INIT = 0, PRI_CONSTRUCT = 1, PRI_NORMAL = 2;
  function queueScript(clip, id, pri, unload) { queues[pri === undefined ? PRI_NORMAL : pri].push({ c: clip, s: id, u: !!unload }); }
  function queueCall(clip, fn, pri, unload) { queues[pri === undefined ? PRI_NORMAL : pri].push({ c: clip, f: fn, u: !!unload }); }
  $.queueScript = queueScript; $.queueCall = queueCall;
  $.cur = null;
  function runScript(clip, id) {
    var prev = $.cur;
    $.cur = clip;
    try { S[id](clip.scope(), clip); }
    catch (e) { reportError('S[' + id + '] on ' + safePath(clip), e); }
    finally { $.cur = prev; }
  }
  $.runScript = runScript;
  function safePath(c) { try { return c.path(); } catch (e) { return '?'; } }
  var errorCount = 0;
  function reportError(where, e) {
    if (errorCount++ < 200) console.error('[script error] ' + where + ':', e);
    if ($.onScriptError) $.onScriptError(where, e);
  }
  $.reportError = reportError;
  function runQueue() {
    var guard = 0;
    for (;;) {
      var q = queues[0].length ? queues[0] : queues[1].length ? queues[1] : queues[2].length ? queues[2] : null;
      if (!q) break;
      var a = q.shift();
      if (!a.u && a.c && (a.c.removed || a.c.pending)) continue;
      if (a.s !== undefined) runScript(a.c, a.s);
      else { var prev = $.cur; $.cur = a.c; try { a.f(); } catch (e) { reportError('handler on ' + safePath(a.c), e); } finally { $.cur = prev; } }
      if (++guard > 200000) { console.error('action queue overflow'); queues = [[], [], []]; break; }
    }
  }
  $.runQueue = runQueue;

  // ================================================================ DisplayObject
  function DisplayObject() {
    this.parent = null;
    this.depth = 0;
    this.name = '';
    this.charId = 0;
    this.m = [1, 0, 0, 1, 0, 0];
    this.cx = null;          // color transform [rm, gm, bm, am, ra, ga, ba, aa]
    this.visible = true;
    this.ratio = 0;
    this.clipDepth = 0;
    this.placeFrame = 0;
    this.scripted = false;   // transformed by ActionScript: timeline transforms no longer apply
    this.byScript = false;   // created by attachMovie / duplicateMovieClip / createEmptyMovieClip
    this.removed = false;
    this.vars = null;        // AS properties (for objects that are AS-accessible)
    this.$sc = null;         // cached clip scope
    this.$cache = false;     // scale/rotation cache valid
    this.$sx = 1; this.$sy = 1; this.$rot = 0; this.$skew = 0;
  }
  $.DisplayObject = DisplayObject;
  var DP = DisplayObject.prototype;
  DP.$do = true;
  DP.$isClip = false;
  DP.root = function () { var o = this; while (o.parent) o = o.parent; return o; };
  DP.path = function () {
    if (!this.parent) return '_level0';
    return this.parent.path() + '.' + this.name;
  };
  DP.slashPath = function () {
    if (!this.parent) return '/';
    var p = this.parent.slashPath();
    return (p === '/' ? '/' : p + '/') + this.name;
  };
  DP.toString = function () { return this.path(); };
  DP.scope = function () { return this.$sc || (this.$sc = $.clipScope(this)); };
  DP.setMatrix = function (m) { this.m = m.slice(); this.$cache = false; };
  DP.cacheSR = function () {
    if (this.$cache) return;
    var a = this.m[0], b = this.m[1], c = this.m[2], d = this.m[3];
    var rx = Math.atan2(b, a), ry = Math.atan2(-c, d);
    this.$rot = rx * 180 / Math.PI;
    this.$sx = Math.sqrt(a * a + b * b);
    this.$sy = Math.sqrt(c * c + d * d);
    this.$skew = ry - rx;
    this.$cache = true;
  };
  DP.setScaleX = function (v) {
    this.scripted = true; this.cacheSR();
    this.$sx = v; if (v !== v) v = 0;
    var r = this.$rot !== this.$rot ? 0 : this.$rot * Math.PI / 180;
    this.m[0] = Math.cos(r) * v; this.m[1] = Math.sin(r) * v;
  };
  DP.setScaleY = function (v) {
    this.scripted = true; this.cacheSR();
    this.$sy = v; if (v !== v) v = 0;
    var r = this.$rot !== this.$rot ? 0 : this.$rot * Math.PI / 180;
    this.m[2] = -Math.sin(r + this.$skew) * v; this.m[3] = Math.cos(r + this.$skew) * v;
  };
  DP.setRotation = function (deg) {
    this.scripted = true; this.cacheSR();
    deg = deg % 360; if (deg > 180) deg -= 360; else if (deg < -180) deg += 360;
    this.$rot = deg;
    if (deg !== deg) return;
    var r = deg * Math.PI / 180, sk = this.$skew, sx = this.$sx, sy = this.$sy;
    this.m[0] = sx * Math.cos(r); this.m[1] = sx * Math.sin(r);
    this.m[2] = -sy * Math.sin(r + sk); this.m[3] = sy * Math.cos(r + sk);
  };
  DP.localBounds = function () { return null; };      // in own coordinates
  DP.boundsIn = function (m) { return boundsXf(m, this.localBounds()); };
  DP.worldMatrix = function () { var m = this.m; for (var p = this.parent; p; p = p.parent) m = mul(p.m, m); return m; };
  DP.hitShape = function () { return false; };       // local point inside the actual shape
  DP.alpha = function () { return this.cx ? this.cx[3] : 1; };

  // ---- display properties (case-insensitive, also reachable through GetProperty)
  var PROPS = {};
  ['_x', '_y', '_xscale', '_yscale', '_currentframe', '_totalframes', '_alpha', '_visible', '_width', '_height', '_rotation', '_target',
    '_framesloaded', '_name', '_droptarget', '_url', '_highquality', '_focusrect', '_soundbuftime', '_quality', '_xmouse', '_ymouse']
    .forEach(function (p) { PROPS[p] = p; $.register(p); });
  function propName(name) { return PROPS[name] || PROPS[$.lower(name)] || null; }
  $.propName = propName;
  DP.getProp = function (p) {
    switch (p) {
      case '_x': return this.m[4];
      case '_y': return this.m[5];
      case '_xscale': this.cacheSR(); return this.$sx * 100;
      case '_yscale': this.cacheSR(); return this.$sy * 100;
      case '_rotation': this.cacheSR(); return this.$rot;
      case '_alpha': return this.alpha() * 100;
      case '_visible': return this.visible;
      case '_width': { var b = this.boundsIn(this.m); return b ? b[2] - b[0] : 0; }
      case '_height': { var b2 = this.boundsIn(this.m); return b2 ? b2[3] - b2[1] : 0; }
      case '_name': return this.name;
      case '_target': return this.slashPath();
      case '_url': return $.pageUrl || '';
      case '_currentframe': return this.$isClip ? Math.max(1, this.frame) : undefined;
      case '_totalframes': return this.$isClip ? this.totalFrames : undefined;
      case '_framesloaded': return this.$isClip ? this.totalFrames : undefined;
      case '_droptarget': return this.$isClip ? (this.dropTarget || '') : undefined;
      case '_highquality': return $.quality === 'LOW' ? 0 : ($.quality === 'BEST' ? 2 : 1);
      case '_quality': return $.quality || 'HIGH';
      case '_focusrect': return $.focusRect === undefined ? true : $.focusRect;
      case '_soundbuftime': return 5;
      case '_xmouse': { var w = inv(this.worldMatrix()); return apply(w, $.mouse.x, $.mouse.y)[0]; }
      case '_ymouse': { var w2 = inv(this.worldMatrix()); return apply(w2, $.mouse.x, $.mouse.y)[1]; }
    }
    return undefined;
  };
  DP.setProp = function (p, v) {
    var x;
    switch (p) {
      case '_x': x = num(v); if (x === x) { this.scripted = true; this.m[4] = x; } break;
      case '_y': x = num(v); if (x === x) { this.scripted = true; this.m[5] = x; } break;
      case '_xscale': x = num(v); this.setScaleX(x / 100); break;
      case '_yscale': x = num(v); this.setScaleY(x / 100); break;
      case '_rotation': x = num(v); this.setRotation(x); break;
      case '_alpha': x = num(v); if (x === x) { this.scripted = true; this.cx = this.cx ? this.cx.slice() : [1, 1, 1, 1, 0, 0, 0, 0]; this.cx[3] = x / 100; } break;
      case '_visible': this.visible = typeof v === 'number' ? (v === v && v !== 0) : $.bool(v); break;
      case '_width': x = num(v); if (x === x) this.setSize(x, true); break;
      case '_height': x = num(v); if (x === x) this.setSize(x, false); break;
      case '_name': this.rename(str(v)); break;
      case '_highquality': $.quality = num(v) === 0 ? 'LOW' : (num(v) >= 2 ? 'BEST' : 'HIGH'); break;
      case '_quality': $.quality = str(v).toUpperCase(); break;
      case '_focusrect': $.focusRect = $.bool(v); break;
      default: break; // read-only
    }
  };
  DP.setSize = function (value, isWidth) {
    var b = this.localBounds();
    if (!b) return;
    var w = b[2] - b[0], h = b[3] - b[1];
    this.cacheSR();
    var r = this.$rot * Math.PI / 180, cos = Math.abs(Math.cos(r)), sin = Math.abs(Math.sin(r));
    var sx = this.$sx, sy = this.$sy;
    if (isWidth) {
      // new scale so that the transformed width equals value (keeping the y scale)
      var denom = w * cos;
      var rest = h * sy * sin;
      if (denom) this.setScaleX(Math.max(0, (value - rest)) / denom);
      else if (!w) this.setScaleX(0);
    } else {
      var denom2 = h * cos;
      var rest2 = w * sx * sin;
      if (denom2) this.setScaleY(Math.max(0, (value - rest2)) / denom2);
      else if (!h) this.setScaleY(0);
    }
  };
  DP.rename = function (nm) { this.name = nm; if (this.parent) this.parent.$names = null; };

  // ---- AS member access (only for AS-visible objects: clips, buttons, text fields)
  DP.ownVar = function (name) {
    var v = this.vars;
    if (hasOwn.call(v, name)) return name;
    var a = $.alts(name);
    if (a) for (var i = 0; i < a.length; i++) if (hasOwn.call(v, a[i])) return a[i];
    return null;
  };
  DP.nativeGet = function () { return NF; };
  DP.nativeSet = function () { return false; };
  DP.childByName = function () { return null; };
  DP.getMemberRaw = function (name) {
    var v = this.vars;
    if (!v) return NF;
    if (hasOwn.call(v, name)) return v[name];
    var k = this.ownVar(name);
    if (k !== null) return v[k];
    var underscore = name.charCodeAt(0) === 95;
    if (underscore) {
      var l = $.lower(name);
      if (l === '_root') return this.root();
      if (l === '_parent') return this.parent || undefined;
      if (l === '_global') return $.global;
      if (l === '_level0') return $.root;
    }
    var ch = this.childByName(name);
    if (ch) return ch;
    if (underscore) { var p = propName(name); if (p) return this.getProp(p); }
    var nv = this.nativeGet(name);
    if (nv !== NF) return nv;
    var pk = $.findKey(v, name);
    if (pk !== null) return v[pk];
    return NF;
  };
  DP.getMember = function (name) { var r = this.getMemberRaw(name); return r === NF ? undefined : r; };
  DP.setMember = function (name, val) {
    var v = this.vars;
    if (!v) return;
    var k = this.ownVar(name);
    if (k === null) {
      if (name.charCodeAt(0) === 95) { var p = propName(name); if (p) { this.setProp(p, val); return; } }
      if (this.nativeSet(name, val)) return;
      k = $.findKey(v, name);
      if (k === null) { $.register(name); k = name; }
    }
    v[k] = val;
  };
  DP.deleteMember = function (name) {
    var k = this.ownVar(name);
    if (k === null) return false;
    delete this.vars[k];
    return true;
  };
  DP.enumKeys = function () {
    var keys = [], seen = Object.create(null);
    var chain = [], p = Object.getPrototypeOf(this.vars);
    while (p) { chain.push(p); p = Object.getPrototypeOf(p); }
    for (var i = chain.length - 1; i >= 0; i--) {
      var ks = Object.keys(chain[i]);
      for (var j = ks.length - 1; j >= 0; j--) if (!seen[ks[j]]) { seen[ks[j]] = 1; keys.push(ks[j]); }
    }
    var own = Object.keys(this.vars);
    for (var k = own.length - 1; k >= 0; k--) { keys.push(own[k]); }
    if (this.kids) for (var c = this.kids.length - 1; c >= 0; c--) if (this.kids[c].name) keys.push(this.kids[c].name);
    return keys;
  };

  // clip events (onClipEvent handlers from PlaceObject, and AS-defined handler methods)
  var METHOD = { load: 'onLoad', enterFrame: 'onEnterFrame', unload: 'onUnload', mouseMove: 'onMouseMove', mouseDown: 'onMouseDown',
    mouseUp: 'onMouseUp', press: 'onPress', release: 'onRelease', releaseOutside: 'onReleaseOutside', rollOver: 'onRollOver',
    rollOut: 'onRollOut', dragOver: 'onDragOver', dragOut: 'onDragOut', keyDown: 'onKeyDown', keyUp: 'onKeyUp' };
  var KEY_EVENTS = { keyDown: 1, keyUp: 1, keyPress: 1 };
  DP.dispatch = function (ev, keyCode) {
    var handled = false;
    var evs = this.events;
    if (evs) for (var i = 0; i < evs.length; i++) {
      var h = evs[i];
      if (h.e.indexOf(ev) < 0) continue;
      if (ev === 'keyPress') { if (h.k !== keyCode) continue; handled = true; }
      queueScript(this, h.s, PRI_NORMAL, ev === 'unload');
    }
    var mname = METHOD[ev];
    if (mname && !KEY_EVENTS[ev] && this.vars) {
      var self = this;
      var f = this.getMember(mname);
      if (typeof f === 'function') queueCall(this, function () { var g = self.getMember(mname); if (typeof g === 'function') g.call(self); }, PRI_NORMAL, ev === 'unload');
    }
    return handled;
  };
  DP.hasHandler = function (ev) {
    var evs = this.events;
    if (evs) for (var i = 0; i < evs.length; i++) if (evs[i].e.indexOf(ev) >= 0) return true;
    return false;
  };
  DP.unload = function () {
    this.removed = true;
    if ($.drag && $.drag.clip === this) $.drag = null;
    if ($.hover === this) $.hover = null;
    if ($.pressed === this) $.pressed = null;
    if ($.focus === this) $.focus = null;
  };

  // ================================================================ graphics (shapes, morph shapes, static text)
  function Graphic(def, id) { DisplayObject.call(this); this.def = def; this.charId = id; }
  Graphic.prototype = Object.create(DP);
  Graphic.prototype.constructor = Graphic;
  $.Graphic = Graphic;
  Graphic.prototype.localBounds = function () {
    var d = this.def;
    if (d.k === 'morph') { var t = this.ratio / 65535; return [d.b[0] + (d.b2[0] - d.b[0]) * t, d.b[1] + (d.b2[1] - d.b[1]) * t, d.b[2] + (d.b2[2] - d.b[2]) * t, d.b[3] + (d.b2[3] - d.b[3]) * t]; }
    return d.b;
  };
  Graphic.prototype.hitShape = function (x, y) {
    var b = this.localBounds();
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    var layers = $.layersOf(this), ctx = $.hitCtx();
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (L.fill && ctx.isPointInPath($.pathOf(L, this), x, y, L.eo ? 'evenodd' : 'nonzero')) return true;
      if (L.line) { ctx.lineWidth = Math.max(L.line.w, 1); if (ctx.isPointInStroke($.pathOf(L, this), x, y)) return true; }
    }
    return false;
  };
  var hitCanvas = null;
  $.hitCtx = function () { if (!hitCanvas) { hitCanvas = document.createElement('canvas'); hitCanvas.width = hitCanvas.height = 2; } return hitCanvas.getContext('2d'); };

  // ================================================================ MovieClip
  var execHead = null;          // execution list (newest first)
  function addToExec(c) { c.$next = execHead; execHead = c; }
  function MovieClip(def, id) {
    DisplayObject.call(this);
    this.def = def; this.charId = id;
    this.frame = 0;
    this.totalFrames = def ? Math.max(1, def.n || def.frames.length || 1) : 1;
    this.playing = true;
    this.kids = [];
    this.$names = null;
    this.initialized = false;
    this.gfx = null;
    this.events = null;
    this.vars = Object.create($.MovieClipProto);
    this.$next = null;
    this.$soundsFrame = 0;
    addToExec(this);
  }
  MovieClip.prototype = Object.create(DP);
  MovieClip.prototype.constructor = MovieClip;
  $.MovieClip = MovieClip;
  var CP = MovieClip.prototype;
  CP.$isClip = true;

  CP.childByName = function (name) {
    var m = this.$names;
    if (!m) {
      m = this.$names = new Map();
      for (var i = 0; i < this.kids.length; i++) {
        var k = this.kids[i];
        if (k.name && k.vars && !m.has(k.name)) m.set(k.name, k);
      }
    }
    var c = m.get(name);
    if (c) return c;
    var a = $.alts(name);
    if (a) for (var j = 0; j < a.length; j++) { c = m.get(a[j]); if (c) return c; }
    return null;
  };
  CP.childAt = function (depth) {
    var l = this.kids;
    for (var i = 0; i < l.length; i++) if (l[i].depth === depth) return l[i];
    return null;
  };
  CP.insert = function (obj, depth) {
    var old = this.childAt(depth);
    if (old) this.removeChild(old);
    obj.parent = this; obj.depth = depth;
    var l = this.kids, i = l.length;
    while (i > 0 && l[i - 1].depth > depth) i--;
    l.splice(i, 0, obj);
    this.$names = null;
  };
  CP.detach = function (obj) {
    var i = this.kids.indexOf(obj);
    if (i >= 0) this.kids.splice(i, 1);
    this.$names = null;
  };
  CP.removeChild = function (obj) {
    if (obj.pending) return;
    // Like Flash, a clip with unload handlers stays (at a negative depth) until the next frame starts.
    if (shouldDelayRemoval(obj)) {
      queueRemoval(obj);
      this.kids.sort(function (a, b) { return a.depth - b.depth; });
      this.$names = null;
      if (pendingParents.indexOf(this) < 0) pendingParents.push(this);
      return;
    }
    this.detach(obj);
    obj.unload();
  };
  var pendingParents = [];
  function shouldDelayRemoval(o) {
    if (o.$isClip) {
      if (o.hasHandler('unload')) return true;
      if (o.vars && o.getMemberRaw('onUnload') !== NF) return true;
      for (var i = 0; i < o.kids.length; i++) if (shouldDelayRemoval(o.kids[i])) return true;
    }
    return false;
  }
  function queueRemoval(o) {
    if (o.kids) for (var i = 0; i < o.kids.length; i++) queueRemoval(o.kids[i]);
    o.depth = -o.depth - 1;
    o.pending = true;
    if (o.$isClip) o.dispatch('unload');
  }
  // start of a frame: finish delayed removals
  $.removePending = function () {
    var l = pendingParents; pendingParents = [];
    for (var i = 0; i < l.length; i++) {
      var p = l[i], kids = p.kids.slice();
      for (var k = 0; k < kids.length; k++) if (kids[k].pending) { p.detach(kids[k]); kids[k].unload(true); }
    }
  };
  CP.unload = function (silent) {
    for (var i = 0; i < this.kids.length; i++) this.kids[i].unload(silent);
    if (!silent && !this.pending) this.dispatch('unload');
    $.stopClipSounds && $.stopClipSounds(this);
    DP.unload.call(this);
  };
  CP.localBounds = function () {
    var r = null;
    for (var i = 0; i < this.kids.length; i++) {
      var o = this.kids[i];
      if (o.clipDepth) continue;
      r = unionB(r, o.boundsIn(o.m));
    }
    if (this.gfx && this.gfx.bounds) r = unionB(r, this.gfx.bounds);
    return r;
  };
  CP.hitShape = function (x, y) {
    for (var i = this.kids.length - 1; i >= 0; i--) {
      var o = this.kids[i];
      if (!o.visible || o.clipDepth) continue;
      var p = apply(inv(o.m), x, y);
      if (o.hitShape(p[0], p[1])) return true;
    }
    if (this.gfx && $.hitGfx && $.hitGfx(this.gfx, x, y)) return true;
    return false;
  };

  // ---- timeline
  function frameOps(clip, f) { return clip.def && clip.def.frames[f - 1]; }
  // instantiate a library character
  function instantiate(id) {
    var c = LIB.chars[id];
    if (!c) return null;
    switch (c.k) {
      case 'sprite': return new MovieClip(c, id);
      case 'shape': case 'morph': return new Graphic(c, id);
      case 'button': return new Button(c, id);
      case 'edit': return new $.EditText(c, id);
    }
    return null;
  }
  $.instantiate = instantiate;
  function exportedName(id) {
    if (!$.exportNames) { $.exportNames = {}; for (var k in LIB.exports) if (!(LIB.exports[k] in $.exportNames)) $.exportNames[LIB.exports[k]] = k; }
    return $.exportNames[id];
  }
  function registeredCtor(clip) {
    var nm = exportedName(clip.charId);
    if (nm === undefined) return null;
    var f = $.registered[$.lower(nm)];
    return typeof f === 'function' ? f : null;
  }
  $.registered = Object.create(null);

  // apply PlaceObject properties (only while the object has not been moved by script)
  function applyPlace(obj, ext) {
    if (obj.scripted) return;
    if (ext.m) obj.setMatrix(ext.m);
    if (ext.cx !== undefined) obj.cx = ext.cx ? ext.cx.slice() : null;
    if (ext.ratio !== undefined) obj.ratio = ext.ratio;
  }
  // create a child placed by the timeline (PlaceObject)
  CP.placeChild = function (id, depth, ext, frame) {
    var obj = instantiate(id);
    if (!obj) return null;
    obj.placeFrame = frame;
    if (ext.m) obj.setMatrix(ext.m);
    if (ext.cx) obj.cx = ext.cx.slice();
    if (ext.ratio !== undefined) obj.ratio = ext.ratio;
    if (ext.name !== undefined) obj.name = ext.name;
    else if (obj.vars) obj.name = 'instance' + (++$.instanceCounter);
    if (ext.clip !== undefined) obj.clipDepth = ext.clip;
    if (ext.ev) obj.events = ext.ev;
    this.insert(obj, depth);
    obj.postInstantiate(false, null, false);
    if (obj.$isClip) obj.runFrameAVM1();
    return obj;
  };
  $.instanceCounter = 0;
  DP.postInstantiate = function () { };
  CP.postInstantiate = function (runFrame, init, byScript) {
    var ctor = registeredCtor(this);
    if (ctor) Object.setPrototypeOf(this.vars, protoFor(ctor));
    if (runFrame) this.runFrameAVM1();
    if (init && typeof init === 'object') {
      var keys = Object.keys(init);
      for (var i = keys.length - 1; i >= 0; i--) this.setMember(keys[i], init[keys[i]]);
    }
    if (ctor && byScript) { construct(this, ctor); return; }
    var evs = this.events, events = [];
    if (evs) for (var j = 0; j < evs.length; j++) {
      if (evs[j].e.indexOf('initialize') >= 0) queueScript(this, evs[j].s, PRI_INIT);
      if (evs[j].e.indexOf('construct') >= 0) events.push(evs[j].s);
    }
    var self = this;
    if (ctor || events.length) queueCall(this, function () {
      if (ctor) Object.setPrototypeOf(self.vars, protoFor(ctor));
      for (var k = 0; k < events.length; k++) runScript(self, events[k]);
      if (ctor) construct(self, ctor);
    }, PRI_CONSTRUCT);
  };
  function protoFor(F) { var p = $.gm(F, 'prototype'); return p && (typeof p === 'object' || typeof p === 'function') ? p : $.MovieClipProto; }
  function construct(clip, ctor) {
    var prev = $.cur; $.cur = clip;
    try { ctor.call(clip); } catch (e) { reportError('constructor of ' + safePath(clip), e); } finally { $.cur = prev; }
  }

  // one frame of the AVM1 lifecycle for this clip
  CP.runFrameAVM1 = function () {
    if (!this.initialized) { this.initialized = true; this.dispatch('load'); }
    else this.dispatch('enterFrame');
    if (this.playing) this.advance();
  };
  CP.advance = function () {
    if (this.frame < this.totalFrames) {
      this.frame++;
      this.runTags(this.frame, true);
    } else if (this.totalFrames > 1) {
      this.goto(1, true);
    } else {
      this.playing = false;
    }
  };
  // process the tags of frame f during normal playback
  CP.runTags = function (f, display, noSounds) {
    var ops = frameOps(this, f);
    if (!ops) return;
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      switch (op[0]) {
        case 'P': if (display) this.placeOp(op, f); break;
        case 'R': if (display) { var o = this.childAt(op[1]); if (o) this.removeChild(o); } break;
        case 'A': queueScript(this, op[1]); break;
        case 'I': if (!$.initDone[op[1]]) { $.initDone[op[1]] = 1; runScript(this, op[1]); } break;
        case 'S': if ($.startSound && !noSounds) $.startSound(op[1], op[2], this); break;
      }
    }
  };
  $.initDone = Object.create(null);
  CP.placeOp = function (op, f) {
    var depth = op[1], id = op[2], move = op[3], ext = op[4];
    var cur = this.childAt(depth);
    if (!move) { if (id) this.placeChild(id, depth, ext, f); return; }
    if (!cur) return;
    if (id && id !== cur.charId) { replaceWith(cur, id); cur.placeFrame = f; }
    applyPlace(cur, ext);
  };
  function replaceWith(obj, id) {
    // only graphics can swap their contents
    var c = LIB.chars[id];
    if (obj instanceof Graphic && c && (c.k === 'shape' || c.k === 'morph')) { obj.def = c; obj.charId = id; obj.$layers = null; }
  }

  // goto: rebuild the display list for the target frame (see Ruffle's run_goto)
  CP.goto = function (target, implicit) {
    target = Math.max(1, target | 0);
    if (target > this.totalFrames) target = this.totalFrames;
    var from = this.frame;
    if (target === from && !implicit) return;
    var rewind = target <= from;
    var cmds = [];        // goto commands: {depth, act: 'place'|'replace'|'modify', id, ext, frame, index}
    var byDepth = new Map();
    var index = 0;
    for (var f = rewind ? 1 : from + 1; f <= target; f++) {
      var ops = frameOps(this, f);
      if (!ops) continue;
      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        if (op[0] === 'P') {
          index++;
          var src = op[4], d = op[1];
          var act = op[3] ? (op[2] ? 'replace' : 'modify') : 'place';
          var ext = {};
          if (rewind && act === 'place') { ext.m = ID; ext.cx = 0; ext.ratio = 0; }
          mergeExt(ext, src);
          if (act !== 'modify') { ext.name = src.name; ext.clip = src.clip; ext.ev = src.ev; }
          var prev = byDepth.get(d);
          if (!prev) { var c = { depth: d, act: act, id: op[2], ext: ext, frame: f, index: index }; byDepth.set(d, c); cmds.push(c); continue; }
          if (act !== 'modify') {
            prev.act = act; prev.id = op[2]; prev.frame = f;
            if (act === 'place') { prev.ext.name = src.name; prev.ext.clip = src.clip; prev.ext.ev = src.ev; }
          }
          mergeExt(prev.ext, ext);
        } else if (op[0] === 'R') {
          var dd = op[1];
          if (byDepth.has(dd)) { var c0 = byDepth.get(dd); byDepth.delete(dd); cmds.splice(cmds.indexOf(c0), 1); }
          else if (!rewind) { var ch = this.childAt(dd); if (ch) this.removeChild(ch); }
        }
      }
    }
    if (rewind) {
      var kids = this.kids.slice();
      for (var k = 0; k < kids.length; k++) if (!survivesRewind(kids[k], byDepth.get(kids[k].depth))) this.removeChild(kids[k]);
    }
    cmds.sort(function (x, y) { return x.index - y.index; });
    var self = this;
    var run = function (c) {
      var cur = self.childAt(c.depth);
      if (cur && (rewind || c.act === 'modify')) applyPlace(cur, c.ext);
      else if (cur && c.act === 'replace') { replaceWith(cur, c.id); applyPlace(cur, c.ext); cur.placeFrame = c.frame; }
      else if (c.act !== 'modify' && c.id) self.placeChild(c.id, c.depth, c.ext, c.frame);
    };
    for (var a = 0; a < cmds.length; a++) if (cmds[a].frame < target) run(cmds[a]);
    var changed = target !== from;
    this.frame = target;
    this.runTags(target, false, !changed);
    for (var b = 0; b < cmds.length; b++) if (cmds[b].frame >= target) run(cmds[b]);
  };
  function mergeExt(dst, src) {
    if (src.m) dst.m = src.m;
    if (src.cx !== undefined) dst.cx = src.cx;
    if (src.ratio !== undefined) dst.ratio = src.ratio;
  }
  function survivesRewind(o, cmd) {
    if (o.depth >= DEPTH_OFFSET) return true;     // script depths are not touched by the timeline
    if (!cmd) return false;
    if (o.byScript) return false;
    var ratioEq = cmd.ext.ratio === undefined || o.ratio === cmd.ext.ratio;
    if (o.$isClip) return ratioEq;
    var idEq = cmd.act !== 'modify' && cmd.id === o.charId;
    var clipEq = cmd.ext.clip === undefined || o.clipDepth === cmd.ext.clip;
    if (o instanceof Graphic) {
      var mEq = !cmd.ext.m || sameArr(o.m, cmd.ext.m);
      var cEq = cmd.ext.cx === undefined || sameArr(o.cx || [1, 1, 1, 1, 0, 0, 0, 0], cmd.ext.cx || [1, 1, 1, 1, 0, 0, 0, 0]);
      return ratioEq && idEq && clipEq && mEq && cEq;
    }
    return ratioEq && idEq && clipEq;
  }
  function sameArr(a, b) { for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false; return true; }

  CP.gotoFrame = function (f, play) {
    this.playing = !!play;
    if (f !== this.frame) this.goto(f, false);
  };
  CP.frameNumber = function (f) {
    if (typeof f === 'number') return f === f ? Math.floor(f) : 0;
    var s = str(f);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return Math.floor(Number(s));
    return labelFrame(this, s);
  };

  // ================================================================ Button
  function Button(def, id) {
    DisplayObject.call(this);
    this.def = def; this.charId = id;
    this.state = 'up';
    this.kids = [];
    this.hitKids = null;
    this.vars = Object.create($.ButtonProto);
    this.initialized = false;
  }
  Button.prototype = Object.create(DP);
  Button.prototype.constructor = Button;
  $.Button = Button;
  var BP = Button.prototype;
  BP.postInstantiate = function () { this.setState('up'); };
  BP.setState = function (s) {
    var recs = this.def.states[s] || [];
    var old = this.kids, next = [];
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i], keep = null;
      for (var j = 0; j < old.length; j++) if (old[j] && old[j].depth === r.depth && old[j].charId === r.id) { keep = old[j]; old[j] = null; break; }
      if (!keep) {
        keep = instantiate(r.id);
        if (!keep) continue;
        keep.parent = this; keep.depth = r.depth;
        keep.setMatrix(r.m || ID);
        if (r.cx) keep.cx = r.cx.slice();
        keep.postInstantiate(false, null, false);
        if (keep.$isClip) keep.runFrameAVM1();
      } else { keep.setMatrix(r.m || ID); keep.cx = r.cx ? r.cx.slice() : null; }
      next.push(keep);
    }
    for (var k = 0; k < old.length; k++) if (old[k]) old[k].unload();
    next.sort(function (a, b) { return a.depth - b.depth; });
    this.kids = next;
    this.state = s;
  };
  BP.hitObjects = function () {
    if (!this.hitKids) {
      var recs = this.def.states.hit.length ? this.def.states.hit : this.def.states.up;
      this.hitKids = [];
      for (var i = 0; i < recs.length; i++) {
        var o = instantiate(recs[i].id);
        if (!o) continue;
        o.setMatrix(recs[i].m || ID); o.depth = recs[i].depth;
        if (o.$isClip) { o.parent = this; o.runFrameAVM1(); o.parent = null; o.removed = true; }
        this.hitKids.push(o);
      }
    }
    return this.hitKids;
  };
  BP.localBounds = function () {
    var r = null, l = this.kids;
    for (var i = 0; i < l.length; i++) r = unionB(r, l[i].boundsIn(l[i].m));
    return r;
  };
  BP.hitBounds = function () {
    var r = null, l = this.hitObjects();
    for (var i = 0; i < l.length; i++) r = unionB(r, l[i].boundsIn(l[i].m));
    return r;
  };
  BP.hitShape = function (x, y) {
    var l = this.hitObjects();
    for (var i = l.length - 1; i >= 0; i--) { var p = apply(inv(l[i].m), x, y); if (l[i].hitShape(p[0], p[1])) return true; }
    return false;
  };
  BP.unload = function (silent) { for (var i = 0; i < this.kids.length; i++) this.kids[i].unload(silent); DP.unload.call(this); };
  BP.enabled = function () { var e = this.getMember('enabled'); return e === undefined || $.bool(e); };
  // run button actions for a state transition (conditions: idleToOverUp, overUpToOverDown, ...)
  BP.fire = function (cond) {
    var acts = this.def.actions, ctx = this.parent;
    if (!ctx) return;
    for (var i = 0; i < acts.length; i++) if (acts[i].c.indexOf(cond) >= 0) queueScript(ctx, acts[i].s);
  };
  BP.fireKey = function (code) {
    var acts = this.def.actions, ctx = this.parent, hit = false;
    if (!ctx) return false;
    for (var i = 0; i < acts.length; i++) if (acts[i].key === code) { queueScript(ctx, acts[i].s); hit = true; }
    return hit;
  };

  // ================================================================ MovieClip / Button prototypes (AS-visible methods)
  function clipArg(c) { return isDO(c) && c.$isClip ? c : null; }
  function nextDepth(clip) {
    var max = DEPTH_OFFSET - 1;
    for (var i = 0; i < clip.kids.length; i++) if (clip.kids[i].depth > max) max = clip.kids[i].depth;
    return max + 1;
  }
  function attach(parent, obj, name, depth) {
    obj.name = name;
    obj.byScript = true;
    parent.insert(obj, depth);
  }
  var MC = {
    play: function () { if (isDO(this) && this.$isClip) this.playing = true; },
    stop: function () { if (isDO(this) && this.$isClip) this.playing = false; },
    gotoAndPlay: function (f) { if (isDO(this) && this.$isClip) $.gotoFrameArg(this, f, true); },
    gotoAndStop: function (f) { if (isDO(this) && this.$isClip) $.gotoFrameArg(this, f, false); },
    nextFrame: function () { if (isDO(this) && this.$isClip) { this.playing = false; if (this.frame < this.totalFrames) this.goto(this.frame + 1, false); } },
    prevFrame: function () { if (isDO(this) && this.$isClip) { this.playing = false; if (this.frame > 1) this.goto(this.frame - 1, false); } },
    attachMovie: function (id, name, depth, init) {
      if (!isDO(this) || !this.$isClip) return undefined;
      var cid = $.exportId(str(id));
      if (cid === undefined) return undefined;
      var c = LIB.chars[cid];
      if (!c || c.k !== 'sprite') return undefined;
      var obj = new MovieClip(c, cid);
      attach(this, obj, str(name), (num(depth) | 0) + DEPTH_OFFSET);
      obj.postInstantiate(true, init, true);
      return obj;
    },
    createEmptyMovieClip: function (name, depth) {
      if (!isDO(this) || !this.$isClip) return undefined;
      var obj = new MovieClip({ n: 1, frames: [[]], labels: {} }, 0);
      attach(this, obj, str(name), (num(depth) | 0) + DEPTH_OFFSET);
      obj.postInstantiate(true, null, true);
      return obj;
    },
    duplicateMovieClip: function (name, depth, init) {
      if (!isDO(this) || this.removed || !this.$isClip || !this.parent || !this.parent.$isClip) return undefined;
      var obj = new MovieClip(this.def, this.charId);
      obj.setMatrix(this.m); if (this.cx) obj.cx = this.cx.slice();
      obj.visible = this.visible; obj.events = this.events; obj.clipDepth = this.clipDepth;
      if (this.gfx) obj.gfx = { cmds: this.gfx.cmds.slice(), bounds: this.gfx.bounds && this.gfx.bounds.slice() };
      attach(this.parent, obj, str(name), (num(depth) | 0) + DEPTH_OFFSET);
      obj.postInstantiate(true, init, true);
      return obj;
    },
    removeMovieClip: function () {
      if (!isDO(this) || this.removed || !this.parent) return;
      if (this.depth < DEPTH_OFFSET || this.depth >= DEPTH_OFFSET + 1048576) return; // only script depths can be removed
      this.parent.removeChild(this);
    },
    swapDepths: function (t) {
      if (!isDO(this) || this.removed || !this.parent || !this.parent.$isClip) return;
      var p = this.parent, other = null, d;
      if (isDO(t)) { if (t.parent !== p || t === this || t.removed) return; other = t; d = t.depth; }
      else { var x = num(t); if (x !== x) return; d = (x | 0) + DEPTH_OFFSET; other = p.childAt(d); if (other === this) return; }
      var old = this.depth;
      p.detach(this); if (other) p.detach(other);
      this.depth = d; this.scripted = true;
      if (other) { other.depth = old; other.scripted = true; }
      reinsert(p, this); if (other) reinsert(p, other);
    },
    getDepth: function () { return isDO(this) ? this.depth - DEPTH_OFFSET : undefined; },
    getNextHighestDepth: function () { return isDO(this) && this.$isClip ? nextDepth(this) - DEPTH_OFFSET : undefined; },
    getInstanceAtDepth: function (d) { if (!isDO(this) || !this.$isClip) return undefined; var o = this.childAt((num(d) | 0) + DEPTH_OFFSET); return o && o.vars ? o : undefined; },
    hitTest: function (a, b, shape) {
      if (!isDO(this)) return false;
      if (arguments.length === 1 || isDO(a)) {
        var t = isDO(a) ? a : $.resolveTarget(this, a);
        if (!isDO(t)) return false;
        var b1 = $.worldBounds(this), b2 = $.worldBounds(t);
        if (!b1 || !b2) return false;
        return !(b1[2] < b2[0] || b2[2] < b1[0] || b1[3] < b2[1] || b2[3] < b1[1]);
      }
      var x = num(a), y = num(b);
      if ($.bool(shape)) {
        var p = apply(inv(this.worldMatrix()), x, y);
        return this.hitShape(p[0], p[1]);
      }
      var wb = $.worldBounds(this);
      return !!wb && x >= wb[0] && x <= wb[2] && y >= wb[1] && y <= wb[3];
    },
    getBounds: function (space) {
      if (!isDO(this)) return undefined;
      var b = this.localBounds();
      var o = $.newObject0();
      if (!b) { o.xMin = o.xMax = o.yMin = o.yMax = 6710886.35; return o; }
      var target = space === undefined ? this : (isDO(space) ? space : $.resolveTarget(this, space));
      var m = isDO(target) ? mul(inv(target.worldMatrix()), this.worldMatrix()) : this.worldMatrix();
      var r = boundsXf(m, b);
      o.xMin = r[0]; o.xMax = r[2]; o.yMin = r[1]; o.yMax = r[3];
      return o;
    },
    localToGlobal: function (pt) { if (!isDO(this) || !pt || typeof pt !== 'object') return; var r = apply(this.worldMatrix(), num($.gm(pt, 'x')), num($.gm(pt, 'y'))); $.sm(pt, 'x', r[0]); $.sm(pt, 'y', r[1]); },
    globalToLocal: function (pt) { if (!isDO(this) || !pt || typeof pt !== 'object') return; var r = apply(inv(this.worldMatrix()), num($.gm(pt, 'x')), num($.gm(pt, 'y'))); $.sm(pt, 'x', r[0]); $.sm(pt, 'y', r[1]); },
    startDrag: function (lock, l, t, r, b) { if (isDO(this)) $.beginDrag(this, $.bool(lock), arguments.length >= 5 ? [num(l), num(t), num(r), num(b)] : null); },
    stopDrag: function () { $.drag = null; },
    getBytesLoaded: function () { return 1239773; },
    getBytesTotal: function () { return 1239773; },
    loadMovie: function () { }, unloadMovie: function () { }, loadVariables: function () { },
    getURL: function (u, w) { $.getURL(str(u), str(w)); },
    getSWFVersion: function () { return LIB.version; },
    setMask: function () { },
    createTextField: function (name, depth, x, y, w, h) {
      if (!isDO(this) || !this.$isClip) return undefined;
      var def = { k: 'edit', b: [0, 0, num(w), num(h)], font: null, face: 'Times New Roman', size: 12, color: [0, 0, 0, 255], align: 0, wrap: false, multi: false,
        password: false, readonly: true, autoSize: false, selectable: true, border: false, html: false, outlines: false, ml: 0, mr: 0, indent: 0,
        leading: 0, maxLen: null, variable: null, text: '' };
      var t = new $.EditText(def, 0);
      t.setMatrix([1, 0, 0, 1, num(x), num(y)]);
      attach(this, t, str(name), (num(depth) | 0) + DEPTH_OFFSET);
      return t;
    },
    // drawing API
    clear: function () { if (isDO(this)) this.gfx = null; },
    lineStyle: function (w, c, a) { if (!isDO(this)) return; G(this).cmds.push(['ls', w === undefined ? NaN : num(w), num(c) | 0, a === undefined ? 100 : num(a)]); },
    beginFill: function (c, a) { if (!isDO(this)) return; G(this).cmds.push(['bf', c === undefined ? -1 : num(c) | 0, a === undefined ? 100 : num(a)]); },
    beginGradientFill: function (type, colors, alphas, ratios, matrix) { if (!isDO(this)) return; G(this).cmds.push(['bg', str(type), colors, alphas, ratios, matrix]); },
    endFill: function () { if (!isDO(this)) return; G(this).cmds.push(['ef']); },
    moveTo: function (x, y) { if (!isDO(this)) return; var g = G(this); x = num(x); y = num(y); g.cmds.push(['m', x, y]); g.pen = [x, y]; },
    lineTo: function (x, y) { if (!isDO(this)) return; var g = G(this); x = num(x); y = num(y); g.cmds.push(['l', x, y]); gb(g, g.pen[0], g.pen[1]); gb(g, x, y); g.pen = [x, y]; },
    curveTo: function (cx, cy, x, y) { if (!isDO(this)) return; var g = G(this); cx = num(cx); cy = num(cy); x = num(x); y = num(y); g.cmds.push(['q', cx, cy, x, y]); gb(g, g.pen[0], g.pen[1]); gb(g, cx, cy); gb(g, x, y); g.pen = [x, y]; },
  };
  function reinsert(p, o) { var l = p.kids, i = l.length; while (i > 0 && l[i - 1].depth > o.depth) i--; l.splice(i, 0, o); p.$names = null; }
  function G(c) { if (!c.gfx) c.gfx = { cmds: [], bounds: null, pen: [0, 0] }; return c.gfx; }
  function gb(g, x, y) { if (!g.bounds) g.bounds = [x, y, x, y]; else { if (x < g.bounds[0]) g.bounds[0] = x; if (y < g.bounds[1]) g.bounds[1] = y; if (x > g.bounds[2]) g.bounds[2] = x; if (y > g.bounds[3]) g.bounds[3] = y; } }
  $.MovieClipProto = Object.create($.ObjectProto);
  $.methods($.MovieClipProto, MC);
  $.hide($.MovieClipProto, 'enabled', true);
  $.hide($.MovieClipProto, 'useHandCursor', true);
  $.ButtonProto = Object.create($.ObjectProto);
  $.methods($.ButtonProto, { getDepth: MC.getDepth, swapDepths: MC.swapDepths, hitTest: MC.hitTest, getBounds: MC.getBounds,
    localToGlobal: MC.localToGlobal, globalToLocal: MC.globalToLocal });
  $.hide($.ButtonProto, 'enabled', true);
  $.hide($.ButtonProto, 'useHandCursor', true);

  $.worldBounds = function (o) { return boundsXf(o.worldMatrix(), o.localBounds()); };
  $.exportId = function (name) {
    if (hasOwn.call(LIB.exports, name)) return LIB.exports[name];
    var l = $.lower(name);
    for (var k in LIB.exports) if ($.lower(k) === l) return LIB.exports[k];
    return undefined;
  };

  // ================================================================ helpers for the transpiled code
  // resolve a target path ("mc", "/a/b", "../x", "_root.a", "_level0") relative to `base`
  $.resolveTarget = function (base, t) {
    if (isDO(t)) return t;
    if (t === undefined || t === null) return undefined;
    t = str(t);
    base = base || $.root;
    if (t === '') return base;
    var cur = base, i = 0;
    if (t.charAt(0) === '/') { cur = base.root(); i = 1; }
    var parts = t.slice(i).split(/\/|\.(?!\.)|:/);
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];
      if (p === '') continue;
      if (p === '..') { cur = cur.parent; if (!cur) return undefined; continue; }
      var l = $.lower(p);
      if (l === '_root') { cur = cur.root(); continue; }
      if (l === '_parent') { cur = cur.parent; if (!cur) return undefined; continue; }
      if (l === 'this') continue;
      if (l === '_level0') { cur = $.root; continue; }
      if (l === '_global') { cur = $.global; continue; }
      var next = isDO(cur) ? cur.getMemberRaw(p) : $.getRaw(cur, p);
      if (next === NF || next === undefined || next === null) return undefined;
      cur = next;
    }
    return cur;
  };
  function tgtOf(base, t) {
    if (isDO(t)) return t;
    var r = $.resolveTarget(base || $.root, t);
    return isDO(r) ? r : null;
  }
  $.play = function (t) { if (t && t.$isClip) t.playing = true; };
  $.stop = function (t) { if (t && t.$isClip) t.playing = false; };
  $.nextFrame = function (t) { if (t && t.$isClip) MC.nextFrame.call(t); };
  $.prevFrame = function (t) { if (t && t.$isClip) MC.prevFrame.call(t); };
  function labelFrame(clip, s) {
    var labels = clip.def && clip.def.labels;
    if (!labels) return 0;
    if (hasOwn.call(labels, s)) return labels[s];
    var l = $.lower(s);
    for (var k in labels) if ($.lower(k) === l) return labels[k];
    return 0;
  }
  // GotoFrame (number) / GotoLabel (label): stop the clip and jump; an unknown label does nothing
  $.gotoFrame = function (t, f, play) {
    if (!t || !t.$isClip) return;
    var n = typeof f === 'number' ? f : labelFrame(t, f);
    if (n > 0) t.gotoFrame(n, play);
  };
  // gotoAndPlay/gotoAndStop argument (as Flash): an integer is a frame number; anything else is converted
  // to a string, which may be "path:frame", then parsed as a number or looked up as a label.
  var NUMSTR = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  function gotoValue(t, f, play, bias) {
    if (!t || !t.$isClip) return;
    var clip = t, frame;
    if (typeof f === 'number' && f === Math.floor(f)) frame = f | 0;
    else {
      var s = str(f), i = Math.max(s.lastIndexOf(':'), s.lastIndexOf('.'));
      if (i >= 0 && !NUMSTR.test(s)) {
        var path = s.slice(0, i);
        clip = path === '' ? t : tgtOf(t, path);
        s = s.slice(i + 1);
        if (!clip || !clip.$isClip) return;
      }
      if (NUMSTR.test(s)) frame = Number(s) | 0;
      else { frame = labelFrame(clip, s); if (!frame) return; }
    }
    frame += bias || 0;
    if (frame > 0) clip.gotoFrame(frame, play);
  }
  $.gotoFrameArg = function (t, f, play) { gotoValue(t, f, play, 0); };
  $.gotoFrame2 = function (t, f, play, bias) { gotoValue(t, f, play, bias); };
  $.callFrame = function (t, f) {
    // call(frame): run the actions of a frame of the target without moving the playhead
    var tgt = t, fr = f;
    if (typeof f === 'string' && f.indexOf(':') >= 0) { var i = f.lastIndexOf(':'); tgt = tgtOf(t, f.slice(0, i)); fr = f.slice(i + 1); }
    if (!tgt || !tgt.$isClip) return;
    var n = tgt.frameNumber(fr);
    var ops = frameOps(tgt, n);
    if (ops) for (var k = 0; k < ops.length; k++) if (ops[k][0] === 'A') runScript(tgt, ops[k][1]);
  };
  $.getProp = function (base, t, p) {
    var o = t === '' ? (base || $.root) : tgtOf(base, t);
    return o ? o.getProp(p) : undefined;
  };
  var PROP_IDX = ['_x', '_y', '_xscale', '_yscale', '_currentframe', '_totalframes', '_alpha', '_visible', '_width', '_height', '_rotation',
    '_target', '_framesloaded', '_name', '_droptarget', '_url', '_highquality', '_focusrect', '_soundbuftime', '_quality', '_xmouse', '_ymouse'];
  $.getPropIndex = function (base, t, i) { var p = PROP_IDX[num(i) | 0]; return p ? $.getProp(base, t, p) : undefined; };
  $.setProp = function (base, t, p, v) {
    var o = t === '' ? (base || $.root) : tgtOf(base, t);
    if (o) o.setProp(p, v);
  };
  $.setPropIndex = function (base, t, i, v) { var p = PROP_IDX[num(i) | 0]; if (p) $.setProp(base, t, p, v); };
  $.cloneSprite = function (base, src, name, depth) { var s = tgtOf(base, src); if (s) MC.duplicateMovieClip.call(s, name, depth); };
  $.removeSprite = function (base, t) { var o = tgtOf(base, t); if (o) MC.removeMovieClip.call(o); };
  $.startDrag = function (base, t, lock, box) { var o = tgtOf(base, t); if (o) $.beginDrag(o, $.bool(lock), box ? box.map(num) : null); };
  $.stopDrag = function () { $.drag = null; };
  $.getURL = function (url, target) {
    url = str(url);
    if (/^fscommand:/i.test(url)) { if ($.fscommand) $.fscommand(url.slice(10), str(target)); return; }
    console.log('[getURL]', url, target);
    if ($.onGetURL) $.onGetURL(url, str(target));
  };
  $.getURL2 = function (url, target, flags) {
    url = str(url); target = str(target);
    if (flags & 0x40) { // loadTarget: loadMovie / loadVariables - nothing to load
      console.log('[load blocked]', url, target);
      return;
    }
    $.getURL(url, target);
  };
  $.fscommand2 = function () { };
  $.enumerate = function (s, o) {
    s.push(undefined);
    var keys = $.keysOf(o);
    for (var i = keys.length - 1; i >= 0; i--) s.push(keys[i]);
  };
  // keys in AVM1 enumeration order: prototype keys first, then own keys (most recent first)
  $.keysOf = function (o) {
    if (o === null || o === undefined || (typeof o !== 'object' && typeof o !== 'function')) return [];
    if (isDO(o)) return o.enumKeys();
    var keys = [], seen = Object.create(null), chain = [];
    var p = $.protoOf(o);
    while (p) { chain.push(p); p = Object.getPrototypeOf(p); }
    for (var i = chain.length - 1; i >= 0; i--) {
      var ks = Object.keys(chain[i]);
      for (var j = ks.length - 1; j >= 0; j--) if (!seen[ks[j]] && !hasOwn.call(o, ks[j])) { seen[ks[j]] = 1; keys.push(ks[j]); }
    }
    var own = Object.keys(o);
    for (var k = own.length - 1; k >= 0; k--) {
      var key = own[k];
      if (typeof o === 'function' && (key === 'prototype')) continue;
      keys.push(key);
    }
    return keys;
  };

  // ================================================================ frame loop
  $.tick = function () {
    $.removePending();
    if ($.runTimers) $.runTimers();
    runQueue();
    var prev = null;
    for (var c = execHead; c;) {
      var next = c.$next;
      if (c.removed) {
        if (prev) prev.$next = next; else execHead = next;
        c.$next = null;
      } else {
        c.runFrameAVM1();
        prev = c;
      }
      c = next;
    }
    runQueue();
    if ($.updateBindings) $.updateBindings();
    $.frameCount = ($.frameCount || 0) + 1;
  };
  $.createRoot = function () {
    var root = new MovieClip(LIB.main, 0);
    root.name = '';
    root.vars = Object.create($.MovieClipProto);
    $.root = root;
    // DoInitAction blocks of the main timeline run before any frame (Flash runs them at load)
    var ops = LIB.main.frames[0] || [];
    for (var i = 0; i < ops.length; i++) if (ops[i][0] === 'I' && !$.initDone[ops[i][1]]) { $.initDone[ops[i][1]] = 1; runScript(root, ops[i][1]); }
    return root;
  };

  // ================================================================ mouse
  $.mouse = { x: 0, y: 0, down: false };
  $.hover = null; $.pressed = null; $.drag = null;
  $.beginDrag = function (o, lock, box) {
    if (!o.parent) return;
    var p = apply(inv(o.parent.worldMatrix()), $.mouse.x, $.mouse.y);
    $.drag = { clip: o, lock: lock, dx: o.m[4] - p[0], dy: o.m[5] - p[1], box: box };
    updateDrag();
  };
  function updateDrag() {
    var d = $.drag;
    if (!d || !d.clip.parent || d.clip.removed) { $.drag = null; return; }
    var c = d.clip;
    var p = apply(inv(c.parent.worldMatrix()), $.mouse.x, $.mouse.y);
    var x = d.lock ? p[0] : p[0] + d.dx, y = d.lock ? p[1] : p[1] + d.dy;
    if (d.box) { var b = d.box; x = Math.max(Math.min(b[0], b[2]), Math.min(Math.max(b[0], b[2]), x)); y = Math.max(Math.min(b[1], b[3]), Math.min(Math.max(b[1], b[3]), y)); }
    c.m[4] = x; c.m[5] = y; c.scripted = true;
  }
  function isButtonMode(o) {
    if (!o.vars) return false;
    var e = o.getMember('enabled');
    if (e !== undefined && !$.bool(e)) return false;
    var ev = o.events;
    if (ev) for (var i = 0; i < ev.length; i++) { var es = ev[i].e; for (var j = 0; j < es.length; j++) if (BUTTON_EVENTS[es[j]]) return true; }
    for (var k = 0; k < BUTTON_METHODS.length; k++) if (typeof o.getMember(BUTTON_METHODS[k]) === 'function') return true;
    return false;
  }
  var BUTTON_EVENTS = { press: 1, release: 1, releaseOutside: 1, rollOver: 1, rollOut: 1, dragOver: 1, dragOut: 1 };
  var BUTTON_METHODS = ['onPress', 'onRelease', 'onReleaseOutside', 'onRollOver', 'onRollOut', 'onDragOver', 'onDragOut'];
  // topmost interactive object at stage point (x, y)
  function pick(clip, x, y, wm) {
    var kids = clip.kids;
    var maskedUntil = -1, maskOk = true;
    // determine masks: a mask at depth d with clipDepth c hides children with depth in (d, c] outside it
    for (var i = kids.length - 1; i >= 0; i--) {
      var o = kids[i];
      if (o.clipDepth || !o.visible) continue;
      var mask = maskFor(kids, i);
      if (mask && !pointInObj(mask, x, y, mul(wm, mask.m))) continue;
      var om = mul(wm, o.m);
      if (o instanceof Button) {
        if (o.enabled() && pointInObj(o, x, y, om)) return o;
      } else if (o.$isClip) {
        if (isButtonMode(o)) { if (pointInObj(o, x, y, om)) return o; }
        else { var r = pick(o, x, y, om); if (r) return r; }
      } else if (o instanceof $.EditText) {
        if (o.isInput() && pointInObj(o, x, y, om)) return o;
      }
    }
    return null;
  }
  function maskFor(kids, i) {
    var d = kids[i].depth;
    for (var j = i - 1; j >= 0; j--) if (kids[j].clipDepth && kids[j].depth < d && kids[j].clipDepth >= d) return kids[j];
    return null;
  }
  function pointInObj(o, x, y, m) {
    var p = apply(inv(m), x, y);
    if (o instanceof $.EditText) { var b = o.localBounds(); return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; }
    return o.hitShape(p[0], p[1]);
  }
  $.pick = function (x, y) { return $.root ? pick($.root, x, y, ID) : null; };

  function fireMouse(o, ev) {
    if (!o || o.removed) return;
    if (o instanceof Button) {
      var map = { rollOver: 'idleToOverUp', rollOut: 'overUpToIdle', press: 'overUpToOverDown', release: 'overDownToOverUp',
        dragOut: 'overDownToOutDown', dragOver: 'outDownToOverDown', releaseOutside: 'outDownToIdle' };
      o.fire(map[ev]);
      var st = { rollOver: 'over', rollOut: 'up', press: 'down', release: 'over', dragOut: 'over', dragOver: 'down', releaseOutside: 'up' }[ev];
      if (st && st !== o.state) o.setState(st);
    } else if (o.$isClip) {
      // clips in "button mode" jump to _up/_over/_down labels when they have them
      var lab = { rollOut: '_up', releaseOutside: '_up', rollOver: '_over', release: '_over', dragOut: '_over', press: '_down', dragOver: '_down' }[ev];
      if (lab && o.def && o.def.labels && o.def.labels[lab]) o.gotoFrame(o.def.labels[lab], false);
    }
    o.dispatch(ev);
  }
  function broadcast(ev, keyCode) {
    // all clips, children before their parent, topmost first
    var handled = false;
    (function walk(c) {
      var kids = c.kids.slice();
      for (var i = kids.length - 1; i >= 0; i--) {
        var k = kids[i];
        if (k.removed) continue;
        if (k.$isClip) walk(k);
        else if (k instanceof Button) { /* buttons do not get clip events */ }
      }
      if (c.dispatch(ev, keyCode)) handled = true;
    })($.root);
    return handled;
  }
  $.broadcast = broadcast;
  function notify(list, method, args) {
    var l = list.slice();
    for (var i = 0; i < l.length; i++) {
      (function (o) {
        queueCall($.root, function () { var f = $.gm(o, method); if (typeof f === 'function') f.apply(o, args || []); });
      })(l[i]);
    }
  }
  $.mouseListeners = []; $.keyListeners = [];
  $.cursor = function () { };
  function updateHover() {
    var over = $.pick($.mouse.x, $.mouse.y);
    if ($.pressed) {
      var p = $.pressed;
      if (over !== p && $.hover === p) { $.hover = null; fireMouse(p, 'dragOut'); }
      else if (over === p && $.hover !== p) { $.hover = p; fireMouse(p, 'dragOver'); }
    } else if (over !== $.hover) {
      var prev = $.hover;
      $.hover = over;
      if (prev) fireMouse(prev, 'rollOut');
      if (over) fireMouse(over, 'rollOver');
    }
    $.cursor(over && handCursor(over) ? 'pointer' : (over instanceof $.EditText ? 'text' : ''));
  }
  function handCursor(o) { var u = o.getMember('useHandCursor'); return u === undefined || $.bool(u); }
  $.mouseMove = function (x, y) {
    $.mouse.x = x; $.mouse.y = y;
    if ($.drag) updateDrag();
    broadcast('mouseMove');
    notify($.mouseListeners, 'onMouseMove');
    updateHover();
    runQueue();
  };
  $.mouseDown = function () {
    $.mouse.down = true;
    broadcast('mouseDown');
    notify($.mouseListeners, 'onMouseDown');
    var over = $.pick($.mouse.x, $.mouse.y);
    if (over !== $.hover) { var prev = $.hover; $.hover = over; if (prev) fireMouse(prev, 'rollOut'); if (over) fireMouse(over, 'rollOver'); }
    if (over) {
      $.pressed = over;
      if (over instanceof $.EditText) $.setFocus(over);
      else { fireMouse(over, 'press'); if ($.focus && !(over instanceof $.EditText)) $.setFocus(null); }
    } else if ($.focus) $.setFocus(null);
    runQueue();
  };
  $.mouseUp = function () {
    $.mouse.down = false;
    broadcast('mouseUp');
    notify($.mouseListeners, 'onMouseUp');
    var p = $.pressed;
    $.pressed = null;
    if (p && !p.removed && !(p instanceof $.EditText)) {
      var over = $.pick($.mouse.x, $.mouse.y);
      if (over === p) fireMouse(p, 'release');
      else { fireMouse(p, 'releaseOutside'); $.hover = null; }
    }
    updateHover();
    runQueue();
  };
  // keyboard: clip events, Key listeners, then button keyPress
  $.keyEvent = function (down, code, buttonKey) {
    broadcast(down ? 'keyDown' : 'keyUp');
    notify($.keyListeners, down ? 'onKeyDown' : 'onKeyUp');
    if (down && buttonKey) {
      (function walk(c) {
        for (var i = c.kids.length - 1; i >= 0; i--) {
          var k = c.kids[i];
          if (!k.visible) continue;
          if (k instanceof Button) { if (k.enabled()) k.fireKey(buttonKey); }
          else if (k.$isClip) walk(k);
        }
      })($.root);
      broadcast('keyPress', buttonKey);
    }
    runQueue();
  };
  $.focus = null;
  $.setFocus = function (o) {
    if ($.focus === o) return;
    var old = $.focus;
    $.focus = o;
    if (old && old.onBlur) old.onBlur();
    if (o && o.onFocus) o.onFocus();
  };
})();
