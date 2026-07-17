/**
 * Minimal zip writer — STORE only (no compression), enough for a handful of small text files.
 * claude.ai's Skills uploader wants a .zip, and the base image has no `zip` binary; hand-rolling
 * the container is ~40 lines of Buffer writes against APPNOTE.TXT, versus adding a dependency or
 * an apk package for one endpoint. Timestamps are fixed at 1980-01-01 so output is deterministic.
 * ponytail: STORE is fine for KBs of markdown; switch to zlib.deflateRaw (method 8) if we ever
 * zip something big enough to care.
 */
import { crc32 } from 'node:zlib';

const DOS_DATE = 0x0021; // 1980-01-01
const DOS_TIME = 0;
const UTF8_NAMES = 0x800;

/** @param entries [{ name: 'folder/file.md', data: string|Buffer }] → Buffer of a .zip */
export function zipFiles(entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const sum = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lh.writeUInt16LE(20, 4);         // version needed to extract (2.0)
    lh.writeUInt16LE(UTF8_NAMES, 6);
    lh.writeUInt16LE(0, 8);          // method: store
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(sum, 14);
    lh.writeUInt32LE(data.length, 18); // compressed size
    lh.writeUInt32LE(data.length, 22); // uncompressed size
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);           // extra field length
    local.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // central directory header signature
    ch.writeUInt16LE(20, 4);         // version made by
    ch.writeUInt16LE(20, 6);         // version needed
    ch.writeUInt16LE(UTF8_NAMES, 8);
    ch.writeUInt16LE(0, 10);         // method: store
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(sum, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file, rw-r--r-- (>>> 0: << 16 goes signed)
    ch.writeUInt32LE(offset, 42);         // offset of local header
    central.push(ch, name);

    offset += lh.length + name.length + data.length;
  }

  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16); // central directory starts after all local entries
  return Buffer.concat([...local, ...central, eocd]);
}
