// work/scripts.json -> out/data/scripts.js
import fs from 'node:fs';
import { transpileScript, STRINGS } from './transpile.mjs';
import { applyFixes } from './fixes.mjs';
const ROOT = new URL('..', import.meta.url).pathname;
const scripts = JSON.parse(fs.readFileSync(ROOT + 'work/scripts.json', 'utf8'));
let out = '// ActionScript of "Sinjid: Shadow of the Warrior", transpiled from the original SWF bytecode by tools/transpile.mjs.\n// S[n] is a frame script, clip event or button action; the numbers are referenced from data/library.js.\nvar S = [];\n';
let ok = 0, fail = 0;
for (const s of scripts) {
  try {
    out += transpileScript(Uint8Array.from(Buffer.from(s.b64, 'base64')), s.id, s.where);
    ok++;
  } catch (e) {
    fail++;
    console.log('FAIL', s.id, s.where, e.message);
    out += `// ${s.where}\nS[${s.id}] = function () { throw new Error(${JSON.stringify('transpile failure: ' + e.message)}); };\n`;
  }
}
out = applyFixes(out);
// identifiers used by the code (the runtime needs them for SWF6 case-insensitive name lookup)
out += 'var STRINGS = ' + JSON.stringify([...STRINGS].filter((x) => x.length < 60)) + ';\n';
fs.mkdirSync(ROOT + 'out/data', { recursive: true });
fs.writeFileSync(ROOT + 'out/data/scripts.js', out);
console.log('ok', ok, 'fail', fail, (out.length / 1024).toFixed(0) + ' KB');
