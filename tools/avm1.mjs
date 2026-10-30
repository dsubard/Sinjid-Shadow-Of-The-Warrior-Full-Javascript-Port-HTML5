// AVM1 (ActionScript 1/2) bytecode decoder.
// decode(bytes) -> list of instructions { pos, next, op, code, ...operands }.
// DefineFunction/DefineFunction2 bodies are decoded recursively into `body` (positions relative to the body).
// With/Try blocks keep their byte sizes so the transpiler can find the block ends.

export const OPS = {
  0x00: 'End', 0x04: 'NextFrame', 0x05: 'PrevFrame', 0x06: 'Play', 0x07: 'Stop', 0x08: 'ToggleQuality', 0x09: 'StopSounds',
  0x0a: 'Add', 0x0b: 'Subtract', 0x0c: 'Multiply', 0x0d: 'Divide', 0x0e: 'Equals', 0x0f: 'Less', 0x10: 'And', 0x11: 'Or',
  0x12: 'Not', 0x13: 'StringEquals', 0x14: 'StringLength', 0x15: 'StringExtract', 0x17: 'Pop', 0x18: 'ToInteger',
  0x1c: 'GetVariable', 0x1d: 'SetVariable', 0x20: 'SetTarget2', 0x21: 'StringAdd', 0x22: 'GetProperty', 0x23: 'SetProperty',
  0x24: 'CloneSprite', 0x25: 'RemoveSprite', 0x26: 'Trace', 0x27: 'StartDrag', 0x28: 'EndDrag', 0x29: 'StringLess',
  0x2a: 'Throw', 0x2b: 'CastOp', 0x2c: 'ImplementsOp', 0x2d: 'FSCommand2', 0x30: 'RandomNumber', 0x31: 'MBStringLength',
  0x32: 'CharToAscii', 0x33: 'AsciiToChar', 0x34: 'GetTime', 0x35: 'MBStringExtract', 0x36: 'MBCharToAscii',
  0x37: 'MBAsciiToChar', 0x3a: 'Delete', 0x3b: 'Delete2', 0x3c: 'DefineLocal', 0x3d: 'CallFunction', 0x3e: 'Return',
  0x3f: 'Modulo', 0x40: 'NewObject', 0x41: 'DefineLocal2', 0x42: 'InitArray', 0x43: 'InitObject', 0x44: 'TypeOf',
  0x45: 'TargetPath', 0x46: 'Enumerate', 0x47: 'Add2', 0x48: 'Less2', 0x49: 'Equals2', 0x4a: 'ToNumber', 0x4b: 'ToString',
  0x4c: 'PushDuplicate', 0x4d: 'StackSwap', 0x4e: 'GetMember', 0x4f: 'SetMember', 0x50: 'Increment', 0x51: 'Decrement',
  0x52: 'CallMethod', 0x53: 'NewMethod', 0x54: 'InstanceOf', 0x55: 'Enumerate2', 0x60: 'BitAnd', 0x61: 'BitOr',
  0x62: 'BitXor', 0x63: 'BitLShift', 0x64: 'BitRShift', 0x65: 'BitURShift', 0x66: 'StrictEquals', 0x67: 'Greater',
  0x68: 'StringGreater', 0x69: 'Extends',
  0x81: 'GotoFrame', 0x83: 'GetURL', 0x87: 'StoreRegister', 0x88: 'ConstantPool', 0x8a: 'WaitForFrame', 0x8b: 'SetTarget',
  0x8c: 'GotoLabel', 0x8d: 'WaitForFrame2', 0x8e: 'DefineFunction2', 0x8f: 'Try', 0x94: 'With', 0x96: 'Push', 0x99: 'Jump',
  0x9a: 'GetURL2', 0x9b: 'DefineFunction', 0x9d: 'If', 0x9e: 'Call', 0x9f: 'GotoFrame2',
};

// SWF 6 strings are UTF-8; older files may contain latin-1 bytes. Fall back when the bytes are not valid UTF-8.
const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');
function cstr(buf, off) {
  let e = off;
  while (e < buf.length && buf[e] !== 0) e++;
  const sub = buf.subarray(off, e);
  let s;
  try { s = utf8.decode(sub); } catch { s = latin1.decode(sub); }
  return [s, e + 1];
}

export function decode(buf, pool0 = []) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = [];
  let pos = 0;
  let pool = pool0;
  while (pos < buf.length) {
    const start = pos;
    const code = buf[pos++];
    if (code === 0) { out.push({ pos: start, next: pos, op: 'End', code }); break; }
    let len = 0;
    if (code >= 0x80) { len = dv.getUint16(pos, true); pos += 2; }
    const d = pos;
    const ins = { pos: start, op: OPS[code] || 'Unknown', code };
    let next = d + len;
    switch (code) {
      case 0x81: ins.frame = dv.getUint16(d, true); break;
      case 0x83: { const [u, e] = cstr(buf, d); ins.url = u; ins.target = cstr(buf, e)[0]; break; }
      case 0x87: ins.reg = buf[d]; break;
      case 0x88: {
        const n = dv.getUint16(d, true);
        let o = d + 2;
        pool = [];
        for (let i = 0; i < n; i++) { const [s, e] = cstr(buf, o); pool.push(s); o = e; }
        ins.pool = pool;
        break;
      }
      case 0x8a: ins.frame = dv.getUint16(d, true); ins.skip = buf[d + 2]; break;
      case 0x8b: ins.target = cstr(buf, d)[0]; break;
      case 0x8c: ins.label = cstr(buf, d)[0]; break;
      case 0x8d: ins.skip = buf[d]; break;
      case 0x96: {
        const vals = [];
        let o = d;
        while (o < d + len) {
          const t = buf[o++];
          switch (t) {
            case 0: { const [s, e] = cstr(buf, o); vals.push({ t: 'str', v: s }); o = e; break; }
            case 1: vals.push({ t: 'num', v: dv.getFloat32(o, true) }); o += 4; break;
            case 2: vals.push({ t: 'null' }); break;
            case 3: vals.push({ t: 'undef' }); break;
            case 4: vals.push({ t: 'reg', v: buf[o++] }); break;
            case 5: vals.push({ t: 'bool', v: buf[o++] !== 0 }); break;
            case 6: { // double, stored as two little-endian 32-bit halves, high word first
              const hi = dv.getUint32(o, true), lo = dv.getUint32(o + 4, true);
              const tmp = new DataView(new ArrayBuffer(8));
              tmp.setUint32(0, lo, true); tmp.setUint32(4, hi, true);
              vals.push({ t: 'num', v: tmp.getFloat64(0, true) }); o += 8; break;
            }
            case 7: vals.push({ t: 'num', v: dv.getInt32(o, true) }); o += 4; break;
            case 8: { const i = buf[o++]; vals.push({ t: 'str', v: pool[i] }); break; }
            case 9: { const i = dv.getUint16(o, true); o += 2; vals.push({ t: 'str', v: pool[i] }); break; }
            default: throw new Error('bad push type ' + t + ' at ' + start);
          }
        }
        ins.values = vals;
        break;
      }
      case 0x99: case 0x9d: ins.offset = dv.getInt16(d, true); ins.target = d + 2 + ins.offset; break;
      case 0x9a: ins.flags = buf[d]; break;
      case 0x9f: ins.flags = buf[d]; if (ins.flags & 2) ins.bias = dv.getUint16(d + 1, true); break;
      case 0x94: ins.size = dv.getUint16(d, true); ins.blockEnd = next + ins.size; break;
      case 0x8f: {
        const flags = buf[d];
        ins.catchInReg = !!(flags & 4);
        ins.hasCatch = !!(flags & 1);
        ins.hasFinally = !!(flags & 2);
        ins.trySize = dv.getUint16(d + 1, true);
        ins.catchSize = dv.getUint16(d + 3, true);
        ins.finallySize = dv.getUint16(d + 5, true);
        if (ins.catchInReg) ins.catchReg = buf[d + 7]; else ins.catchName = cstr(buf, d + 7)[0];
        ins.tryStart = next;
        ins.catchStart = next + ins.trySize;
        ins.finallyStart = ins.catchStart + ins.catchSize;
        ins.blockEnd = ins.finallyStart + ins.finallySize;
        break;
      }
      case 0x9b: {
        let [name, o] = cstr(buf, d);
        const n = dv.getUint16(o, true); o += 2;
        const params = [];
        for (let i = 0; i < n; i++) { const [s, e] = cstr(buf, o); params.push([0, s]); o = e; }
        const size = dv.getUint16(o, true); o += 2;
        Object.assign(ins, { name, params, regCount: 0, flags: 0, v2: false });
        ins.body = decode(buf.subarray(next, next + size), pool);
        next += size;
        break;
      }
      case 0x8e: {
        let [name, o] = cstr(buf, d);
        const n = dv.getUint16(o, true); o += 2;
        const regCount = buf[o++];
        const flags = dv.getUint16(o, true); o += 2;
        const params = [];
        for (let i = 0; i < n; i++) { const reg = buf[o++]; const [s, e] = cstr(buf, o); params.push([reg, s]); o = e; }
        const size = dv.getUint16(o, true); o += 2;
        Object.assign(ins, { name, params, regCount, flags, v2: true });
        ins.body = decode(buf.subarray(next, next + size), pool);
        next += size;
        break;
      }
      default: break;
    }
    ins.next = next;
    pos = next;
    out.push(ins);
  }
  return out;
}
