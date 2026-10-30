"""Extract bitmaps and sounds from work/movie.json into out/assets.

Bitmaps become PNG (lossless) or JPEG files; sounds become MP3 (the SWF MP3 data is re-encoded
at a standard sample rate so every browser can play it; ADPCM sounds are decoded first)."""
import base64, io, json, os, struct, subprocess, sys, tempfile, wave, zlib
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
movie = json.load(open(os.path.join(ROOT, 'work', 'movie.json')))
OUT = os.path.join(ROOT, 'out', 'assets')
os.makedirs(os.path.join(OUT, 'img'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'snd'), exist_ok=True)
raw = lambda x: base64.b64decode(x['$b64'])
index = {'images': {}, 'sounds': {}}


def lossless(d, alpha):
    fmt = d[0]
    w, h = struct.unpack('<HH', d[1:5])
    if fmt == 3:
        n = d[5] + 1
        data = zlib.decompress(d[6:])
        bpp = 4 if alpha else 3
        pal = [tuple(data[i * bpp:(i + 1) * bpp]) for i in range(n)]
        stride = (w + 3) & ~3
        px = bytearray()
        base = n * bpp
        for y in range(h):
            for x in range(w):
                i = data[base + y * stride + x]
                p = pal[i] if i < n else (0, 0, 0, 0)
                px += bytes(p if alpha else p + (255,))
        im = Image.frombytes('RGBA', (w, h), bytes(px))
    elif fmt == 5:
        data = zlib.decompress(d[5:])
        px = bytearray(w * h * 4)
        for k in range(w * h):
            a, r, g, b = data[k * 4:k * 4 + 4]
            if not alpha:
                a = 255
            elif 0 < a < 255:  # premultiplied
                r, g, b = min(255, r * 255 // a), min(255, g * 255 // a), min(255, b * 255 // a)
            px[k * 4:k * 4 + 4] = bytes((r, g, b, a))
        im = Image.frombytes('RGBA', (w, h), bytes(px))
    elif fmt == 4:
        data = zlib.decompress(d[5:])
        stride = ((w * 2) + 3) & ~3
        px = bytearray()
        for y in range(h):
            for x in range(w):
                v = struct.unpack('>H', data[y * stride + x * 2:y * stride + x * 2 + 2])[0]
                px += bytes((((v >> 10) & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, (v & 31) * 255 // 31, 255))
        im = Image.frombytes('RGBA', (w, h), bytes(px))
    else:
        raise ValueError('lossless format %d' % fmt)
    return im


def fix_jpeg(d):
    # Flash writes an erroneous EOI/SOI pair in front of some JPEGs
    while d[:4] == b'\xff\xd9\xff\xd8':
        d = d[4:]
    return d


# ---------------------------------------------------------------- ADPCM
STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
         118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
         1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
         6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767]
INDEX_TABLES = {2: [-1, 2], 3: [-1, -1, 2, 4], 4: [-1, -1, -1, -1, 2, 4, 6, 8],
                5: [-1, -1, -1, -1, -1, -1, -1, -1, 1, 2, 4, 6, 8, 10, 13, 16]}


class BitReader:
    def __init__(self, b):
        self.b, self.p = b, 0

    def ub(self, n):
        v = 0
        for _ in range(n):
            byte = self.b[self.p >> 3] if (self.p >> 3) < len(self.b) else 0
            v = (v << 1) | ((byte >> (7 - (self.p & 7))) & 1)
            self.p += 1
        return v

    def sb(self, n):
        v = self.ub(n)
        return v - (1 << n) if v & (1 << (n - 1)) else v

    def left(self):
        return len(self.b) * 8 - self.p


def adpcm_decode(d, channels, total):
    r = BitReader(d)
    bits = r.ub(2) + 2
    table = INDEX_TABLES[bits]
    sign = 1 << (bits - 1)
    out = [[] for _ in range(channels)]
    while len(out[0]) < total and r.left() >= 22 * channels:
        state = []
        for c in range(channels):
            s = r.sb(16)
            i = r.ub(6)
            out[c].append(s)
            state.append([s, i])
        n = 1
        while n < 4096 and len(out[0]) < total and r.left() >= bits * channels:
            for c in range(channels):
                code = r.ub(bits)
                s, i = state[c]
                step = STEPS[i]
                diff = step >> (bits - 1)
                k = sign >> 1
                while k:
                    if code & k:
                        diff += step
                    step >>= 1
                    k >>= 1
                s = s - diff if code & sign else s + diff
                s = max(-32768, min(32767, s))
                i = max(0, min(88, i + table[code & (sign - 1)]))
                state[c] = [s, i]
                out[c].append(s)
            n += 1
    return out


RATES = [5512, 11025, 22050, 44100]
for t in movie['tags']:
    if t['type'] == 5:
        i = t['id']
        d = raw(t['data'])
        mt = t['mediaType']
        if mt in ('image/jpeg', 'image/x-swf-partial-jpeg'):
            open(os.path.join(OUT, 'img', '%d.jpg' % i), 'wb').write(fix_jpeg(d))
            im = Image.open(io.BytesIO(fix_jpeg(d)))
            index['images'][i] = {'file': 'assets/img/%d.jpg' % i, 'w': im.size[0], 'h': im.size[1]}
        elif mt == 'image/x-swf-jpeg3':
            jl = struct.unpack('<I', d[:4])[0]
            im = Image.open(io.BytesIO(fix_jpeg(d[4:4 + jl]))).convert('RGBA')
            a = zlib.decompress(d[4 + jl:])
            im.putalpha(Image.frombytes('L', im.size, a[:im.size[0] * im.size[1]]))
            im.save(os.path.join(OUT, 'img', '%d.png' % i))
            index['images'][i] = {'file': 'assets/img/%d.png' % i, 'w': im.size[0], 'h': im.size[1]}
        elif mt in ('image/x-swf-lossless1', 'image/x-swf-lossless2'):
            im = lossless(d, mt.endswith('2'))
            im.save(os.path.join(OUT, 'img', '%d.png' % i))
            index['images'][i] = {'file': 'assets/img/%d.png' % i, 'w': im.size[0], 'h': im.size[1]}
        else:
            print('unsupported bitmap', i, mt)
    elif t['type'] == 23:
        i = t['id']
        d = raw(t['data'])
        rate = t['soundRate']
        stereo = t['soundType'] == 1
        dst = os.path.join(OUT, 'snd', '%d.mp3' % i)
        with tempfile.TemporaryDirectory() as tmp:
            if t['format'] == 2:  # MP3: 2-byte seek-samples prefix
                src = os.path.join(tmp, 'a.mp3')
                open(src, 'wb').write(d[2:])
            elif t['format'] == 1:
                ch = adpcm_decode(d, 2 if stereo else 1, t['sampleCount'])
                src = os.path.join(tmp, 'a.wav')
                w = wave.open(src, 'wb')
                w.setnchannels(len(ch)); w.setsampwidth(2)
                w.setframerate(min(RATES, key=lambda r: abs(r - rate)))
                frames = bytearray()
                for k in range(len(ch[0])):
                    for c in ch:
                        frames += struct.pack('<h', c[k])
                w.writeframes(bytes(frames)); w.close()
            elif t['format'] in (0, 3):  # uncompressed PCM
                src = os.path.join(tmp, 'a.wav')
                w = wave.open(src, 'wb')
                w.setnchannels(2 if stereo else 1); w.setsampwidth(2 if t['soundSize'] == 16 else 1)
                w.setframerate(min(RATES, key=lambda r: abs(r - rate))); w.writeframes(d); w.close()
            else:
                print('unsupported sound format', i, t['format'])
                continue
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-ar', '44100', '-ac', '2' if stereo else '1',
                            '-b:a', '128k' if stereo else '96k', dst], check=True)
        index['sounds'][i] = {'file': 'assets/snd/%d.mp3' % i, 'samples': t['sampleCount'], 'rate': rate}
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'))
print(len(index['images']), 'images,', len(index['sounds']), 'sounds')
