import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function icon(size, tray) {
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xx = (x + .5) / size - .5, yy = (y + .5) / size - .5;
    const r = Math.hypot(xx, yy), angle = Math.atan2(yy, xx);
    const hexRadius = .35 * Math.cos(Math.PI / 6) / Math.cos(((angle + Math.PI * 4) % (Math.PI / 3)) - Math.PI / 6);
    const ring = Math.abs(r - hexRadius) < .024;
    const stem = Math.abs(xx + .055) < .019 && yy > -.12 && yy < .13;
    const branch = Math.abs(yy + xx - .02) < .024 && xx > -.05 && xx < .12;
    const dot = Math.hypot(xx + .055, yy - .13) < .038 || Math.hypot(xx + .055, yy + .12) < .038 || Math.hypot(xx - .12, yy + .10) < .038;
    const mark = ring || stem || branch || dot;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    if (tray) { scanlines[offset + 3] = mark ? 255 : 0; }
    else {
      const bg = Math.max(Math.abs(xx), Math.abs(yy)) < .40 || Math.hypot(Math.max(Math.abs(xx) - .30, 0), Math.max(Math.abs(yy) - .30, 0)) < .18;
      scanlines[offset] = mark ? 184 : 27;
      scanlines[offset + 1] = mark ? 226 : 89;
      scanlines[offset + 2] = mark ? 201 : 73;
      scanlines[offset + 3] = bg ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
await writeFile('dist/tray.png', icon(64, true));
await writeFile('dist/icon.png', icon(512, false));
