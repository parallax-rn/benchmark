// The colour of one pixel of a PNG (T4's check reads a dot that has no text): 8-bit RGB or RGBA, not interlaced, as `simctl io screenshot` writes.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width, height, depth, type, interlace;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') [width, height, depth, type, interlace] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8], data[9], data[12]];
    if (kind === 'IDAT') idat.push(data);
    if (kind === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || ![2, 6].includes(type) || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      px[y * stride + x] = (line[x] + [0, a, b, (a + b) >> 1, paeth][f]) & 0xff;
    }
  }
  return { width, height, at: (x, y) => [...px.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] };
}

export const hex = rgb => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
const parse = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
/** The largest channel difference between two colours. */
export const colorDistance = (a, b) => Math.max(...parse(a).map((v, i) => Math.abs(v - parse(b)[i])));
