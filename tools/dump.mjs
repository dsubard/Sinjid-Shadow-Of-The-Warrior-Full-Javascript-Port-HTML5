import fs from 'node:fs';
import { parseSwf } from 'swf-parser';
const movie = parseSwf(new Uint8Array(fs.readFileSync(process.argv[2])));
const rep = (k, v) => v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : (typeof v === 'bigint' ? Number(v) : v);
fs.writeFileSync(process.argv[3], JSON.stringify(movie, rep));
console.log('tags', movie.tags.length, JSON.stringify(movie.header));
