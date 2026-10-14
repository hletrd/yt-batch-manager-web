// Minimal, dependency-free ZIP reader/writer for the backup ZIP (videos.json +
// thumbnails). The app has no bundler and avoids runtime dependencies, so this
// implements just enough of the format (APPNOTE.TXT) using the platform's
// CompressionStream/DecompressionStream for DEFLATE:
//   - writer: STORE or DEFLATE entries, UTF-8 names, no ZIP64 (< 4 GiB / 65535 entries)
//   - reader: STORE/DEFLATE entries from the central directory (so data
//     descriptors written by streaming tools such as macOS Archive Utility are
//     handled), ZIP64 sizes/offsets, CRC-32 verification. Encryption is rejected.

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8_NAME = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function pipeThrough(data: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toDosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export interface ZipInputEntry {
  name: string;
  data: Uint8Array<ArrayBuffer>;
  // DEFLATE the entry (kept only when it actually shrinks). Leave off for
  // already-compressed payloads such as JPEG/PNG.
  compress?: boolean;
}

export async function createZip(entries: ZipInputEntry[], modified: Date = new Date()): Promise<Blob> {
  if (entries.length > MAX_UINT16) {
    throw new Error('Too many files for a ZIP archive');
  }

  const encoder = new TextEncoder();
  const { time, date } = toDosDateTime(modified);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const centralHeaders: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    let method = METHOD_STORE;
    let body = entry.data;
    if (entry.compress) {
      const deflated = await pipeThrough(entry.data, new CompressionStream('deflate-raw'));
      if (deflated.length < entry.data.length) {
        method = METHOD_DEFLATE;
        body = deflated;
      }
    }
    if (entry.data.length > MAX_UINT32 || offset > MAX_UINT32) {
      throw new Error('ZIP archive too large');
    }

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_FILE_HEADER, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, FLAG_UTF8_NAME, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_DIRECTORY_HEADER, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, FLAG_UTF8_NAME, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    parts.push(local, body);
    centralHeaders.push(central);
    offset += local.length + body.length;
  }

  const centralSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);
  if (offset > MAX_UINT32 || centralSize > MAX_UINT32) {
    throw new Error('ZIP archive too large');
  }

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...centralHeaders, end], { type: 'application/zip' });
}

export interface ZipEntry {
  // Path inside the archive, '/'-separated. Directory entries are not listed.
  name: string;
  // Uncompressed size in bytes (from the central directory).
  size: number;
  read(): Promise<Uint8Array<ArrayBuffer>>;
}

export function isZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b &&
    ((data[2] === 0x03 && data[3] === 0x04) || (data[2] === 0x05 && data[3] === 0x06));
}

export function readZip(data: Uint8Array<ArrayBuffer>): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fail = (reason: string): never => {
    throw new Error(`Invalid ZIP file: ${reason}`);
  };

  // The end-of-central-directory record sits at the very end, followed only by
  // an optional comment of at most 65535 bytes.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - MAX_UINT16); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    fail('end of central directory not found');
  }

  let count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  if (count === MAX_UINT16 || cursor === MAX_UINT32) {
    const locator = eocd - 20;
    if (locator >= 0 && view.getUint32(locator, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR) {
      const zip64End = Number(view.getBigUint64(locator + 8, true));
      if (zip64End + 56 > data.length || view.getUint32(zip64End, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY) {
        fail('bad ZIP64 end of central directory');
      }
      count = Number(view.getBigUint64(zip64End + 32, true));
      cursor = Number(view.getBigUint64(zip64End + 48, true));
    }
  }

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > data.length || view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_HEADER) {
      fail('bad central directory');
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    let compressedSize = view.getUint32(cursor + 20, true);
    let size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    let localOffset = view.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const name = decoder.decode(data.subarray(nameStart, nameStart + nameLength));

    // ZIP64 extra field: only the header fields saturated at 0xFFFFFFFF are
    // present, in this fixed order.
    if (size === MAX_UINT32 || compressedSize === MAX_UINT32 || localOffset === MAX_UINT32) {
      let extra = nameStart + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = view.getUint16(extra, true);
        const length = view.getUint16(extra + 2, true);
        if (id === ZIP64_EXTRA_FIELD) {
          let field = extra + 4;
          if (size === MAX_UINT32) { size = Number(view.getBigUint64(field, true)); field += 8; }
          if (compressedSize === MAX_UINT32) { compressedSize = Number(view.getBigUint64(field, true)); field += 8; }
          if (localOffset === MAX_UINT32) { localOffset = Number(view.getBigUint64(field, true)); }
          break;
        }
        extra += 4 + length;
      }
    }

    cursor = nameStart + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) {
      continue;
    }

    entries.push({
      name,
      size,
      read: async () => {
        if (flags & FLAG_ENCRYPTED) {
          fail(`encrypted entry ${name}`);
        }
        if (localOffset + 30 > data.length || view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
          fail(`bad local header for ${name}`);
        }
        // The local header's name/extra lengths can differ from the central
        // directory's, so the data offset must be read from the local header.
        const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        if (dataStart + compressedSize > data.length) {
          fail(`truncated entry ${name}`);
        }
        const raw = data.subarray(dataStart, dataStart + compressedSize);
        let content: Uint8Array<ArrayBuffer>;
        if (method === METHOD_STORE) {
          content = raw;
        } else if (method === METHOD_DEFLATE) {
          content = await pipeThrough(raw, new DecompressionStream('deflate-raw'));
        } else {
          return fail(`unsupported compression method ${method} for ${name}`);
        }
        if (content.length !== size || crc32(content) !== crc) {
          fail(`checksum mismatch for ${name}`);
        }
        return content;
      }
    });
  }

  return entries;
}
