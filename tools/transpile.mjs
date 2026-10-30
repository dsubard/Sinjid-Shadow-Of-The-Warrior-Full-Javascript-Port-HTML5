// AVM1 bytecode -> JavaScript.
//
// Every code unit (frame script, clip event, button action, function body) becomes one JS function.
// The AVM1 operand stack is resolved at compile time inside each basic block (values become JS
// expressions); whatever is still on the stack at the end of a block is pushed onto a real array `$s`,
// and the next block pops from it. This handles every stack shape the compiler can produce
// (for..in enumerations, ternaries, switch) without pattern matching.
// Control flow becomes a `switch` state machine over basic blocks; straight-line units are emitted flat.
//
// Generated code calls into the runtime namespace `$` (js/as.js).
import { decode } from './avm1.mjs';

const Q = (s) => JSON.stringify(s).replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
const PROPS = ['_x', '_y', '_xscale', '_yscale', '_currentframe', '_totalframes', '_alpha', '_visible', '_width', '_height', '_rotation',
  '_target', '_framesloaded', '_name', '_droptarget', '_url', '_highquality', '_focusrect', '_soundbuftime', '_quality', '_xmouse', '_ymouse'];
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

class E {
  // code: JS expression; pure: no side effects and value cannot change (literal / temp);
  // heap: reads mutable state (variables, members, registers); num/str/bool: static type known
  constructor(code, o = {}) {
    this.code = code;
    this.pure = !!o.pure;
    this.num = !!o.num; this.str = !!o.str; this.bool = !!o.bool;
    this.lit = o.lit; // literal value (number | string | boolean | null | undefined) when known
    this.hasLit = 'lit' in o;
    this.fn = !!o.fn;  // function literal (creates a new closure every time it is evaluated)
  }
}
const lit = (v) => {
  if (v === undefined) return new E('undefined', { pure: true, lit: undefined });
  if (v === null) return new E('null', { pure: true, lit: null });
  if (typeof v === 'boolean') return new E(String(v), { pure: true, bool: true, lit: v });
  if (typeof v === 'string') return new E(Q(v), { pure: true, str: true, lit: v });
  let c;
  if (Number.isNaN(v)) c = 'NaN'; else if (v === Infinity) c = 'Infinity'; else if (v === -Infinity) c = '(-Infinity)';
  else if (Object.is(v, -0)) c = '(-0)'; else c = v < 0 ? `(${v})` : String(v);
  return new E(c, { pure: true, num: true, lit: v });
};

export const STRINGS = new Set();
// Flash stops running a script when its clip was removed by a call (e.g. a parent's gotoAndStop)
const ABORT = 'if ($base.removed) return;';
// methods that can never remove a clip (no abort check needed after them)
const SAFE_METHODS = new Set(['isDown', 'isToggled', 'getCode', 'getAscii', 'ceil', 'floor', 'round', 'random', 'abs', 'min', 'max', 'sqrt', 'pow',
  'sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'push', 'pop', 'shift', 'unshift', 'join', 'split', 'slice', 'splice', 'concat',
  'reverse', 'sort', 'sortOn', 'substr', 'substring', 'charAt', 'charCodeAt', 'indexOf', 'lastIndexOf', 'toString', 'toUpperCase', 'toLowerCase',
  'hitTest', 'getBounds', 'localToGlobal', 'globalToLocal', 'getDepth', 'getTime', 'getBytesLoaded', 'getBytesTotal', 'valueOf', 'getTimer',
  'setRGB', 'getRGB', 'setTransform', 'getTransform', 'flush', 'getLocal', 'addListener', 'removeListener', 'hasOwnProperty', 'getNextHighestDepth',
  'getInstanceAtDepth', 'setTextFormat', 'getTextFormat', 'setNewTextFormat', 'fromCharCode', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'Color', 'Sound', 'TextFormat', 'escape', 'unescape', 'trace',
  'setVolume', 'getVolume', 'setPan', 'attachSound', 'setInterval', 'clearInterval', 'swapDepths', 'startDrag', 'stopDrag',
  'lineStyle', 'moveTo', 'lineTo', 'curveTo', 'beginFill', 'endFill']);
const abortAfter = (nameElem) => (nameElem && nameElem.hasLit && typeof nameElem.lit === 'string' && SAFE_METHODS.has(nameElem.lit) ? null : ABORT);

function compileUnit(instrs, kind) {
  const body = instrs.filter((i) => i.op !== 'End' && i.op !== 'ConstantPool');
  const endPos = instrs.length ? instrs[instrs.length - 1].next : 0;
  const idxOfPos = new Map();
  body.forEach((ins, i) => idxOfPos.set(ins.pos, i));
  // positions that are not instruction starts in `body` (End, ConstantPool, end of code) map to the next instruction
  const allPos = instrs.map((i) => i.pos).concat([endPos]);
  const resolve = (pos) => {
    if (idxOfPos.has(pos)) return idxOfPos.get(pos);
    // find first body instruction at or after pos
    for (let i = 0; i < body.length; i++) if (body[i].pos >= pos) return i;
    return body.length;
  };
  if (!allPos.includes(endPos)) allPos.push(endPos);

  // With regions: [start, end) in byte positions
  const withs = [];
  body.forEach((ins) => { if (ins.op === 'With') withs.push({ start: ins.next, end: ins.blockEnd, v: '$w' + withs.length }); });
  const scopeAt = (pos) => {
    let best = null;
    for (const w of withs) if (pos >= w.start && pos < w.end && (!best || w.start >= best.start)) best = w;
    return best ? best.v : '$sc';
  };

  // basic blocks
  const leaders = new Set([0]);
  body.forEach((ins, i) => {
    if (ins.op === 'Jump' || ins.op === 'If') { leaders.add(resolve(ins.target)); leaders.add(i + 1); }
    if (ins.op === 'Return' || ins.op === 'Throw') leaders.add(i + 1);
    if (ins.op === 'With') { leaders.add(i + 1); leaders.add(resolve(ins.blockEnd)); }
  });
  for (const w of withs) leaders.add(resolve(w.end));
  const starts = [...leaders].filter((x) => x <= body.length).sort((a, b) => a - b);
  const blockAt = new Map();
  starts.forEach((s, b) => blockAt.set(s, b));
  const nBlocks = starts.length;
  const EXIT = starts[starts.length - 1] === body.length ? blockAt.get(body.length) : nBlocks;
  const blockOfIdx = (idx) => (idx >= body.length ? EXIT : blockAt.get(idx));

  const decls = new Set();
  let tmpN = 0;
  const newTmp = () => { const t = 't' + (++tmpN); decls.add(t); return t; };
  const use = { s: false, tgt: false, r: false };
  const out = new Map(); // block -> lines

  for (let b = 0; b < nBlocks; b++) {
    const s0 = starts[b];
    if (s0 >= body.length) continue;
    const e0 = b + 1 < nBlocks ? starts[b + 1] : body.length;
    const lines = [];
    const emit = (l) => lines.push(l);
    const st = [];
    let ended = false;

    const pop = () => {
      if (st.length) return st.pop();
      use.s = true;
      const t = newTmp();
      emit(`${t} = $s.pop();`);
      return new E(t, { pure: true });
    };
    const push = (e) => st.push(e);
    const freeze = (e) => {
      if (e.pure) return e;
      const t = newTmp();
      emit(`${t} = ${e.code};`);
      return new E(t, { pure: true, num: e.num, str: e.str, bool: e.bool });
    };
    const spill = () => { for (let i = 0; i < st.length; i++) if (!st[i].pure) st[i] = freeze(st[i]); };
    const flush = () => {
      if (!st.length) return;
      use.s = true;
      emit(`$s.push(${st.map((e) => e.code).join(', ')});`);
      st.length = 0;
    };
    const N = (e) => (e.num ? e.code : `$.n(${e.code})`);
    const B = (e) => (e.bool ? e.code : `$.bool(${e.code})`);
    const S = (e) => (e.str ? e.code : `$.str(${e.code})`);
    const popN = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(pop()); return a; };
    const count = (e) => {
      if (e.hasLit && typeof e.lit === 'number') return e.lit;
      return null;
    };
    const args = (n) => {
      // n may be dynamic: then arguments are collected at run time from the real stack
      const k = count(n);
      if (k === null) { spill(); flush(); use.s = true; return `$.popArgs($s, ${N(n)})`; }
      return '[' + popN(Math.max(0, k | 0)).map((e) => e.code).join(', ') + ']';
    };
    const goto_ = (target) => `$b = ${target}; continue;`;
    const binNum = (op) => { const y = pop(), x = pop(); push(new E(`(${N(x)} ${op} ${N(y)})`, { num: true, pure: x.pure && y.pure })); };
    const sc = (ins) => scopeAt(ins.pos);
    const tgt = () => { use.tgt = true; return '$tgt'; };

    for (let i = s0; i < e0 && !ended; i++) {
      const ins = body[i];
      const SC = sc(ins);
      switch (ins.op) {
        case 'Push':
          for (const v of ins.values) {
            if (v.t === 'str') { STRINGS.add(v.v); push(lit(v.v)); }
            else if (v.t === 'num') push(lit(v.v));
            else if (v.t === 'null') push(lit(null));
            else if (v.t === 'undef') push(lit(undefined));
            else if (v.t === 'bool') push(lit(v.v));
            else if (v.t === 'reg') { use.r = true; push(new E(`$r[${v.v}]`)); }
          }
          break;
        case 'Pop': { const e = pop(); if (!e.pure && !e.fn) { spill(); emit(`${e.code};`); } break; }
        case 'PushDuplicate': { const e = freeze(pop()); push(e); push(e); break; }
        case 'StackSwap': { const a = pop(), c = pop(); push(a); push(c); break; }
        case 'StoreRegister': {
          const e = freeze(pop());
          spill();
          use.r = true;
          emit(`$r[${ins.reg}] = ${e.code};`);
          push(e);
          break;
        }
        // ---------------------------------------------------------------- arithmetic / logic
        case 'Add': binNum('+'); break;
        case 'Add2': {
          const y = pop(), x = pop();
          if (x.num && y.num) push(new E(`(${x.code} + ${y.code})`, { num: true, pure: x.pure && y.pure }));
          else if (x.str && y.str) push(new E(`(${x.code} + ${y.code})`, { str: true, pure: x.pure && y.pure }));
          else push(new E(`$.add(${x.code}, ${y.code})`, { pure: x.pure && y.pure }));
          break;
        }
        case 'Subtract': binNum('-'); break;
        case 'Multiply': binNum('*'); break;
        case 'Divide': { const y = pop(), x = pop(); push(new E(`$.div(${N(x)}, ${N(y)})`, { num: true, pure: x.pure && y.pure })); break; }
        case 'Modulo': binNum('%'); break;
        case 'Increment': { const x = pop(); push(new E(`(${N(x)} + 1)`, { num: true, pure: x.pure })); break; }
        case 'Decrement': { const x = pop(); push(new E(`(${N(x)} - 1)`, { num: true, pure: x.pure })); break; }
        case 'ToNumber': { const x = pop(); push(new E(N(x), { num: true, pure: x.pure })); break; }
        case 'ToString': { const x = pop(); push(new E(S(x), { str: true, pure: x.pure })); break; }
        case 'ToInteger': { const x = pop(); push(new E(`$.toInt(${x.code})`, { num: true, pure: x.pure })); break; }
        case 'BitAnd': case 'BitOr': case 'BitXor': case 'BitLShift': case 'BitRShift': case 'BitURShift': {
          const y = pop(), x = pop();
          const op = { BitAnd: '&', BitOr: '|', BitXor: '^', BitLShift: '<<', BitRShift: '>>', BitURShift: '>>>' }[ins.op];
          push(new E(`($.i32(${x.code}) ${op} $.i32(${y.code}))`, { num: true, pure: x.pure && y.pure }));
          break;
        }
        case 'Less': { const y = pop(), x = pop(); push(new E(`$.lt1(${N(x)}, ${N(y)})`, { pure: x.pure && y.pure })); break; }
        case 'Equals': { const y = pop(), x = pop(); push(new E(`$.eq1(${N(x)}, ${N(y)})`, { pure: x.pure && y.pure })); break; }
        case 'Less2': { const y = pop(), x = pop(); push(new E(`$.lt(${x.code}, ${y.code})`, { pure: x.pure && y.pure })); break; }
        case 'Greater': { const y = pop(), x = pop(); push(new E(`$.lt(${y.code}, ${x.code})`, { pure: x.pure && y.pure })); break; }
        case 'Equals2': { const y = pop(), x = pop(); push(new E(`$.eq(${x.code}, ${y.code})`, { bool: true, pure: x.pure && y.pure })); break; }
        case 'StrictEquals': { const y = pop(), x = pop(); push(new E(`(${x.code} === ${y.code})`, { bool: true, pure: x.pure && y.pure })); break; }
        case 'Not': { const x = pop(); push(new E(`!${B(x)}`, { bool: true, pure: x.pure })); break; }
        case 'And': { const y = pop(), x = pop(); push(new E(`(${B(x)} && ${B(y)})`, { bool: true, pure: x.pure && y.pure })); break; }
        case 'Or': { const y = pop(), x = pop(); push(new E(`(${B(x)} || ${B(y)})`, { bool: true, pure: x.pure && y.pure })); break; }
        case 'StringEquals': { const y = pop(), x = pop(); push(new E(`(${S(x)} === ${S(y)})`, { bool: true, pure: x.pure && y.pure })); break; }
        case 'StringLess': { const y = pop(), x = pop(); push(new E(`(${S(x)} < ${S(y)})`, { bool: true, pure: x.pure && y.pure })); break; }
        case 'StringGreater': { const y = pop(), x = pop(); push(new E(`(${S(x)} > ${S(y)})`, { bool: true, pure: x.pure && y.pure })); break; }
        case 'StringAdd': { const y = pop(), x = pop(); push(new E(`(${S(x)} + ${S(y)})`, { str: true, pure: x.pure && y.pure })); break; }
        case 'StringLength': case 'MBStringLength': { const x = pop(); push(new E(`${S(x)}.length`, { num: true, pure: x.pure })); break; }
        case 'StringExtract': case 'MBStringExtract': { const c = pop(), k = pop(), s = pop(); push(new E(`$.substr1(${s.code}, ${k.code}, ${c.code})`, { str: true, pure: s.pure && k.pure && c.pure })); break; }
        case 'CharToAscii': case 'MBCharToAscii': { const x = pop(); push(new E(`$.ord(${x.code})`, { num: true, pure: x.pure })); break; }
        case 'AsciiToChar': case 'MBAsciiToChar': { const x = pop(); push(new E(`$.chr(${x.code})`, { str: true, pure: x.pure })); break; }
        case 'RandomNumber': { const x = pop(); spill(); const t = newTmp(); emit(`${t} = $.random(${x.code});`); push(new E(t, { pure: true, num: true })); break; }
        case 'GetTime': { spill(); const t = newTmp(); emit(`${t} = $.getTimer();`); push(new E(t, { pure: true, num: true })); break; }
        case 'TypeOf': { const x = pop(); push(new E(`$.typeOf(${x.code})`, { str: true, pure: x.pure })); break; }
        case 'TargetPath': { const x = pop(); push(new E(`$.targetPath(${x.code})`, { pure: x.pure })); break; }
        case 'InstanceOf': { const c = pop(), o = pop(); push(new E(`$.instanceOf(${o.code}, ${c.code})`, { bool: true, pure: o.pure && c.pure })); break; }
        case 'CastOp': { const o = pop(), c = pop(); push(new E(`$.cast(${c.code}, ${o.code})`, { pure: o.pure && c.pure })); break; }
        case 'ImplementsOp': { const c = pop(); const n = pop(); const list = args(n); spill(); emit(`$.implementsOp(${c.code}, ${list});`); break; }
        case 'Extends': { const sup = pop(), sub = pop(); spill(); emit(`$.extends(${sub.code}, ${sup.code});`); break; }
        // ---------------------------------------------------------------- variables and members
        case 'GetVariable': {
          const n = pop();
          if (n.hasLit && n.lit === 'this') push(new E('$this'));
          else push(new E(`$.get(${SC}, ${n.code})`));
          break;
        }
        case 'SetVariable': { const v = pop(), n = pop(); spill(); emit(`$.set(${SC}, ${n.code}, ${v.code});`); break; }
        case 'DefineLocal': { const v = pop(), n = pop(); spill(); emit(`$.local(${SC}, ${n.code}, ${v.code});`); break; }
        case 'DefineLocal2': { const n = pop(); spill(); emit(`$.local2(${SC}, ${n.code});`); break; }
        case 'Delete': { const n = pop(), o = pop(); spill(); const t = newTmp(); emit(`${t} = $.deleteMember(${o.code}, ${n.code});`); push(new E(t, { pure: true, bool: true })); break; }
        case 'Delete2': { const n = pop(); spill(); const t = newTmp(); emit(`${t} = $.deleteVar(${SC}, ${n.code});`); push(new E(t, { pure: true, bool: true })); break; }
        case 'GetMember': { const n = pop(), o = pop(); push(new E(`$.gm(${o.code}, ${n.code})`)); break; }
        case 'SetMember': { const v = pop(), n = pop(), o = pop(); spill(); emit(`$.sm(${o.code}, ${n.code}, ${v.code});`); break; }
        case 'GetProperty': {
          const k = pop(), t = pop();
          const p = k.hasLit ? PROPS[k.lit | 0] : null;
          push(new E(p ? `$.getProp(${tgt()}, ${t.code}, ${Q(p)})` : `$.getPropIndex(${tgt()}, ${t.code}, ${k.code})`));
          break;
        }
        case 'SetProperty': {
          const v = pop(), k = pop(), t = pop();
          spill();
          const p = k.hasLit ? PROPS[k.lit | 0] : null;
          emit(p ? `$.setProp(${tgt()}, ${t.code}, ${Q(p)}, ${v.code});` : `$.setPropIndex(${tgt()}, ${t.code}, ${k.code}, ${v.code});`);
          break;
        }
        // ---------------------------------------------------------------- calls and objects
        case 'CallFunction': {
          const name = pop(), n = pop(); const a = args(n); spill();
          const t = newTmp(); emit(`${t} = $.callFunction(${SC}, ${name.code}, ${a});`); if (abortAfter(name)) emit(ABORT); push(new E(t, { pure: true })); break;
        }
        case 'CallMethod': {
          const name = pop(), obj = pop(), n = pop(); const a = args(n); spill();
          const t = newTmp(); emit(`${t} = $.callMethod(${obj.code}, ${name.code}, ${a});`); if (abortAfter(name)) emit(ABORT); push(new E(t, { pure: true })); break;
        }
        case 'NewObject': {
          const name = pop(), n = pop(); const a = args(n); spill();
          const t = newTmp(); emit(`${t} = $.newObject(${SC}, ${name.code}, ${a});`); if (abortAfter(name)) emit(ABORT); push(new E(t, { pure: true })); break;
        }
        case 'NewMethod': {
          const name = pop(), obj = pop(), n = pop(); const a = args(n); spill();
          const t = newTmp(); emit(`${t} = $.newMethod(${obj.code}, ${name.code}, ${a});`); if (abortAfter(name)) emit(ABORT); push(new E(t, { pure: true })); break;
        }
        case 'InitArray': {
          const n = pop(); const k = count(n);
          if (k === null) { const a = args(n); push(new E(`$.arr(${a})`)); st[st.length - 1] = freeze(st[st.length - 1]); break; }
          const items = popN(k);
          push(new E(`$.arr([${items.map((e) => e.code).join(', ')}])`));
          // array literal creates a new object each evaluation; make it a temp so it is created exactly once
          st[st.length - 1] = freeze(st[st.length - 1]);
          break;
        }
        case 'InitObject': {
          const n = pop(); const k = count(n);
          let pairs;
          if (k === null) { spill(); flush(); use.s = true; pairs = `$.popPairs($s, ${N(n)})`; }
          else { const p = []; for (let j = 0; j < k; j++) { const v = pop(), key = pop(); p.push(`${key.code}, ${v.code}`); } pairs = `[${p.join(', ')}]`; }
          spill();
          const t = newTmp(); emit(`${t} = $.initObject(${pairs});`); push(new E(t, { pure: true })); break;
        }
        case 'Enumerate': case 'Enumerate2': {
          const o = pop();
          spill();
          const target = ins.op === 'Enumerate' ? `$.get(${SC}, ${o.code})` : o.code;
          flush();
          use.s = true;
          emit(`$.enumerate($s, ${target});`);
          break;
        }
        case 'DefineFunction': case 'DefineFunction2': {
          const fnCode = compileFunction(ins, SC);
          if (ins.name) { spill(); emit(`$.local(${SC}, ${Q(ins.name)}, ${fnCode});`); }
          else push(new E(fnCode, { fn: true }));
          break;
        }
        case 'Return': { const v = pop(); emit(`return ${v.code};`); ended = true; break; }
        case 'Throw': { const v = pop(); emit(`throw $.wrapThrow(${v.code});`); ended = true; break; }
        case 'With': {
          const o = pop(); spill();
          const w = withs.find((x) => x.start === ins.next);
          decls.add(w.v);
          emit(`${w.v} = $.withScope(${SC}, ${o.code});`);
          break;
        }
        case 'Try': throw new Error('Try is not supported');
        // ---------------------------------------------------------------- timeline control
        case 'Play': spill(); emit(`$.play(${tgt()});`); break;
        case 'Stop': spill(); emit(`$.stop(${tgt()});`); break;
        case 'NextFrame': spill(); emit(`$.nextFrame(${tgt()});`); break;
        case 'PrevFrame': spill(); emit(`$.prevFrame(${tgt()});`); break;
        case 'GotoFrame': spill(); emit(`$.gotoFrame(${tgt()}, ${ins.frame + 1}, false);`); break;
        case 'GotoLabel': spill(); emit(`$.gotoFrame(${tgt()}, ${Q(ins.label)}, false);`); break;
        case 'GotoFrame2': { const f = pop(); spill(); emit(`$.gotoFrame2(${tgt()}, ${f.code}, ${ins.flags & 1 ? 'true' : 'false'}, ${ins.bias || 0});`); break; }
        case 'SetTarget':
          spill(); use.tgt = true;
          if (ins.target === '') emit('$tgt = $u.base; $sc = $u.sc;');
          else emit(`$tgt = $.findTarget($u, ${Q(ins.target)}); $sc = $.targetScope($u, $tgt);`);
          break;
        case 'SetTarget2': { const t = pop(); spill(); use.tgt = true; emit(`$tgt = $.findTarget2($u, ${t.code}); $sc = $.targetScope($u, $tgt);`); break; }
        case 'Call': { const f = pop(); spill(); emit(`$.callFrame(${tgt()}, ${f.code});`); emit(ABORT); break; }
        case 'WaitForFrame': case 'WaitForFrame2': if (ins.op === 'WaitForFrame2') pop(); break; // everything is loaded
        case 'StopSounds': spill(); emit('$.stopAllSounds();'); break;
        case 'ToggleQuality': break;
        case 'CloneSprite': { const d = pop(), n = pop(), s = pop(); spill(); emit(`$.cloneSprite(${tgt()}, ${s.code}, ${n.code}, ${d.code});`); break; }
        case 'RemoveSprite': { const s = pop(); spill(); emit(`$.removeSprite(${tgt()}, ${s.code});`); break; }
        case 'StartDrag': {
          const t = pop(), lock = pop(), cons = pop();
          let box = 'null';
          if (cons.hasLit) { if ($bool(cons.lit)) { const y2 = pop(), x2 = pop(), y1 = pop(), x1 = pop(); box = `[${x1.code}, ${y1.code}, ${x2.code}, ${y2.code}]`; } }
          else throw new Error('dynamic StartDrag constraint');
          spill(); emit(`$.startDrag(${tgt()}, ${t.code}, ${lock.code}, ${box});`); break;
        }
        case 'EndDrag': spill(); emit('$.stopDrag();'); break;
        case 'Trace': { const x = pop(); spill(); emit(`$.trace(${x.code});`); break; }
        case 'GetURL': spill(); emit(`$.getURL(${Q(ins.url)}, ${Q(ins.target)});`); break;
        case 'GetURL2': { const t = pop(), u = pop(); spill(); emit(`$.getURL2(${u.code}, ${t.code}, ${ins.flags});`); break; }
        case 'FSCommand2': { const n = pop(); const a = args(n); spill(); emit(`$.fscommand2(${a});`); break; }
        // ---------------------------------------------------------------- control flow
        case 'Jump': {
          const target = blockOfIdx(resolve(ins.target));
          spill(); flush();
          emit(goto_(target));
          ended = true;
          break;
        }
        case 'If': {
          const c = pop();
          const target = blockOfIdx(resolve(ins.target));
          const fall = blockOfIdx(i + 1);
          let cond = B(c);
          if (st.length) {
            spill();
            if (!c.pure) { const t = newTmp(); emit(`${t} = ${cond};`); cond = t; }
            flush();
          }
          emit(`if (${cond}) { ${goto_(target)} }`);
          emit(goto_(fall));
          ended = true;
          break;
        }
        default: throw new Error('unsupported op ' + ins.op + ' at ' + ins.pos);
      }
    }
    if (!ended) {
      const next = blockOfIdx(e0);
      spill(); flush();
      emit(goto_(next));
    }
    out.set(b, lines);
  }

  // ---- assemble
  const lines = [];
  const bids = [...out.keys()].sort((a, b) => a - b);
  if (bids.length <= 1) {
    const l = bids.length ? out.get(bids[0]) : [];
    // straight-line: drop the final "goto exit"
    for (const x of l) if (!/^\$b = \d+; continue;$/.test(x)) lines.push(x.replace(/^if \((.*)\) \{ \$b = \d+; continue; \}$/, '/* if ($1) */'));
  } else {
    lines.push('var $b = 0;');
    lines.push('for (;;) switch ($b) {');
    for (const b of bids) {
      lines.push(`case ${b}:`);
      for (const l of out.get(b)) lines.push('  ' + l);
    }
    lines.push(`default: return;`);
    lines.push('}');
  }
  const head = [];
  if (decls.size) head.push(`var ${[...decls].join(', ')};`);
  if (use.s) head.push('var $s = [];');
  if (use.r && kind !== 'fn') head.push('var $r = [];');
  return { lines: head.concat(lines), use };

  function compileFunction(f, scopeVar) {
    const sub = compileUnit(f.body, 'fn');
    const spec = { n: f.name || '', p: f.params, r: f.regCount || 0, f: f.flags || 0, v2: !!f.v2 };
    const pre = [];
    pre.push('var $u = { sc: $sc, tgt: $tgt, base: $tgt, this: $this };');
    const inner = pre.concat(sub.lines).map((l) => '  ' + l).join('\n');
    // The generated function receives its activation scope, this, the arguments array and its
    // registers; its target clip (for gotoAndPlay etc.) is the clip the function was defined in.
    return `$.fn(${JSON.stringify(spec)}, ${scopeVar}, $base, function ($sc, $this, $args, $r, $tgt, $base) {\n${inner}\n})`;
  }
}
function $bool(v) { return typeof v === 'number' ? v !== 0 && !Number.isNaN(v) : typeof v === 'string' ? v.length > 0 : !!v; }

// Scripts: S[id] = function ($sc, $this) where $sc is the clip scope and $this the clip.
export function transpileScript(bytes, id, where) {
  const instrs = decode(bytes);
  const { lines } = compileUnit(instrs, 'script');
  const pre = ['var $tgt = $this, $base = $this;', 'var $u = { sc: $sc, tgt: $tgt, base: $this, this: $this };'];
  const bodyLines = pre.concat(lines).map((l) => '  ' + l).join('\n');
  return `// ${where}\nS[${id}] = function ($sc, $this) {\n${bodyLines}\n};\n`;
}
