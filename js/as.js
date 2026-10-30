// ActionScript 1/2 (AVM1) language runtime: values, conversions, objects, scopes and calls.
// The transpiled game code (data/scripts.js) calls into this namespace as `$`.
// Semantics follow Flash Player for SWF version 6: undefined converts to 0 / "", strings are
// truthy only when they convert to a non-zero number, and identifiers are case-insensitive.
'use strict';
var $ = {};

(function () {
  var NF = $.NF = { notFound: true };          // "property not found" sentinel
  var hasOwn = Object.prototype.hasOwnProperty;
  var defProp = Object.defineProperty;

  // ================================================================ case-insensitive names
  // SWF6 identifiers are case-insensitive. Every spelling the program uses is registered here so a
  // failed exact lookup can try the other spellings of the same name.
  var SPELL = new Map();   // lower-case name -> [spellings]
  var LOWER = new Map();   // name -> lower-case name
  function lower(s) { var l = LOWER.get(s); if (l === undefined) { l = s.toLowerCase(); if (LOWER.size < 200000) LOWER.set(s, l); } return l; }
  function register(s) {
    var l = lower(s), a = SPELL.get(l);
    if (!a) SPELL.set(l, [s]); else if (a.indexOf(s) < 0) a.push(s);
  }
  function alts(s) { var a = SPELL.get(lower(s)); return a && (a.length > 1 || a[0] !== s) ? a : null; }
  $.register = register; $.alts = alts; $.lower = lower;
  // find the spelling of `k` that exists in object `o` (own or inherited), or null
  function findKey(o, k) {
    if (k in o) return k;
    var a = alts(k);
    if (a) for (var i = 0; i < a.length; i++) if (a[i] in o) return a[i];
    return null;
  }
  function findOwnKey(o, k) {
    if (hasOwn.call(o, k)) return k;
    var a = alts(k);
    if (a) for (var i = 0; i < a.length; i++) if (hasOwn.call(o, a[i])) return a[i];
    return null;
  }
  $.findKey = findKey; $.findOwnKey = findOwnKey;

  // ================================================================ built-in prototypes
  // AS objects are JS objects whose prototype chain ends at ObjectProto (which has a null prototype),
  // so no JavaScript built-in leaks into ActionScript name lookup.
  var ObjectProto = $.ObjectProto = Object.create(null);
  var FunctionProto = $.FunctionProto = Object.create(ObjectProto);
  var ArrayProto = $.ArrayProto = Object.create(ObjectProto);
  var StringProto = $.StringProto = Object.create(ObjectProto);
  var NumberProto = $.NumberProto = Object.create(ObjectProto);
  var BooleanProto = $.BooleanProto = Object.create(ObjectProto);
  // define non-enumerable built-in members (DONT_ENUM)
  function hide(o, k, v) { defProp(o, k, { value: v, writable: true, configurable: true, enumerable: false }); register(k); }
  $.hide = hide;
  function methods(o, table) { for (var k in table) hide(o, k, table[k]); }
  $.methods = methods;
  $.newObject0 = function () { return Object.create(ObjectProto); };

  // ================================================================ conversions
  function isDO(v) { return v !== null && typeof v === 'object' && v.$do === true; }
  $.isDO = isDO;

  // valueOf of an object (AVM1 calls it even when it is not a function -> undefined)
  function valueOf(o) {
    var f = gm(o, 'valueOf');
    return typeof f === 'function' ? f.call(o) : undefined;
  }
  function isPrim(v) { return v === null || (typeof v !== 'object' && typeof v !== 'function'); }

  var NUMRE = /^[ \t\n\r\f\v ]*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  function strToNum(s) {
    if (s === '') return NaN;
    var t = s.replace(/^[+-]/, '');
    if (t.charCodeAt(0) === 48 /* 0 */ && t.length > 1) {
      var c1 = t.charCodeAt(1);
      if (c1 === 120 || c1 === 88) { // hexadecimal (a sign before 0x is not accepted)
        if (t.length !== s.length) return NaN;
        var h = t.slice(2);
        if (!/^[0-9a-fA-F]+$/.test(h)) return NaN;
        return parseInt(h, 16) | 0;
      }
      if (/^[0-7]+$/.test(t)) { var o = parseInt(t, 8) | 0; return s.charCodeAt(0) === 45 ? -o : o; }
    }
    if (!NUMRE.test(s)) return NaN;
    return parseFloat(s);
  }
  $.strToNum = strToNum;

  function n(v) {
    switch (typeof v) {
      case 'number': return v;
      case 'boolean': return v ? 1 : 0;
      case 'undefined': return 0;                 // SWF6: undefined -> 0
      case 'string': return strToNum(v);
      case 'function': return NaN;
      case 'object':
        if (v === null) return 0;                 // SWF6: null -> 0
        if (isDO(v)) return NaN;
        var p = valueOf(v);
        if (!isPrim(p)) return NaN;
        return p === undefined || p === null ? NaN : n(p);
    }
    return NaN;
  }
  $.n = n;

  function fmtNum(v) {
    if (v !== v) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    if (v === 0) return '0';
    if (v === Math.floor(v) && v >= -2147483648 && v <= 2147483647) return String(v);
    var neg = v < 0; if (neg) v = -v;
    var e = v.toExponential(14);          // d.dddddddddddddde±x (15 significant digits)
    var k = e.indexOf('e');
    var mant = e.slice(0, k).replace('.', '').replace(/0+$/, '');
    var exp = +e.slice(k + 1);
    var s;
    if (exp >= 15 || exp < -5) {
      s = mant.charAt(0) + (mant.length > 1 ? '.' + mant.slice(1) : '') + 'e' + (exp > 0 ? '+' : '-') + Math.abs(exp);
    } else if (exp >= 0) {
      if (mant.length <= exp + 1) s = mant + new Array(exp + 2 - mant.length).join('0');
      else s = mant.slice(0, exp + 1) + '.' + mant.slice(exp + 1);
    } else {
      s = '0.' + new Array(-exp).join('0') + mant;
    }
    return neg ? '-' + s : s;
  }
  $.fmtNum = fmtNum;

  function str(v) {
    switch (typeof v) {
      case 'string': return v;
      case 'number': return fmtNum(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'undefined': return '';                // SWF6: undefined -> ""
      case 'function': {
        var f = gm(v, 'toString');
        if (typeof f === 'function' && f !== ObjectProto.toString) { var r = f.call(v); if (typeof r === 'string') return r; }
        return '[type Function]';
      }
      case 'object': {
        if (v === null) return 'null';
        if (isDO(v)) return v.path();
        if (v.$boxed !== undefined && typeof v.$boxed === 'string') return v.$boxed;
        var ts = gm(v, 'toString');
        if (typeof ts === 'function') { var r2 = ts.call(v); if (typeof r2 === 'string') return r2; if (r2 === undefined) return ''; return str(r2); }
        return '[type Object]';
      }
    }
    return String(v);
  }
  $.str = str;

  function bool(v) {
    switch (typeof v) {
      case 'boolean': return v;
      case 'number': return v !== 0 && v === v;
      case 'string': { var x = strToNum(v); return x !== 0 && x === x; } // SWF6 rule
      case 'undefined': return false;
      case 'object': return v !== null;
      default: return true;
    }
  }
  $.bool = bool;

  $.toInt = function (v) { v = n(v); if (v !== v || v === Infinity || v === -Infinity) return v !== v ? 0 : v; return v < 0 ? Math.ceil(v) : Math.floor(v); };
  $.i32 = function (v) { return n(v) | 0; };
  $.div = function (a, b) { return a / b; };

  // ToPrimitive used by Add2
  function toPrimAdd(v) {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function') { var r0 = valueOf(v); return isPrim(r0) ? r0 : v; }
      return v;
    }
    if (isDO(v)) { var rv = valueOf(v); return rv === undefined ? v.path() : v; }
    if (v instanceof $.ASDate) { var ds = gm(v, 'toString'); return typeof ds === 'function' ? ds.call(v) : undefined; }
    var r = valueOf(v);
    return isPrim(r) ? r : v;
  }
  $.add = function (a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    a = toPrimAdd(a); b = toPrimAdd(b);
    if (typeof a === 'string') return a + str(b);
    if (typeof b === 'string') return str(a) + b;
    return n(a) + n(b);
  };
  function toPrimNum(v) { // ToPrimitive with number hint (valueOf only)
    if (v !== null && typeof v === 'object' && !isDO(v)) return valueOf(v);
    return v;
  }
  function isPlainObj(v) { return v !== null && (typeof v === 'object' || typeof v === 'function') && !isDO(v); }
  // abstract relational comparison; returns true, false or undefined (NaN involved)
  $.lt = function (a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a !== a || b !== b ? undefined : a < b;
    var pa = toPrimNum(a); if (isPlainObj(pa)) return false;
    var pb = toPrimNum(b); if (isPlainObj(pb)) return false;
    if (typeof pa === 'string' && typeof pb === 'string') return pa < pb;
    var x = isDO(pa) ? NaN : n(pa), y = isDO(pb) ? NaN : n(pb);
    if (x !== x || y !== y) return undefined;
    return x < y;
  };
  $.lt1 = function (x, y) { return x < y; };       // AS1 Less (numbers)
  $.eq1 = function (x, y) { return x === y; };     // AS1 Equals (numbers)
  function eq(a, b) {
    var ta = typeof a, tb = typeof b;
    if ((a === undefined || a === null) && (b === undefined || b === null)) return true;
    if (ta === tb && ta !== 'object' && ta !== 'function') {
      if (ta === 'number') return a === b || (a !== a && b !== b);
      return a === b;
    }
    if (a === undefined || a === null || b === undefined || b === null) {
      // object vs undefined/null: compare valueOf
      var o = a === undefined || a === null ? b : a, u = o === a ? b : a;
      if (isPlainObj(o)) { var p = toPrimNum(o); return isPrim(p) && eq(p, u); }
      return false;
    }
    if ((ta === 'object' || ta === 'function') && (tb === 'object' || tb === 'function')) {
      if (isDO(a) && isDO(b)) return a === b || a.path() === b.path();
      return a === b;
    }
    if (ta === 'boolean') return eq(a ? 1 : 0, b);
    if (tb === 'boolean') return eq(a, b ? 1 : 0);
    if (ta === 'number' && tb === 'string') return a === strToNum(b);
    if (ta === 'string' && tb === 'number') return strToNum(a) === b;
    if (ta === 'object' || ta === 'function') { if (isDO(a)) return false; var pa = toPrimNum(a); return isPrim(pa) && pa !== undefined && eq(pa, b); }
    if (tb === 'object' || tb === 'function') { if (isDO(b)) return false; var pb = toPrimNum(b); return isPrim(pb) && pb !== undefined && eq(a, pb); }
    return false;
  }
  $.eq = eq;
  $.typeOf = function (v) {
    switch (typeof v) {
      case 'undefined': return 'undefined';
      case 'number': return 'number';
      case 'string': return 'string';
      case 'boolean': return 'boolean';
      case 'function': return 'function';
      case 'object':
        if (v === null) return 'null';
        if (isDO(v)) return v.$isClip ? 'movieclip' : 'object';
        return 'object';
    }
    return 'undefined';
  };
  $.random = function (v) { v = n(v) | 0; return v > 0 ? Math.floor(Math.random() * v) : 0; };
  $.chr = function (v) { var c = n(v) & 0xffff; return c ? String.fromCharCode(c) : ''; };
  $.ord = function (v) { var s = str(v); return s.length ? s.charCodeAt(0) : 0; };
  $.substr1 = function (s, i, c) {
    s = str(s); i = n(i) | 0; c = n(c) | 0;
    var start = i < 1 ? 0 : i - 1;
    return c < 0 ? s.slice(start) : s.substr(start, c);
  };
  $.targetPath = function (v) { return isDO(v) ? v.path() : undefined; };
  $.trace = function (v) { console.log('[trace] ' + str(v)); };
  $.wrapThrow = function (v) { return v; };
  $.cast = function (c, o) { return $.instanceOf(o, c) ? o : null; };
  $.implementsOp = function () { };

  // ================================================================ member access
  function arrGet(a, k) {
    if (typeof k === 'number') return a[k];
    if (k === 'length') return a.length;
    var c = k.charCodeAt(0);
    if (c >= 48 && c <= 57) { var i = +k; if (i === (i | 0) && String(i) === k) return a[i]; }
    if (hasOwn.call(a, k)) return a[k];
    var ok = findOwnKey(a, k); if (ok !== null) return a[ok];
    if (k === '__proto__') return ArrayProto;
    var pk = findKey(ArrayProto, k);
    return pk === null ? NF : ArrayProto[pk];
  }
  var FN_HIDDEN = { name: 1, length: 1, caller: 1, arguments: 1 };
  function fnGet(f, k) {
    if (k === 'prototype') return f.prototype;
    if (k === '__proto__') return FunctionProto;
    if (hasOwn.call(f, k) && (!FN_HIDDEN[k] || Object.getOwnPropertyDescriptor(f, k).enumerable)) return f[k];
    var a = alts(k);
    if (a) for (var i = 0; i < a.length; i++) if (hasOwn.call(f, a[i]) && !FN_HIDDEN[a[i]]) return f[a[i]];
    var pk = findKey(FunctionProto, k);
    return pk === null ? NF : FunctionProto[pk];
  }
  function protoGet(P, k) { var pk = findKey(P, k); return pk === null ? NF : P[pk]; }
  // get a member, or NF when the object has no such property
  function getRaw(o, k) {
    if (o === undefined || o === null) return NF;
    switch (typeof o) {
      case 'object':
        if (o.$do === true) return o.getMemberRaw(typeof k === 'string' ? k : str(k));
        if (Array.isArray(o)) return arrGet(o, typeof k === 'number' ? k : (typeof k === 'string' ? k : str(k)));
        if (typeof k !== 'string') k = str(k);
        if (k in o) return o[k];
        if (k === '__proto__') { var pr = Object.getPrototypeOf(o); return pr === null ? undefined : pr; }
        var fk = findKey(o, k);
        if (fk !== null) return o[fk];
        if (o.$resolve) return o.$resolve(k);
        return NF;
      case 'function': return fnGet(o, typeof k === 'string' ? k : str(k));
      case 'string':
        if (k === 'length') return o.length;
        return protoGet(StringProto, typeof k === 'string' ? k : str(k));
      case 'number': return protoGet(NumberProto, typeof k === 'string' ? k : str(k));
      case 'boolean': return protoGet(BooleanProto, typeof k === 'string' ? k : str(k));
    }
    return NF;
  }
  $.getRaw = getRaw;
  function gm(o, k) { var r = getRaw(o, k); return r === NF ? undefined : r; }
  $.gm = gm;

  function setArrayLength(a, v) { var l = n(v) | 0; if (l < 0) l = 0; a.length = l; }
  function sm(o, k, v) {
    if (o === undefined || o === null) return;
    var t = typeof o;
    if (t === 'object') {
      if (o.$do === true) { o.setMember(typeof k === 'string' ? k : str(k), v); return; }
      if (Array.isArray(o)) {
        if (typeof k === 'number') { if (k >= 0 && k === (k | 0)) { o[k] = v; return; } k = str(k); }
        if (typeof k !== 'string') k = str(k);
        if (k === 'length') { setArrayLength(o, v); return; }
        var c = k.charCodeAt(0);
        if (c >= 48 && c <= 57) { var i = +k; if (i === (i | 0) && String(i) === k) { o[i] = v; return; } }
        var ak = findOwnKey(o, k); if (ak === null) { register(k); ak = k; }
        o[ak] = v; return;
      }
      if (typeof k !== 'string') k = str(k);
      if (k === '__proto__') { if (v === null || typeof v === 'object' || typeof v === 'function') { try { Object.setPrototypeOf(o, v === null ? null : v); } catch (e) { } } return; }
      var key = findKey(o, k);
      if (key === null) { register(k); key = k; }
      if (o.$watch && o.$watch[lower(key)]) v = o.$watch[lower(key)].call(o, key, o[key], v);
      o[key] = v;
      return;
    }
    if (t === 'function') {
      if (typeof k !== 'string') k = str(k);
      if (k === 'prototype') { o.prototype = v; return; }
      if (k === '__proto__') return;
      var fk = findOwnKey(o, k);
      if (fk === null || FN_HIDDEN[fk]) { register(k); fk = k; }
      if (FN_HIDDEN[fk]) defProp(o, fk, { value: v, writable: true, enumerable: true, configurable: true });
      else o[fk] = v;
    }
    // primitives: ignored
  }
  $.sm = sm;
  $.deleteMember = function (o, k) {
    if (o === undefined || o === null) return false;
    k = typeof k === 'string' ? k : str(k);
    if (isDO(o)) return o.deleteMember(k);
    if (typeof o === 'object' || typeof o === 'function') {
      var key = findOwnKey(o, k);
      if (key === null) return false;
      var d = Object.getOwnPropertyDescriptor(o, key);
      if (d && d.configurable === false) return false;
      if (o.$permanent && o.$permanent[lower(key)]) return false;
      delete o[key];
      return true;
    }
    return false;
  };

  // ================================================================ scopes
  // scope kinds
  var GLOBAL = 0, TARGET = 1, LOCAL = 2, WITH = 3;
  function Scope(k, o, p) { this.k = k; this.o = o; this.p = p; }
  $.Scope = Scope;
  $.global = Object.create(ObjectProto);    // _global
  $.globalScope = new Scope(GLOBAL, $.global, null);
  $.clipScope = function (clip) { return new Scope(TARGET, clip, $.globalScope); };
  $.withScope = function (sc, o) { return new Scope(WITH, o, sc); };
  // the scope's target clip (innermost TARGET scope)
  function scopeClip(sc) { for (; sc; sc = sc.p) if (sc.k === TARGET) return sc.o; return null; }
  $.scopeClip = scopeClip;
  // SetTarget: replace the TARGET scope of the original chain by the new target
  function replaceTarget(sc, clip) {
    if (!sc) return null;
    if (sc.k === TARGET) return new Scope(TARGET, clip, sc.p);
    if (sc.k === GLOBAL) return new Scope(TARGET, clip, sc);
    return new Scope(sc.k, sc.o, replaceTarget(sc.p, clip));
  }
  $.findTarget = function (u, path) {
    var r = $.resolveTarget(u.base, path);
    return isDO(r) ? r : null;
  };
  $.findTarget2 = function (u, v) {
    if (v === undefined) return u.base;          // SWF6: SetTarget2(undefined) resets to the base clip
    if (isDO(v)) return v;
    if (v === null) return null;
    var s = str(v);
    if (s === '') return u.base;
    var r = $.resolveTarget(u.base, s);
    return isDO(r) ? r : null;
  };
  $.targetScope = function (u, clip) { return replaceTarget(u.sc, clip || (u.base && u.base.root()) || $.root); };

  var OWNER;  // object on which the last scope lookup found its value (used as `this` by CallFunction)
  function lookupRaw(sc, name) {
    OWNER = undefined;
    for (var s = sc; s; s = s.p) {
      var o = s.o, r;
      switch (s.k) {
        case LOCAL:
          if (name in o) return o[name];
          var lk = findKey(o, name); if (lk !== null) return o[lk];
          break;
        case TARGET:
          if (!o) break;
          r = o.getMemberRaw(name);
          if (r !== NF) { OWNER = o; return r; }
          break;
        case WITH:
          r = getRaw(o, name);
          if (r !== NF) { OWNER = o; return r; }
          break;
        case GLOBAL:
          r = getRaw(o, name);
          if (r !== NF) { OWNER = o; return r; }
          break;
      }
    }
    return NF;
  }
  function special(sc, name) {
    // names that resolve without a scope: _global, _levelN, this
    var l = lower(name);
    if (l === '_global') return $.global;
    if (l === 'this') { for (var s = sc; s; s = s.p) if (s.k === TARGET) return s.o; return undefined; }
    if (l.length > 6 && l.slice(0, 6) === '_level') { var k = +l.slice(6); return k === 0 ? $.root : undefined; }
    return NF;
  }
  function lookup(sc, name) {
    if (name.charCodeAt(0) === 95 || name.length === 4) { var sp = special(sc, name); if (sp !== NF) { OWNER = undefined; return sp; } }
    return lookupRaw(sc, name);
  }
  function hasPath(name) { return name.indexOf('.') >= 0 || name.indexOf('/') >= 0 || name.indexOf(':') >= 0; }
  // "a.b.c", "/a/b:c", "../x", "_root.x" -> [object, property]
  function splitPath(sc, path) {
    var i = Math.max(path.lastIndexOf(':'), path.lastIndexOf('.'));
    if (i < 0) { // slash only: "/a/b" refers to a clip
      return [resolvePath(sc, path), null];
    }
    // ".." at the end is a path, not a property
    if (path.charAt(i) === '.' && path.charAt(i - 1) === '.') return [resolvePath(sc, path), null];
    var head = path.slice(0, i), prop = path.slice(i + 1);
    if (head === '') return [path.charAt(0) === '/' ? rootOf(sc) : scopeClip(sc), prop];
    return [resolvePath(sc, head), prop];
  }
  function rootOf(sc) { var c = scopeClip(sc); return c ? c.root() : $.root; }
  function resolvePath(sc, path) {
    var cur, i = 0;
    var parts = path.split(/\/|\.(?!\.)|:/);
    if (path.charAt(0) === '/') { cur = rootOf(sc); i = 1; }
    else cur = undefined;
    for (; i < parts.length; i++) {
      var p = parts[i];
      if (p === '') continue;
      if (p === '..') { if (cur === undefined) cur = scopeClip(sc); cur = isDO(cur) ? cur.parent || undefined : undefined; continue; }
      if (p.charAt(0) === '.') { p = p.slice(1); if (p === '') continue; } // ".." split leftovers
      if (cur === undefined && i === 0) { var v = lookup(sc, p); cur = v === NF ? undefined : v; }
      else if (cur === undefined) {
        // first segment after a leading "/" was empty
        var c0 = scopeClip(sc); var r0 = getRaw(c0, p); cur = r0 === NF ? undefined : r0;
      } else { var r = getRaw(cur, p); cur = r === NF ? undefined : r; }
      if (cur === undefined || cur === null) return undefined;
    }
    return cur;
  }
  $.resolvePath = resolvePath;

  $.get = function (sc, name) {
    if (typeof name !== 'string') name = str(name);
    if (hasPath(name)) {
      var sp = splitPath(sc, name);
      return sp[1] === null ? sp[0] : gm(sp[0], sp[1]);
    }
    var r = lookup(sc, name);
    return r === NF ? undefined : r;
  };
  $.set = function (sc, name, v) {
    if (typeof name !== 'string') name = str(name);
    if (hasPath(name)) {
      var sp = splitPath(sc, name);
      if (sp[1] !== null) sm(sp[0], sp[1], v);
      return;
    }
    for (var s = sc; s; s = s.p) {
      var o = s.o;
      switch (s.k) {
        case LOCAL: { var lk = findKey(o, name); if (lk !== null) { o[lk] = v; return; } break; }
        case TARGET: if (o) { o.setMember(name, v); return; } break;
        case WITH: if (getRaw(o, name) !== NF) { sm(o, name, v); return; } break;
        case GLOBAL: if (getRaw(o, name) !== NF) { sm(o, name, v); return; } break;
      }
    }
    var c = $.root; if (c) c.setMember(name, v);
  };
  // DefineLocal: define on the innermost scope object
  $.local = function (sc, name, v) {
    if (typeof name !== 'string') name = str(name);
    if (sc.k === LOCAL) { var lk = findOwnKey(sc.o, name); if (lk === null) { register(name); lk = name; } sc.o[lk] = v; }
    else if (sc.k === TARGET) { if (sc.o) sc.o.setMember(name, v); }
    else sm(sc.o, name, v);
  };
  $.local2 = function (sc, name) {
    if (typeof name !== 'string') name = str(name);
    if (sc.k === LOCAL) { if (findOwnKey(sc.o, name) === null) { register(name); sc.o[name] = undefined; } }
    else if (sc.k === TARGET) { if (sc.o && sc.o.getMemberRaw(name) === NF) sc.o.setMember(name, undefined); }
  };
  $.deleteVar = function (sc, name) {
    if (typeof name !== 'string') name = str(name);
    for (var s = sc; s; s = s.p) {
      var o = s.o;
      if (s.k === LOCAL) { var lk = findOwnKey(o, name); if (lk !== null) { delete o[lk]; return true; } }
      else if (s.k === TARGET) { if (o && o.getMemberRaw(name) !== NF) return o.deleteMember(name); }
      else if (getRaw(o, name) !== NF) return $.deleteMember(o, name);
    }
    return false;
  };

  // ================================================================ calls
  $.callFunction = function (sc, name, args) {
    if (typeof name !== 'string') name = str(name);
    var f, self;
    if (hasPath(name)) {
      var sp = splitPath(sc, name);
      if (sp[1] === null) { f = sp[0]; self = undefined; }
      else return $.callMethod(sp[0], sp[1], args);
    } else {
      f = lookup(sc, name);
      self = OWNER;
      if (f === NF) return undefined;
    }
    if (typeof f !== 'function') return undefined;
    return f.apply(self, args);
  };
  $.callMethod = function (o, name, args) {
    var f;
    if (name === undefined || name === '' || name === null) {
      if (typeof o !== 'function') return undefined;
      return o.apply(undefined, args);
    }
    f = gm(o, name);
    if (typeof f !== 'function') return undefined;
    return f.apply(o, args);
  };
  function protoFor(F) {
    var p = gm(F, 'prototype');
    return p !== null && (typeof p === 'object' || typeof p === 'function') ? p : ObjectProto;
  }
  function construct(F, args) {
    if (typeof F !== 'function') return undefined;
    if (F.$construct) return F.$construct(args);
    var o = Object.create(protoFor(F));
    hide(o, '__constructor__', F);
    hide(o, 'constructor', F);
    F.apply(o, args);
    return o;
  }
  $.construct = construct;
  $.newObject = function (sc, name, args) {
    if (typeof name !== 'string') name = str(name);
    return construct($.get(sc, name), args);
  };
  $.newMethod = function (o, name, args) {
    if (name === undefined || name === '' || name === null) return construct(o, args);
    return construct(gm(o, name), args);
  };
  $.popArgs = function (s, count) { var a = []; count = count | 0; for (var i = 0; i < count; i++) a.push(s.pop()); return a; };
  $.popPairs = function (s, count) { var a = []; count = count | 0; for (var i = 0; i < count; i++) { var v = s.pop(), k = s.pop(); a.push(k, v); } return a; };
  $.arr = function (a) { return a; };
  $.initObject = function (pairs) {
    var o = Object.create(ObjectProto);
    for (var i = 0; i < pairs.length; i += 2) sm(o, str(pairs[i]), pairs[i + 1]);
    return o;
  };
  $.instanceOf = function (o, C) {
    if (o === null || o === undefined || isPrim(o)) return false;
    if (typeof C !== 'function' && (typeof C !== 'object' || C === null)) return false;
    var P = gm(C, 'prototype');
    if (P === undefined || P === null) return false;
    var p = $.protoOf(o);
    for (var g = 0; p && g < 256; g++) { if (p === P) return true; p = Object.getPrototypeOf(p); }
    return false;
  };
  // the AS prototype of any object
  $.protoOf = function (o) {
    if (isDO(o)) return Object.getPrototypeOf(o.vars);
    if (Array.isArray(o)) return ArrayProto;
    if (typeof o === 'function') return FunctionProto;
    return Object.getPrototypeOf(o);
  };
  $.extends = function (sub, sup) {
    var p = Object.create(protoFor(sup));
    hide(p, 'constructor', sup);
    hide(p, '__constructor__', sup);
    sub.prototype = p;
  };

  // Function objects. spec: {n: name, p: [[register, name]...], r: register count, f: flags, v2}
  $.fn = function (spec, defScope, defBase, impl) {
    var params = spec.p, flags = spec.f | 0, regCount = spec.r | 0, v2 = spec.v2;
    var f = function () {
      var self = this, args = Array.prototype.slice.call(arguments);
      var vars = Object.create(null);
      var act = new Scope(LOCAL, vars, defScope);
      var regs = new Array(Math.max(4, regCount + 1));
      var argsObj = args.slice(); hide(argsObj, 'callee', f); hide(argsObj, 'caller', null);
      if (v2) {
        var r = 1;
        if (flags & 0x01) regs[r++] = self;
        if (!(flags & 0x02)) vars['this'] = self;
        if (flags & 0x04) regs[r++] = argsObj;
        if (!(flags & 0x08)) vars['arguments'] = argsObj;
        if (flags & 0x10) regs[r++] = $.superOf(self, f);
        if (!(flags & 0x20)) vars['super'] = $.superOf(self, f);
        if (flags & 0x40) regs[r++] = defBase ? defBase.root() : $.root;
        if (flags & 0x80) regs[r++] = defBase ? defBase.parent || undefined : undefined;
        if (flags & 0x100) regs[r++] = $.global;
      } else {
        vars['arguments'] = argsObj;
      }
      for (var i = 0; i < params.length; i++) {
        var p = params[i];
        if (p[0]) regs[p[0]] = args[i];
        else { register(p[1]); vars[p[1]] = args[i]; }
      }
      // a function whose clip is gone runs against `this` (or the current clip) instead
      var base = defBase && !defBase.removed ? defBase : (isDO(self) ? self : ($.cur || $.root));
      return impl(act, self, args, regs, base, base);
    };
    var proto = Object.create(ObjectProto);
    hide(proto, 'constructor', f);
    hide(proto, '__constructor__', f);
    f.prototype = proto;
    f.$as = true;
    return f;
  };
  // `super` inside a method: calls go to the prototype of the prototype the method was found on.
  $.superOf = function (self, fn) {
    if (self === undefined || self === null) return undefined;
    return new SuperObj(self, fn);
  };
  function SuperObj(self, fn) { this.self = self; this.fn = fn; }
  $.SuperObj = SuperObj;
})();
