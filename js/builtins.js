// ActionScript built-in classes and global functions (the subset Flash Player 6 offers).
'use strict';
(function () {
  var G = $.global, str = $.str, num = $.n, gm = $.gm, sm = $.sm, hide = $.hide, methods = $.methods, isDO = $.isDO;
  var OP = $.ObjectProto, AP = $.ArrayProto, SP = $.StringProto, NP = $.NumberProto, BP = $.BooleanProto, FP = $.FunctionProto;
  var LIB = window.LIB;
  function newObj() { return Object.create(OP); }
  // make an AS-callable native "class": F(...) when called, F.$construct(args) for `new`
  function native(fn, proto, construct) {
    fn.prototype = proto;
    if (construct) fn.$construct = construct;
    hide(proto, 'constructor', fn);
    return fn;
  }
  function g(name, v) { hide(G, name, v); }

  // ---------------------------------------------------------------- Object
  methods(OP, {
    toString: function () { return isDO(this) ? this.path() : '[object Object]'; },
    toLocaleString: function () { return '[object Object]'; },
    valueOf: function () { return this; },
    hasOwnProperty: function (k) {
      if (this === undefined || this === null) return false;
      k = str(k);
      if (isDO(this)) return this.ownVar(k) !== null;
      if (typeof this !== 'object' && typeof this !== 'function') return false;
      return $.findOwnKey(this, k) !== null;
    },
    isPropertyEnumerable: function (k) {
      if (!this || (typeof this !== 'object' && typeof this !== 'function')) return false;
      var o = isDO(this) ? this.vars : this, key = $.findOwnKey(o, str(k));
      return key !== null && Object.prototype.propertyIsEnumerable.call(o, key);
    },
    isPrototypeOf: function (o) {
      if (o === null || o === undefined) return false;
      for (var p = $.protoOf(o); p; p = Object.getPrototypeOf(p)) if (p === this) return true;
      return false;
    },
    addProperty: function (name, getter, setter) {
      name = str(name);
      if (!name || typeof getter !== 'function') return false;
      var self = this, target = isDO(this) ? this.vars : this;
      if (!target || (typeof target !== 'object' && typeof target !== 'function')) return false;
      $.register(name);
      Object.defineProperty(target, name, {
        configurable: true, enumerable: true,
        get: function () { return getter.call(target === self.vars ? self : this); },
        set: function (v) { if (typeof setter === 'function') setter.call(target === self.vars ? self : this, v); },
      });
      return true;
    },
    watch: function (name, cb, data) {
      if (typeof cb !== 'function' || !this || typeof this !== 'object') return false;
      var o = this;
      if (!o.$watch) hide(o, '$watch', Object.create(null));
      o.$watch[$.lower(str(name))] = function (k, oldV, newV) { return cb.call(o, k, oldV, newV, data); };
      return true;
    },
    unwatch: function (name) { if (this && this.$watch) { delete this.$watch[$.lower(str(name))]; return true; } return false; },
  });
  var ObjectF = native(function (v) { return v === undefined || v === null ? newObj() : box(v); }, OP, function (a) { return a.length && a[0] !== null && a[0] !== undefined ? box(a[0]) : newObj(); });
  hide(ObjectF, 'registerClass', function (name, ctor) {
    name = str(name);
    if (typeof ctor === 'function') $.registered[$.lower(name)] = ctor; else delete $.registered[$.lower(name)];
    return true;
  });
  g('Object', ObjectF);
  function box(v) {
    if (typeof v === 'string') { var s = Object.create(SP); hide(s, '$boxed', v); hide(s, 'length', v.length); return s; }
    if (typeof v === 'number') { var n = Object.create(NP); hide(n, '$boxed', v); return n; }
    if (typeof v === 'boolean') { var b = Object.create(BP); hide(b, '$boxed', v); return b; }
    return v;
  }
  function unbox(v) { return v !== null && typeof v === 'object' && v.$boxed !== undefined ? v.$boxed : v; }

  // ---------------------------------------------------------------- Function
  methods(FP, {
    call: function (self) { if (typeof this !== 'function') return undefined; return this.apply(self === null ? undefined : self, Array.prototype.slice.call(arguments, 1)); },
    apply: function (self, args) {
      if (typeof this !== 'function') return undefined;
      var list = [];
      if (Array.isArray(args)) list = args.slice();
      else if (args && typeof args === 'object') { var l = num(gm(args, 'length')) | 0; for (var i = 0; i < l; i++) list.push(gm(args, i)); }
      return this.apply(self === null ? undefined : self, list);
    },
    toString: function () { return '[type Function]'; },
  });
  g('Function', native(function () { return function () { }; }, FP));

  // ---------------------------------------------------------------- Array
  function toArr(o) { return Array.isArray(o) ? o : null; }
  function sortCompare(flags) {
    var ci = flags & 1, desc = flags & 2, numeric = flags & 16;
    return function (a, b) {
      var r;
      if (numeric) { var x = num(a), y = num(b); r = x < y ? -1 : x > y ? 1 : 0; }
      else { var s = str(a), t = str(b); if (ci) { s = s.toLowerCase(); t = t.toLowerCase(); } r = s < t ? -1 : s > t ? 1 : 0; }
      return desc ? -r : r;
    };
  }
  function doSort(a, cmp, flags) {
    var idx = a.map(function (v, i) { return i; });
    idx.sort(function (i, j) { var r = cmp(a[i], a[j]); return r || i - j; });
    if (flags & 4) for (var k = 1; k < idx.length; k++) if (cmp(a[idx[k - 1]], a[idx[k]]) === 0) return 0;
    if (flags & 8) return idx;
    var copy = idx.map(function (i) { return a[i]; });
    for (var m = 0; m < copy.length; m++) a[m] = copy[m];
    return a;
  }
  methods(AP, {
    push: function () { var a = toArr(this); if (!a) return undefined; for (var i = 0; i < arguments.length; i++) a.push(arguments[i]); return a.length; },
    pop: function () { var a = toArr(this); return a ? a.pop() : undefined; },
    shift: function () { var a = toArr(this); return a ? a.shift() : undefined; },
    unshift: function () { var a = toArr(this); if (!a) return undefined; a.unshift.apply(a, arguments); return a.length; },
    splice: function (start, count) {
      var a = toArr(this); if (!a) return undefined;
      var len = a.length, s = num(start) | 0; if (s < 0) s = Math.max(0, len + s); if (s > len) s = len;
      var c = arguments.length < 2 ? len - s : Math.max(0, Math.min(len - s, num(count) | 0));
      var args = [s, c].concat(Array.prototype.slice.call(arguments, 2));
      return a.splice.apply(a, args);
    },
    slice: function (s, e) {
      var a = toArr(this); if (!a) return undefined;
      var len = a.length, b = s === undefined ? 0 : num(s) | 0, f = e === undefined ? len : num(e) | 0;
      return a.slice(b, f);
    },
    join: function (sep) {
      var a = toArr(this); if (!a) return undefined;
      sep = sep === undefined ? ',' : str(sep);
      var out = [];
      for (var i = 0; i < a.length; i++) out.push(a[i] === null ? 'null' : str(a[i]));
      return out.join(sep);
    },
    toString: function () { return AP.join.call(this, ','); },
    reverse: function () { var a = toArr(this); if (a) a.reverse(); return a; },
    concat: function () {
      var a = toArr(this); if (!a) return undefined;
      var r = a.slice();
      for (var i = 0; i < arguments.length; i++) { var x = arguments[i]; if (Array.isArray(x)) for (var j = 0; j < x.length; j++) r.push(x[j]); else r.push(x); }
      return r;
    },
    sort: function (f, flags) {
      var a = toArr(this); if (!a) return undefined;
      if (typeof f === 'function') { var fl = num(flags) | 0; var cmp = function (x, y) { var r = num(f(x, y)); return fl & 2 ? -r : r; }; return doSort(a, cmp, fl); }
      var fl2 = f === undefined ? 0 : num(f) | 0;
      return doSort(a, sortCompare(fl2), fl2);
    },
    sortOn: function (field, flags) {
      var a = toArr(this); if (!a) return undefined;
      var fields = Array.isArray(field) ? field.map(str) : [str(field)];
      var fl = num(flags) | 0, base = sortCompare(fl & ~2);
      var cmp = function (x, y) { for (var i = 0; i < fields.length; i++) { var r = base(gm(x, fields[i]), gm(y, fields[i])); if (r) return fl & 2 ? -r : r; } return 0; };
      return doSort(a, cmp, fl);
    },
  });
  var ArrayF = native(function () { return ArrayF.$construct(Array.prototype.slice.call(arguments)); }, AP, function (a) {
    if (a.length === 1 && typeof a[0] === 'number') { var r = []; r.length = Math.max(0, a[0] | 0); return r; }
    return a.slice();
  });
  hide(ArrayF, 'CASEINSENSITIVE', 1); hide(ArrayF, 'DESCENDING', 2); hide(ArrayF, 'UNIQUESORT', 4); hide(ArrayF, 'RETURNINDEXEDARRAY', 8); hide(ArrayF, 'NUMERIC', 16);
  g('Array', ArrayF);

  // ---------------------------------------------------------------- String
  function S(o) { return str(unbox(o)); }
  function intArg(v, d) { if (v === undefined) return d; var x = num(v); return x !== x ? 0 : Math.trunc(x); }
  methods(SP, {
    toString: function () { return S(this); },
    valueOf: function () { return S(this); },
    charAt: function (i) { return S(this).charAt(intArg(i, 0)); },
    charCodeAt: function (i) { var s = S(this), k = intArg(i, 0); return k >= 0 && k < s.length ? s.charCodeAt(k) : NaN; },
    concat: function () { var s = S(this); for (var i = 0; i < arguments.length; i++) s += str(arguments[i]); return s; },
    indexOf: function (t, from) { return S(this).indexOf(str(t), intArg(from, 0)); },
    lastIndexOf: function (t, from) { var s = S(this); return from === undefined ? s.lastIndexOf(str(t)) : s.lastIndexOf(str(t), intArg(from, 0)); },
    slice: function (a, b) { var s = S(this); return s.slice(intArg(a, 0), b === undefined ? s.length : intArg(b, 0)); },
    substring: function (a, b) { var s = S(this); var x = intArg(a, 0), y = b === undefined ? s.length : intArg(b, 0); return s.substring(Math.max(0, x), Math.max(0, y)); },
    substr: function (a, l) { var s = S(this); var x = intArg(a, 0); if (x < 0) x = Math.max(0, s.length + x); return l === undefined ? s.substr(x) : s.substr(x, Math.max(0, intArg(l, 0))); },
    split: function (sep, limit) {
      var s = S(this);
      if (sep === undefined) return [s];
      var r = s.split(str(sep));
      if (limit !== undefined) r = r.slice(0, Math.max(0, num(limit) | 0));
      return r;
    },
    toLowerCase: function () { return S(this).toLowerCase(); },
    toUpperCase: function () { return S(this).toUpperCase(); },
  });
  var StringF = native(function (v) { return arguments.length ? str(v) : ''; }, SP, function (a) { return box(a.length ? str(a[0]) : ''); });
  hide(StringF, 'fromCharCode', function () { var s = ''; for (var i = 0; i < arguments.length; i++) s += String.fromCharCode(num(arguments[i]) & 0xffff); return s; });
  g('String', StringF);

  // ---------------------------------------------------------------- Number / Boolean
  methods(NP, {
    toString: function (radix) { var v = num(unbox(this)); if (radix === undefined || num(radix) === 10) return str(v); var r = num(radix) | 0; return r >= 2 && r <= 36 ? (v | 0).toString(r) : str(v); },
    valueOf: function () { return num(unbox(this)); },
  });
  var NumberF = native(function (v) { return arguments.length ? num(v) : 0; }, NP, function (a) { return box(a.length ? num(a[0]) : 0); });
  hide(NumberF, 'MAX_VALUE', Number.MAX_VALUE); hide(NumberF, 'MIN_VALUE', Number.MIN_VALUE); hide(NumberF, 'NaN', NaN);
  hide(NumberF, 'POSITIVE_INFINITY', Infinity); hide(NumberF, 'NEGATIVE_INFINITY', -Infinity);
  g('Number', NumberF);
  methods(BP, { toString: function () { return unbox(this) ? 'true' : 'false'; }, valueOf: function () { return !!unbox(this); } });
  g('Boolean', native(function (v) { return $.bool(v); }, BP, function (a) { return box($.bool(a[0])); }));

  // ---------------------------------------------------------------- Math
  var M = newObj();
  ['abs', 'acos', 'asin', 'atan', 'ceil', 'cos', 'exp', 'floor', 'log', 'sin', 'sqrt', 'tan'].forEach(function (k) { hide(M, k, function (x) { return Math[k](num(x)); }); });
  hide(M, 'round', function (x) { return Math.floor(num(x) + 0.5); });
  hide(M, 'atan2', function (y, x) { return Math.atan2(num(y), num(x)); });
  hide(M, 'pow', function (x, y) { return Math.pow(num(x), num(y)); });
  hide(M, 'max', function () { var r = -Infinity; for (var i = 0; i < arguments.length; i++) { var v = num(arguments[i]); if (v !== v) return NaN; if (v > r) r = v; } return arguments.length ? r : -Infinity; });
  hide(M, 'min', function () { var r = Infinity; for (var i = 0; i < arguments.length; i++) { var v = num(arguments[i]); if (v !== v) return NaN; if (v < r) r = v; } return arguments.length ? r : Infinity; });
  hide(M, 'random', function () { return Math.random(); });
  ['E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2'].forEach(function (k) { hide(M, k, Math[k]); });
  g('Math', M);

  // ---------------------------------------------------------------- Date
  var DateProto = Object.create(OP);
  function ASDate(d) { this.$d = d; }
  ASDate.prototype = DateProto;
  $.ASDate = ASDate;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateOf(o) { return o instanceof ASDate ? o.$d : new Date(NaN); }
  var dm = {};
  ['getDate', 'getDay', 'getFullYear', 'getHours', 'getMilliseconds', 'getMinutes', 'getMonth', 'getSeconds', 'getTime', 'getTimezoneOffset',
    'getUTCDate', 'getUTCDay', 'getUTCFullYear', 'getUTCHours', 'getUTCMilliseconds', 'getUTCMinutes', 'getUTCMonth', 'getUTCSeconds'].forEach(function (k) {
    dm[k] = function () { return dateOf(this)[k](); };
  });
  dm.getYear = function () { return dateOf(this).getFullYear() - 1900; };
  ['setDate', 'setFullYear', 'setHours', 'setMilliseconds', 'setMinutes', 'setMonth', 'setSeconds', 'setTime', 'setUTCDate', 'setUTCFullYear',
    'setUTCHours', 'setUTCMilliseconds', 'setUTCMinutes', 'setUTCMonth', 'setUTCSeconds'].forEach(function (k) {
    dm[k] = function () { var d = dateOf(this); return d[k].apply(d, Array.prototype.map.call(arguments, num)); };
  });
  dm.valueOf = function () { return dateOf(this).getTime(); };
  dm.toString = function () {
    var d = dateOf(this); if (isNaN(d.getTime())) return 'Invalid Date';
    var off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-'; off = Math.abs(off);
    var p2 = function (x) { return (x < 10 ? '0' : '') + x; };
    return DAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) +
      ' GMT' + sign + p2(Math.floor(off / 60)) + p2(off % 60) + ' ' + d.getFullYear();
  };
  methods(DateProto, dm);
  var DateF = native(function () { return dm.toString.call(new ASDate(new Date())); }, DateProto, function (a) {
    if (!a.length) return new ASDate(new Date());
    if (a.length === 1) return new ASDate(new Date(num(a[0])));
    var x = a.map(num);
    return new ASDate(new Date(x[0], x[1], x.length > 2 ? x[2] : 1, x[3] || 0, x[4] || 0, x[5] || 0, x[6] || 0));
  });
  hide(DateF, 'UTC', function () { var x = Array.prototype.map.call(arguments, num); return Date.UTC.apply(Date, x); });
  g('Date', DateF);

  // ---------------------------------------------------------------- display classes
  g('MovieClip', native(function () { }, $.MovieClipProto));
  g('Button', native(function () { }, $.ButtonProto));
  g('TextField', native(function () { }, $.TextFieldProto));
  var TFProto = Object.create(OP);
  g('TextFormat', native(function TextFormat(font, size, color, bold, italic, underline, url, target, align, leftMargin, rightMargin, indent, leading) {
    var o = this && this !== G && typeof this === 'object' ? this : Object.create(TFProto);
    var names = ['font', 'size', 'color', 'bold', 'italic', 'underline', 'url', 'target', 'align', 'leftMargin', 'rightMargin', 'indent', 'leading'];
    for (var i = 0; i < names.length; i++) o[names[i]] = arguments[i] === undefined ? null : arguments[i];
    o.blockIndent = null; o.bullet = null; o.tabStops = null;
    return o;
  }, TFProto));
  ['font', 'size', 'color', 'bold', 'italic', 'underline', 'url', 'target', 'align', 'leftMargin', 'rightMargin', 'indent', 'leading', 'blockIndent', 'bullet', 'tabStops'].forEach($.register);

  // ---------------------------------------------------------------- Color
  var ColorProto = Object.create(OP);
  function colorTarget(o) { var t = o.$target; return isDO(t) ? t : $.resolveTarget($.cur || $.root, t); }
  methods(ColorProto, {
    setRGB: function (c) {
      var t = colorTarget(this); if (!isDO(t)) return;
      c = num(c) | 0;
      var a = t.cx ? t.cx : [1, 1, 1, 1, 0, 0, 0, 0];
      t.cx = [0, 0, 0, a[3], (c >> 16) & 255, (c >> 8) & 255, c & 255, a[7]];
    },
    getRGB: function () { var t = colorTarget(this); if (!isDO(t) || !t.cx) return 0; return (t.cx[4] << 16) | (t.cx[5] << 8) | t.cx[6]; },
    setTransform: function (o) {
      var t = colorTarget(this); if (!isDO(t) || !o) return;
      var c = t.cx ? t.cx.slice() : [1, 1, 1, 1, 0, 0, 0, 0];
      var v;
      if ((v = gm(o, 'ra')) !== undefined) c[0] = num(v) / 100; if ((v = gm(o, 'ga')) !== undefined) c[1] = num(v) / 100;
      if ((v = gm(o, 'ba')) !== undefined) c[2] = num(v) / 100; if ((v = gm(o, 'aa')) !== undefined) c[3] = num(v) / 100;
      if ((v = gm(o, 'rb')) !== undefined) c[4] = num(v); if ((v = gm(o, 'gb')) !== undefined) c[5] = num(v);
      if ((v = gm(o, 'bb')) !== undefined) c[6] = num(v); if ((v = gm(o, 'ab')) !== undefined) c[7] = num(v);
      t.cx = c;
    },
    getTransform: function () {
      var t = colorTarget(this), c = isDO(t) && t.cx ? t.cx : [1, 1, 1, 1, 0, 0, 0, 0], o = newObj();
      o.ra = c[0] * 100; o.ga = c[1] * 100; o.ba = c[2] * 100; o.aa = c[3] * 100; o.rb = c[4]; o.gb = c[5]; o.bb = c[6]; o.ab = c[7];
      return o;
    },
  });
  g('Color', native(function () { }, ColorProto, function (a) { var o = Object.create(ColorProto); hide(o, '$target', a[0]); return o; }));

  // ---------------------------------------------------------------- Key / Mouse / Stage / Selection / System
  var keysDown = {}, lastCode = 0, lastAscii = 0;
  var Key = newObj();
  var KEYS = { BACKSPACE: 8, CAPSLOCK: 20, CONTROL: 17, DELETEKEY: 46, DOWN: 40, END: 35, ENTER: 13, ESCAPE: 27, HOME: 36, INSERT: 45, LEFT: 37,
    PGDN: 34, PGUP: 33, RIGHT: 39, SHIFT: 16, SPACE: 32, TAB: 9, UP: 38, ALT: 18 };
  for (var kk in KEYS) hide(Key, kk, KEYS[kk]);
  methods(Key, {
    isDown: function (c) { return !!keysDown[num(c) | 0]; },
    isToggled: function () { return false; },
    getCode: function () { return lastCode; },
    getAscii: function () { return lastAscii; },
    addListener: function (o) { if ($.keyListeners.indexOf(o) < 0) $.keyListeners.push(o); return true; },
    removeListener: function (o) { var i = $.keyListeners.indexOf(o); if (i >= 0) { $.keyListeners.splice(i, 1); return true; } return false; },
  });
  g('Key', Key);
  $.setKey = function (code, ascii, down) { keysDown[code] = down; lastCode = code; if (down) lastAscii = ascii; };
  $.clearKeys = function () { keysDown = {}; };
  var mouseHidden = false;
  var Mouse = newObj();
  methods(Mouse, {
    show: function () { mouseHidden = false; if ($.onMouseVisibility) $.onMouseVisibility(true); return 1; },
    hide: function () { mouseHidden = true; if ($.onMouseVisibility) $.onMouseVisibility(false); return 0; },
    addListener: function (o) { if ($.mouseListeners.indexOf(o) < 0) $.mouseListeners.push(o); return true; },
    removeListener: function (o) { var i = $.mouseListeners.indexOf(o); if (i >= 0) { $.mouseListeners.splice(i, 1); return true; } return false; },
  });
  g('Mouse', Mouse);
  var Stage = newObj();
  Stage.width = LIB.w; Stage.height = LIB.h; Stage.scaleMode = 'showAll'; Stage.align = ''; Stage.showMenu = false;
  methods(Stage, { addListener: function () { return true; }, removeListener: function () { return true; } });
  g('Stage', Stage);
  var Selection = newObj();
  methods(Selection, {
    getFocus: function () { return $.focus ? $.focus.path() : null; },
    setFocus: function (t) { var o = isDO(t) ? t : (t === null || t === undefined ? null : $.resolveTarget($.cur || $.root, t)); $.setFocus(o instanceof $.EditText ? o : null); return true; },
    getBeginIndex: function () { return $.focus ? $.focus.caret : -1; },
    getEndIndex: function () { return $.focus ? $.focus.caret : -1; },
    getCaretIndex: function () { return $.focus ? $.focus.caret : -1; },
    setSelection: function (a, b) { if ($.focus) $.focus.caret = num(b) | 0; },
    addListener: function () { return true; }, removeListener: function () { return true; },
  });
  g('Selection', Selection);
  var caps = newObj();
  Object.assign(caps, { language: 'en', os: 'HTML5', manufacturer: 'Adobe Windows', playerType: 'PlugIn', version: 'WIN 9,0,0,0',
    screenResolutionX: screen.width, screenResolutionY: screen.height, hasAudio: true, hasMP3: true, isDebugger: false });
  var sec = newObj(); methods(sec, { allowDomain: function () { }, allowInsecureDomain: function () { }, loadPolicyFile: function () { } });
  var sys = newObj(); sys.capabilities = caps; sys.security = sec; sys.useCodepage = false; methods(sys, { showSettings: function () { }, setClipboard: function () { } });
  g('System', sys);

  // ---------------------------------------------------------------- globals
  g('NaN', NaN); g('Infinity', Infinity); g('newline', '\n');
  g('parseInt', function (s, radix) {
    s = str(s).replace(/^\s+/, '');
    var r = radix === undefined ? 0 : num(radix) | 0;
    if (!r) { if (/^[+-]?0x/i.test(s)) r = 16; else if (/^[+-]?0[0-7]/.test(s)) r = 8; else r = 10; }
    var v = parseInt(s, r);
    return v;
  });
  g('parseFloat', function (s) { return parseFloat(str(s)); });
  g('isNaN', function (v) { var x = num(v); return x !== x; });
  g('isFinite', function (v) { return isFinite(num(v)); });
  g('escape', function (s) { return encodeURIComponent(str(s)).replace(/[!'()*~]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }); });
  g('unescape', function (s) { try { return decodeURIComponent(str(s)); } catch (e) { return unescape(str(s)); } });
  g('trace', function (v) { $.trace(v); });
  g('updateAfterEvent', function () { });
  g('getVersion', function () { return 'WIN 9,0,0,0'; });
  g('fscommand', function (c, a) { if ($.fscommand) $.fscommand(str(c), str(a)); });
  g('ASSetPropFlags', function (o, props, set, clear) {
    if (!o || (typeof o !== 'object' && typeof o !== 'function')) return;
    var target = isDO(o) ? o.vars : o;
    var names = props === null || props === undefined ? Object.getOwnPropertyNames(target) : (Array.isArray(props) ? props.map(str) : str(props).split(','));
    set = num(set) | 0; clear = num(clear) | 0;
    names.forEach(function (n) {
      var k = $.findOwnKey(target, n); if (k === null) return;
      var d = Object.getOwnPropertyDescriptor(target, k); if (!d || !d.configurable) return;
      if (set & 1) d.enumerable = false; if (clear & 1) d.enumerable = true;
      if (set & 2) { if (!target.$permanent) hide(target, '$permanent', Object.create(null)); target.$permanent[$.lower(k)] = 1; }
      if ('value' in d) { if (set & 4) d.writable = false; if (clear & 4) d.writable = true; }
      Object.defineProperty(target, k, d);
    });
  });
  $.fscommand = function () { };

  // intervals and timeouts run on the frame clock
  $.vtime = 0;
  var timers = [], nextId = 1;
  function addTimer(fn, ms, args, once) { var t = { id: nextId++, fn: fn, ms: Math.max(10, ms || 0), args: args, next: $.vtime + Math.max(10, ms || 0), once: once }; timers.push(t); return t.id; }
  g('setInterval', function (a, b, c) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof a === 'function') return addTimer(a, num(b), args.slice(2), false);
    var obj = a, name = str(b);
    return addTimer(function () { var f = gm(obj, name); if (typeof f === 'function') f.apply(obj, arguments); }, num(c), args.slice(3), false);
  });
  g('clearInterval', function (id) { id = num(id); for (var i = 0; i < timers.length; i++) if (timers[i].id === id) timers[i].dead = true; });
  g('setTimeout', function (fn, ms) { return typeof fn === 'function' ? addTimer(fn, num(ms), Array.prototype.slice.call(arguments, 2), true) : undefined; });
  g('clearTimeout', function (id) { G.clearInterval(id); });
  $.runTimers = function () {
    $.vtime += 1000 / LIB.fps;
    var list = timers.slice();
    for (var i = 0; i < list.length; i++) {
      var t = list[i], n = 0;
      while (!t.dead && t.next <= $.vtime && n++ < 4) {
        t.next += t.ms;
        if (t.once) t.dead = true;
        try { t.fn.apply(undefined, t.args); } catch (e) { $.reportError('interval', e); }
        $.runQueue();
      }
      if (t.next <= $.vtime) t.next = $.vtime + t.ms;
    }
    timers = timers.filter(function (t) { return !t.dead; });
  };
  $.getTimer = function () { return Math.floor(performance.now() - $.startTime); };
  $.startTime = performance.now();

  // ---------------------------------------------------------------- SharedObject (saved in localStorage)
  var SOProto = Object.create(OP), shared = {}, PREFIX = 'sinjid-port:so:';
  function toAS(v) {
    if (Array.isArray(v)) return v.map(toAS);
    if (v && typeof v === 'object') { var o = newObj(); var ks = Object.keys(v); for (var i = 0; i < ks.length; i++) { $.register(ks[i]); o[ks[i]] = toAS(v[ks[i]]); } return o; }
    return v;
  }
  function toJSON(v, depth) {
    if (depth > 64) return null;
    if (Array.isArray(v)) return v.map(function (x) { return toJSON(x, depth + 1); });
    if (v === undefined) return { $u: 1 };
    if (v && typeof v === 'object') {
      if (isDO(v)) return undefined;
      var o = {}; var ks = Object.keys(v);
      for (var i = 0; i < ks.length; i++) { var x = toJSON(v[ks[i]], depth + 1); if (x !== undefined) o[ks[i]] = x; }
      return o;
    }
    if (typeof v === 'function') return undefined;
    if (typeof v === 'number' && !isFinite(v)) return { $n: String(v) };
    return v;
  }
  function fromJSON(v) {
    if (Array.isArray(v)) return v.map(fromJSON);
    if (v && typeof v === 'object') {
      if (v.$u === 1 && Object.keys(v).length === 1) return undefined;
      if (typeof v.$n === 'string' && Object.keys(v).length === 1) return Number(v.$n);
      var o = newObj(); var ks = Object.keys(v);
      for (var i = 0; i < ks.length; i++) { $.register(ks[i]); o[ks[i]] = fromJSON(v[ks[i]]); }
      return o;
    }
    return v;
  }
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  methods(SOProto, {
    flush: function () {
      if (!this.$name) return false;
      var s = JSON.stringify(toJSON(this.data, 0));
      if (s !== this.$last) { this.$last = s; return storeSet(PREFIX + this.$name, s); }
      return true;
    },
    clear: function () { this.data = newObj(); this.flush(); },
    getSize: function () { return (this.$last || '').length; },
    close: function () { },
    connect: function () { return false; },
    setFps: function () { return false; },
  });
  var SharedObjectF = native(function () { }, SOProto);
  hide(SharedObjectF, 'getLocal', function (name) {
    name = str(name);
    if (shared[name]) return shared[name];
    var so = Object.create(SOProto);
    hide(so, '$name', name);
    var raw = storeGet(PREFIX + name), data = newObj();
    if (raw) { try { data = fromJSON(JSON.parse(raw)); } catch (e) { data = newObj(); } }
    so.data = data;
    hide(so, '$last', raw || '');
    shared[name] = so;
    return so;
  });
  g('SharedObject', SharedObjectF);
  $.flushShared = function () { for (var k in shared) SOProto.flush.call(shared[k]); };
  window.addEventListener('pagehide', $.flushShared);
  window.addEventListener('beforeunload', $.flushShared);
  document.addEventListener('visibilitychange', function () { if (document.hidden) $.flushShared(); });
  setInterval($.flushShared, 3000);
  $.sharedStorePrefix = PREFIX;

  // ---------------------------------------------------------------- Sound (Web Audio)
  var SoundProto = Object.create(OP);
  methods(SoundProto, {
    attachSound: function (id) { var cid = $.exportId(str(id)); if (cid !== undefined && LIB.sounds[cid]) { hide(this, '$sid', cid); return true; } return false; },
    start: function (offset, loops) {
      if (this.$sid === undefined) return;
      if (this.$inst) $.audio.stop(this.$inst);
      var self = this;
      var inst = $.audio.play(this.$sid, { offset: num(offset) || 0, loops: loops === undefined ? 1 : Math.max(1, num(loops) | 0), volume: this.$vol === undefined ? 1 : this.$vol / 100 },
        function () { var f = gm(self, 'onSoundComplete'); if (typeof f === 'function') $.queueCall($.root, function () { f.call(self); }); });
      hide(this, '$inst', inst);
    },
    stop: function (id) { if (this.$inst) { $.audio.stop(this.$inst); this.$inst = null; } else if (id === undefined) $.audio.stopAll(); },
    setVolume: function (v) { hide(this, '$vol', num(v)); if (this.$inst) $.audio.setVolume(this.$inst, num(v) / 100); else $.audio.setGlobalVolume(num(v) / 100); },
    getVolume: function () { return this.$vol === undefined ? 100 : this.$vol; },
    setPan: function () { }, getPan: function () { return 0; },
    setTransform: function () { }, getTransform: function () { var o = newObj(); o.ll = 100; o.lr = 0; o.rr = 100; o.rl = 0; return o; },
    loadSound: function () { }, getBytesLoaded: function () { return 0; }, getBytesTotal: function () { return 0; },
  });
  Object.defineProperty(SoundProto, 'duration', { get: function () { return this.$sid !== undefined ? $.audio.duration(this.$sid) : 0; }, enumerable: false });
  Object.defineProperty(SoundProto, 'position', { get: function () { return this.$inst ? $.audio.position(this.$inst) : 0; }, enumerable: false });
  g('Sound', native(function () { }, SoundProto, function (a) { var o = Object.create(SoundProto); hide(o, '$target', a[0]); return o; }));

  // ---------------------------------------------------------------- network classes: nothing to load any more
  function later(fn) { setTimeout(function () { try { fn(); $.runQueue(); } catch (e) { $.reportError('network stub', e); } }, 0); }
  var LVProto = Object.create(OP);
  methods(LVProto, {
    load: function (u) { var o = this; console.log('[network blocked] LoadVars.load', str(u)); later(function () { var f = gm(o, 'onLoad'); if (typeof f === 'function') f.call(o, false); }); return true; },
    send: function () { return false; },
    sendAndLoad: function (u, t) { var o = t || this; later(function () { var f = gm(o, 'onLoad'); if (typeof f === 'function') f.call(o, false); }); return true; },
    toString: function () { return ''; }, decode: function () { }, getBytesLoaded: function () { return 0; }, getBytesTotal: function () { return 0; },
  });
  g('LoadVars', native(function () { }, LVProto));
  var XMLProto = Object.create(OP);
  methods(XMLProto, {
    load: function (u) { var o = this; console.log('[network blocked] XML.load', str(u)); later(function () { var f = gm(o, 'onLoad'); if (typeof f === 'function') f.call(o, false); }); return true; },
    send: function () { return false; }, sendAndLoad: function () { return false; }, parseXML: function () { }, toString: function () { return ''; },
  });
  g('XML', native(function () { }, XMLProto));
  var LCProto = Object.create(OP);
  methods(LCProto, { connect: function () { return true; }, send: function () { return false; }, close: function () { }, domain: function () { return 'localhost'; } });
  g('LocalConnection', native(function () { }, LCProto));
  var CMProto = Object.create(OP);
  methods(CMProto, { hideBuiltInItems: function () { }, copy: function () { return Object.create(CMProto); } });
  g('ContextMenu', native(function () { }, CMProto));
  g('ContextMenuItem', native(function () { }, Object.create(OP)));
  var MCLProto = Object.create(OP);
  methods(MCLProto, { addListener: function () { return true; }, removeListener: function () { return true; }, loadClip: function () { return false; }, unloadClip: function () { return true; }, getProgress: function () { var o = newObj(); o.bytesLoaded = 0; o.bytesTotal = 0; return o; } });
  g('MovieClipLoader', native(function () { }, MCLProto));

  // register every name used by the transpiled code for case-insensitive lookup
  if (window.STRINGS) for (var si = 0; si < STRINGS.length; si++) $.register(STRINGS[si]);
  (function () {
    function walk(frames) { for (var i = 0; i < frames.length; i++) for (var j = 0; j < frames[i].length; j++) { var op = frames[i][j]; if (op[0] === 'P' && op[4].name) $.register(op[4].name); } }
    walk(LIB.main.frames);
    for (var id in LIB.chars) { var c = LIB.chars[id]; if (c.k === 'sprite') walk(c.frames); if (c.k === 'edit' && c.variable) $.register(c.variable); }
  })();
})();
