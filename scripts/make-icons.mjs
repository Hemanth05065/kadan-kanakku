// Generates the PWA PNG icons (mic on green) with no image dependencies.
// Usage: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const GREEN = [15, 81, 50];
const SAFFRON = [245, 158, 11];
const WHITE = [255, 250, 240];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed-distance helpers in unit space (0..1)
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCapsule = (x, y, cx, y0, y1, r) => {
  const py = Math.min(Math.max(y, y0), y1);
  return Math.hypot(x - cx, y - py) - r;
};

function shape(u, v, { rounded, scale }) {
  // background
  const bg = rounded ? sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22) : -1;
  if (bg > 0) return null;
  // glyph in scaled space around centre
  const x = 0.5 + (u - 0.5) / scale, y = 0.5 + (v - 0.5) / scale;
  const mic = sdCapsule(x, y, 0.5, 0.27, 0.47, 0.11);
  const ringD = Math.abs(Math.hypot(x - 0.5, y - 0.47) - 0.19) - 0.028;
  const ring = y > 0.47 ? ringD : 1;
  const stem = sdRoundRect(x, y, 0.5, 0.7, 0.028, 0.05, 0.01);
  const base = sdRoundRect(x, y, 0.5, 0.765, 0.13, 0.026, 0.026);
  const glyph = Math.min(mic, ring, stem, base);
  if (glyph < 0) return mic < 0 && y > 0.39 && y < 0.43 ? SAFFRON : WHITE;
  return GREEN;
}

function render(size, opts) {
  const SS = 4;
  return png(size, (px, py) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = shape((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
    }
    const n = SS * SS, cov = a / 255;
    return cov ? [Math.round(r / cov), Math.round(g / cov), Math.round(b / cov), Math.round(a / n)] : [0, 0, 0, 0];
  });
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192.png', render(192, { rounded: true, scale: 1 }));
writeFileSync('public/icon-512.png', render(512, { rounded: true, scale: 1 }));
writeFileSync('public/icon-maskable-512.png', render(512, { rounded: false, scale: 0.78 }));
writeFileSync('public/apple-touch-icon.png', render(180, { rounded: false, scale: 0.85 }));
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0f5132"/><rect x="39" y="16" width="22" height="42" rx="11" fill="#fffaf0"/><rect x="39" y="39" width="22" height="4" fill="#f59e0b"/><path d="M31 47a19 19 0 0 0 38 0" fill="none" stroke="#fffaf0" stroke-width="5.6" stroke-linecap="round"/><rect x="47" y="65" width="6" height="10" fill="#fffaf0"/><rect x="37" y="74" width="26" height="5" rx="2.5" fill="#fffaf0"/></svg>`
);
console.log('icons written to public/');
