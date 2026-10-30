// Collect every AVM1 code blob in the movie with a description of where it lives.
import fs from 'node:fs';
export function collectScripts(movie) {
  const out = [];
  const b = (x) => Uint8Array.from(Buffer.from(x.$b64, 'base64'));
  function tl(tags, where) {
    let f = 1;
    for (const t of tags) {
      if (t.type === 31) out.push({ where: `${where}#f${f}`, kind: 'frame', bytes: b(t.actions) });
      if (t.type === 32) out.push({ where: `init${t.spriteId}`, kind: 'init', bytes: b(t.actions) });
      if (t.type === 49 && t.clipActions) for (const c of t.clipActions) out.push({ where: `${where}#f${f}#d${t.depth}#clip`, kind: 'clip', ev: c.events, bytes: b(c.actions) });
      if (t.type === 58) f++;
      if (t.type === 24) tl(t.tags, 'sprite' + t.id);
      if (t.type === 6 && t.actions) for (const a of t.actions) out.push({ where: 'button' + t.id, kind: 'button', bytes: b(a.actions) });
    }
  }
  tl(movie.tags, 'main');
  return out;
}
