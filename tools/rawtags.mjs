// Minimal SWF container reader: returns the raw bodies of the top-level tags.
import zlib from 'node:zlib';
export function rawTags(file) {
  let b = file;
  const sig = String.fromCharCode(b[0], b[1], b[2]);
  if (sig === 'CWS') b = Buffer.concat([b.subarray(0, 8), zlib.inflateSync(b.subarray(8))]);
  else if (sig !== 'FWS') throw new Error('unsupported SWF signature ' + sig);
  let p = 8;
  const nbits = b[p] >> 3;
  p += Math.ceil((5 + 4 * nbits) / 8) + 4;
  const tags = [];
  while (p < b.length) {
    const h = b.readUInt16LE(p); p += 2;
    const code = h >> 6;
    let len = h & 63;
    if (len === 63) { len = b.readUInt32LE(p); p += 4; }
    tags.push({ code, body: b.subarray(p, p + len) });
    p += len;
    if (code === 0) break;
  }
  return tags;
}
