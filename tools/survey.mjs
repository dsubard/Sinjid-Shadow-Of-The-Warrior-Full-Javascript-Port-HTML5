import fs from 'node:fs';
import { decode } from './avm1.mjs';
import { collectScripts } from './collect.mjs';
const movie = JSON.parse(fs.readFileSync('work/movie.json', 'utf8'));
const scripts = collectScripts(movie);
const ops = {}, strs = new Map(); let bytes = 0, err = 0; const kinds = {};
function scan(list) { for (const i of list) { ops[i.op] = (ops[i.op] || 0) + 1; if (i.values) for (const v of i.values) if (v.t === 'str') strs.set(v.v, (strs.get(v.v) || 0) + 1); if (i.body) scan(i.body); } }
for (const s of scripts) { kinds[s.kind] = (kinds[s.kind] || 0) + 1; bytes += s.bytes.length; try { scan(decode(s.bytes)); } catch (e) { err++; console.log('ERR', s.where, e.message); } }
console.log(scripts.length, 'scripts', bytes, 'bytes', kinds, 'errors', err);
console.log(Object.entries(ops).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' '));
fs.writeFileSync('work/strings.txt', [...strs.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => c + '\t' + JSON.stringify(s)).join('\n'));
const evs = {}; for (const s of scripts) if (s.ev) for (const [k, v] of Object.entries(s.ev)) if (v) evs[k] = (evs[k] || 0) + 1; console.log('clip events', evs);
