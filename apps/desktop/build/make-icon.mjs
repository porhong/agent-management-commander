// Generates `icon.ico` (and `icon.png` for Linux) from the app's own palette, so the icon can
// never drift from the design tokens by hand-editing. Run: `node build/make-icon.mjs`.
//
// The mark is three stacked bars in the kind colours — agent, skill, command — on the app's
// dark surface: one library, several kinds. It stays legible at 16px because it is three shapes.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;

/** The same oklch tokens as `index.css`, converted once to sRGB. */
const BACKGROUND = [24, 24, 27];
const BARS = [
  [167, 139, 250], // --kind-agent
  [217, 165, 96], // --kind-skill
  [96, 165, 250], // --kind-command
];

/** Straight-alpha RGBA canvas of the mark at `size`×`size`. */
function draw(size) {
  const px = new Uint8Array(size * size * 4);
  const r = Math.round(size * 0.22); // corner radius
  const inset = Math.round(size * 0.18);
  const barH = Math.round(size * 0.115);
  const gap = Math.round(size * 0.075);
  const top = Math.round((size - (3 * barH + 2 * gap)) / 2);

  const set = (x, y, [red, green, blue], a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = red;
    px[i + 1] = green;
    px[i + 2] = blue;
    px[i + 3] = a;
  };

  // Rounded square background.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x, x - (size - 1 - r), 0);
      const dy = Math.max(r - y, y - (size - 1 - r), 0);
      if (dx * dx + dy * dy <= r * r) set(x, y, BACKGROUND);
    }
  }

  // Three bars, each shorter than the last, so the shape reads as a stack and not a flag.
  BARS.forEach((colour, index) => {
    const y0 = top + index * (barH + gap);
    const width = size - inset * 2 - Math.round(index * size * 0.1);
    const radius = Math.floor(barH / 2);
    for (let y = y0; y < y0 + barH; y++) {
      for (let x = inset; x < inset + width; x++) {
        const dx = Math.max(inset + radius - x, x - (inset + width - 1 - radius), 0);
        const dy = Math.max(y0 + radius - y, y - (y0 + barH - 1 - radius), 0);
        if (dx * dx + dy * dy <= radius * radius) set(x, y, colour);
      }
    }
  });

  return px;
}

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Minimal PNG: one IHDR, one IDAT of filter-0 scanlines, one IEND. */
function png(size) {
  const pixels = draw(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO carrying PNG payloads, which Windows has understood since Vista. */
function ico(sizes) {
  const images = sizes.map((size) => ({ size, data: png(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32BE(0, 8);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

writeFileSync(join(HERE, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
writeFileSync(join(HERE, 'icon.png'), png(512));
process.stdout.write('wrote build/icon.ico and build/icon.png\n');
