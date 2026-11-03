// Minimal ZIP reader and writer (stored and deflate entries), enough for project archives:
// teachers hand out BlueJ projects as .zip, students hand them back in the same way.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_TOTAL = 300 * 1024 * 1024;
const MAX_ENTRIES = 20000;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const bad = (message) => Object.assign(new Error(message), { code: 'badZip' });

/** Entries of a zip archive: [{ name, dir, data() }]. Names use forward slashes. */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw bad('zip64 is not supported');
  if (count > MAX_ENTRIES) throw bad('too many files');
  const entries = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad('broken central directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? rawName.toString('utf8') : rawName.toString('latin1')).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    total += usize;
    if (total > MAX_TOTAL) throw bad('archive too large');
    if (flags & 1) throw bad('encrypted archives are not supported');
    entries.push({
      name,
      dir: name.endsWith('/'),
      size: usize,
      data() {
        if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw bad('broken entry');
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + size);
        let out;
        if (method === 0) out = raw;
        else if (method === 8) out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) });
        else throw bad('unsupported compression');
        if (crc32(out) !== crc) throw bad('checksum mismatch');
        return out;
      },
    });
  }
  return entries;
}

/** Path inside dest for an archive entry, or null when the entry must be skipped. */
function targetOf(dest, name) {
  const parts = name.split('/').filter((s) => s && s !== '.');
  if (!parts.length || parts.some((s) => s === '..' || /[<>:"|?*\x00-\x1f]/.test(s))) return null;
  if (parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store') return null;
  if (/^[A-Za-z]:/.test(parts[0])) return null;
  const full = path.resolve(dest, ...parts);
  return full.startsWith(path.resolve(dest) + path.sep) ? full : null;
}

function extractZip(file, dest) {
  const entries = readZip(fs.readFileSync(file));
  fs.mkdirSync(dest, { recursive: true });
  for (const e of entries) {
    const full = targetOf(dest, e.name);
    if (!full) continue;
    if (e.dir) {
      fs.mkdirSync(full, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, e.data());
  }
  return dest;
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** A zip archive from [{ name, data, mtime }]; names use forward slashes. */
function writeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const store = packed.length >= data.length;
    const body = store ? data : packed;
    const crc = crc32(data);
    const { time, date } = dosTime(f.mtime || new Date());
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    chunks.push(head, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(store ? 0 : 8, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += head.length + name.length + body.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

module.exports = { readZip, extractZip, writeZip, crc32, targetOf };
