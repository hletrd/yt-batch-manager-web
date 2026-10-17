// ZIP backup: the JSON backup plus every video's thumbnail, so thumbnails can
// be batch-replaced the same way metadata is — edit videos.json and/or swap
// images under thumbnails/, then load the ZIP back. Layout:
//
//   videos.json             filterVideoDataForBackup records, plus per video
//                           "thumbnail" (path inside the ZIP, or null) and
//                           "thumbnail_sha256" (hash of the exported image)
//   thumbnails/<id>.jpg|png the current thumbnail (at most 1280x720)
//   README.txt              how to use it, in the UI language
//
// On import a thumbnail counts as changed — and is uploaded on save — only
// when its bytes no longer match thumbnail_sha256 *and* it does not look like
// the thumbnail YouTube shows now (the caller's isUnchanged, a visual
// comparison: YouTube re-encodes every thumbnail, so the user's own copy of an
// unchanged image never matches byte for byte). Re-importing an untouched
// export therefore uploads nothing (each thumbnails.set costs ~50 quota units
// of the 10,000/day). No DOM, no app state.

import { VIDEO_ID_PATTERN } from './backup.js';
import type { VideoData } from './types.js';
import { createZip, readZip, type ZipEntry, type ZipInputEntry } from './utils/zip.js';

// thumbnails.set accepts JPEG or PNG up to 50 MB.
export const MAX_THUMBNAIL_BYTES = 50 * 1024 * 1024;

export type ThumbnailMimeType = 'image/jpeg' | 'image/png';

const EXTENSIONS: Record<ThumbnailMimeType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

// Identify JPEG/PNG by their magic bytes: ZIP entries carry no MIME type, and
// a replaced image may keep the old extension (a PNG saved over a .jpg).
export function sniffImageType(data: Uint8Array): ThumbnailMimeType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= png.length && png.every((byte, i) => data[i] === byte)) {
    return 'image/png';
  }
  return null;
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Largest of the classic sizes (maxres = 1280x720). The fhd/qhd/uhd sizes some
// videos now have are skipped to keep the ZIP small: the exported image is a
// reference copy, and only images the user replaces are ever uploaded.
const EXPORT_SIZE_ORDER = ['maxres', 'standard', 'high', 'medium', 'default'];

function exportThumbnailUrl(video: VideoData): string | undefined {
  for (const size of EXPORT_SIZE_ORDER) {
    const url = video.thumbnails?.[size]?.url;
    if (url) {
      return url;
    }
  }
  return video.thumbnail_url || undefined;
}

// i.ytimg.com serves thumbnails with Access-Control-Allow-Origin: *, so they
// can be read cross-origin (connect-src allows *.ytimg.com).
async function fetchImage(url: string, init?: RequestInit): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const response = await fetch(url, init);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

// YouTube's current thumbnail of a video at a size fit for a visual
// comparison (see image-compare.ts): maxres, else the 640x480 standard size.
// Smaller sizes are too blurry to rule out a small edit, so without these
// there is nothing to compare against (null), and the image counts as changed.
export async function fetchComparableThumbnail(video: VideoData): Promise<Blob | null> {
  const url = video.thumbnails?.maxres?.url || video.thumbnails?.standard?.url;
  if (!url) {
    return null;
  }
  // Revalidate: a just-replaced thumbnail keeps its URL.
  const data = await fetchImage(url, { cache: 'no-cache' });
  const type = data ? sniffImageType(data) : null;
  return data && type ? new Blob([data], { type }) : null;
}

// A thumbnail the app already holds locally: one imported but not yet
// uploaded (pending), or one uploaded this session that YouTube's CDN may not
// serve yet.
export interface LocalThumbnail {
  blob: Blob;
  pending: boolean;
}

export interface BuildBackupZipOptions {
  // filterVideoDataForBackup output for `videos`, in the same order. The
  // thumbnail fields are added to these records in place.
  records: Record<string, unknown>[];
  readme: string;
  localThumbnail(videoId: string): LocalThumbnail | undefined;
  onProgress?(done: number, total: number): void;
}

const DOWNLOAD_CONCURRENCY = 6;

export async function buildBackupZip(videos: VideoData[], options: BuildBackupZipOptions): Promise<{ blob: Blob; exported: number; failed: number }> {
  const images: ZipInputEntry[] = [];
  let exported = 0;
  let failed = 0;
  let done = 0;

  const queue = videos.map((video, index) => ({ video, record: options.records[index] }));
  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const { video, record } = item;
      const local = options.localThumbnail(video.id);
      const url = exportThumbnailUrl(video);
      const data = local ? new Uint8Array(await local.blob.arrayBuffer()) : url ? await fetchImage(url) : null;
      const type = data ? sniffImageType(data) : null;
      if (data && type) {
        const path = `thumbnails/${video.id}.${EXTENSIONS[type]}`;
        images.push({ name: path, data });
        record.thumbnail = path;
        // A pending (not yet uploaded) thumbnail is exported without a hash, so
        // loading this ZIP back keeps it pending rather than dropping it.
        record.thumbnail_sha256 = local?.pending ? null : await sha256Hex(data);
        exported++;
      } else {
        record.thumbnail = null;
        record.thumbnail_sha256 = null;
        failed++;
      }
      options.onProgress?.(++done, videos.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, queue.length) }, worker));

  images.sort((a, b) => a.name.localeCompare(b.name));
  const encoder = new TextEncoder();
  const blob = await createZip([
    { name: 'videos.json', data: encoder.encode(JSON.stringify(options.records, null, 2)), compress: true },
    { name: 'README.txt', data: encoder.encode(options.readme), compress: true },
    ...images
  ]);
  return { blob, exported, failed };
}

export interface BackupZipContents {
  // Parsed videos.json, or undefined when the ZIP has no JSON file.
  records: unknown;
  // Changed thumbnails by video id: valid JPEG/PNG within the size limit.
  thumbnails: Map<string, Blob>;
  // Changed thumbnail files that cannot be used (not JPEG/PNG, or too large).
  skipped: number;
}

// macOS adds __MACOSX/ and ._ AppleDouble entries when zipping; ignore those
// and any other dotfiles.
function isJunkEntry(name: string): boolean {
  return name.startsWith('__MACOSX/') || name.split('/').some(part => part.startsWith('.'));
}

// videos.json may sit inside a folder (re-zipping an extracted folder adds
// one); the shallowest one wins, else the only .json file in the archive.
function findVideosJson(entries: ZipEntry[]): ZipEntry | undefined {
  const depth = (entry: ZipEntry) => entry.name.split('/').length;
  const jsonFiles = entries.filter(entry => entry.name.toLowerCase().endsWith('.json'));
  const named = jsonFiles.filter(entry => entry.name.split('/').pop() === 'videos.json').sort((a, b) => depth(a) - depth(b));
  return named[0] ?? (jsonFiles.length === 1 ? jsonFiles[0] : undefined);
}

// Where a video's image may be: the record's "thumbnail" path, then
// thumbnails/<id> with any supported extension (the user may have swapped a
// .jpg for a .png). Paths are relative to the folder holding videos.json.
function thumbnailCandidates(entries: Map<string, ZipEntry>, baseDir: string, videoId: string, thumbnail: unknown): ZipEntry[] {
  const paths: string[] = [];
  if (typeof thumbnail === 'string' && thumbnail.trim() !== '') {
    paths.push(baseDir + thumbnail.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, ''));
  }
  for (const extension of ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG']) {
    paths.push(`${baseDir}thumbnails/${videoId}.${extension}`);
  }
  const found = new Set<ZipEntry>();
  for (const path of paths) {
    const entry = entries.get(path);
    if (entry) {
      found.add(entry);
    }
  }
  return [...found];
}

export interface ReadBackupZipOptions {
  // Whether a thumbnail whose bytes differ from the export still shows the
  // same image as YouTube's current one (then it is not uploaded).
  isUnchanged?(videoId: string, image: Blob): Promise<boolean>;
  onProgress?(done: number, total: number): void;
}

const COMPARE_CONCURRENCY = 4;

export async function readBackupZip(data: Uint8Array<ArrayBuffer>, options: ReadBackupZipOptions = {}): Promise<BackupZipContents> {
  const entries = readZip(data).filter(entry => !isJunkEntry(entry.name));
  const jsonEntry = findVideosJson(entries);
  if (!jsonEntry) {
    return { records: undefined, thumbnails: new Map(), skipped: 0 };
  }

  const baseDir = jsonEntry.name.slice(0, jsonEntry.name.lastIndexOf('/') + 1);
  const records: unknown = JSON.parse(new TextDecoder().decode(await jsonEntry.read()));
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  const thumbnails = new Map<string, Blob>();
  let skipped = 0;

  const work: Array<{ id: string; exportedHash: unknown; candidates: ZipEntry[] }> = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    const { id, thumbnail, thumbnail_sha256: exportedHash } = record as Record<string, unknown>;
    if (typeof id !== 'string' || !VIDEO_ID_PATTERN.test(id)) continue;
    const candidates = thumbnailCandidates(byName, baseDir, id, thumbnail);
    if (candidates.length > 0) {
      work.push({ id, exportedHash, candidates });
    }
  }

  // The first candidate that is neither byte-identical to the exported image
  // nor looks like YouTube's current one is the replacement; if every
  // candidate matches, the thumbnail is unchanged.
  const total = work.length;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (let item = work.shift(); item; item = work.shift()) {
      const { id, exportedHash, candidates } = item;
      for (const entry of candidates) {
        if (entry.size > MAX_THUMBNAIL_BYTES) {
          skipped++;
          break;
        }
        const bytes = await entry.read();
        if (typeof exportedHash === 'string' && exportedHash.toLowerCase() === await sha256Hex(bytes)) {
          continue;
        }
        const type = sniffImageType(bytes);
        if (!type) {
          skipped++;
          break;
        }
        const image = new Blob([bytes], { type });
        if (await options.isUnchanged?.(id, image)) {
          continue;
        }
        thumbnails.set(id, image);
        break;
      }
      options.onProgress?.(++done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(COMPARE_CONCURRENCY, total) }, worker));

  return { records, thumbnails, skipped };
}
