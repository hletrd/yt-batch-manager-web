// JSON backup import/export data shaping extracted from YouTubeBatchManager
// (A11): the export field filter and the import-time validation/sanitization.
// Pure data transforms — no DOM, no app state.

import type { VideoData } from './types.js';
import { sanitizeImageUrl, sanitizeThumbnailMap } from './utils/html.js';
import { normalizeTimestamp } from './utils/format.js';

export function filterVideoDataForBackup(videos: VideoData[]): Record<string, unknown>[] {
  // Emit every editable field for each video. Unset optional fields are written
  // as null (rather than dropped — JSON.stringify omits undefined-valued keys)
  // so the exported JSON is a complete, fill-in-able template. Derived/read-only
  // fields (thumbnails, duration, statistics, pixel dimensions, upload/processing
  // status) are intentionally omitted.
  return videos.map(video => ({
    id: video.id,
    title: video.title,
    description: video.description,
    published_at: video.published_at,
    privacy_status: video.privacy_status,
    publish_at: video.publish_at ?? null,
    category_id: video.category_id,
    tags: video.tags ?? [],
    defaultAudioLanguage: video.defaultAudioLanguage ?? null,
    default_language: video.default_language ?? null,
    recording_date: video.recording_date ?? null,
    latitude: video.latitude ?? null,
    longitude: video.longitude ?? null,
    license: video.license ?? null,
    contains_synthetic_media: video.contains_synthetic_media ?? false,
    made_for_kids: video.made_for_kids ?? null,
    embeddable: video.embeddable ?? null,
    public_stats_viewable: video.public_stats_viewable ?? null
  }));
}

// A YouTube video id is exactly 11 chars from [A-Za-z0-9_-]. The id is later
// interpolated into single-quoted JS strings inside inline on* handlers
// (renderVideos/renderTagsContainer), so an unconstrained id from an imported
// backup is a DOM-XSS sink. Constraining the id to this charset is the primary
// defense; records with a bad id are dropped rather than rendered.
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_PRIVACY = new Set(['private', 'unlisted', 'public']);
const ALLOWED_LICENSE = new Set(['youtube', 'creativeCommon']);

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

// Clearable fields distinguish an explicit clear (null or '') from an invalid
// value (undefined), which must not clear anything.
function parseRecordingDate(value: unknown): string | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  // "YYYY-MM-DD", or the date part of a full ISO timestamp.
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value.trim());
  return match ? match[1] : undefined;
}

function parseCoordinate(value: unknown, limit: number): number | null | undefined {
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined;
}

function parseTags(value: unknown): string[] | undefined {
  if (value === null) return [];
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string');
  // Accept the comma-separated form people naturally type into a JSON file.
  if (typeof value === 'string') return value.split(',').map(t => t.trim()).filter(Boolean);
  return undefined;
}

// Validate and sanitize an imported backup array. Records with an invalid id
// are dropped; the survivors are rebuilt field by field. Returns [] when
// nothing valid remains (the caller shows the invalid-data error).
//
// `baselines` holds the videos loaded from YouTube (keyed by id). A record may
// be partial: a field missing from the file, or one with an invalid value, keeps
// the baseline value, so a file listing only {id, title} edits just the titles
// instead of blanking descriptions/tags and resetting privacy. Fields YouTube
// cannot clear (languages, license, the status flags) also keep the baseline
// when the file sets them to null. Read-only fields (statistics, duration,
// thumbnails, upload/processing status) come only from the baseline, never
// from the file, which bounds what reaches the DOM unescaped.
export function sanitizeImportedVideos(videoData: unknown[], baselines: ReadonlyMap<string, VideoData> = new Map()): VideoData[] {
  const sanitized: VideoData[] = [];

  for (const entry of videoData) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !VIDEO_ID_PATTERN.test(raw.id)) continue;

    const base = baselines.get(raw.id);
    const has = (key: string) => key in raw;

    const title = has('title') ? raw.title : base?.title;
    if (title == null) continue;

    const recordingDate = parseRecordingDate(raw.recording_date);
    const latitude = parseCoordinate(raw.latitude, 90);
    const longitude = parseCoordinate(raw.longitude, 180);
    const privacy = typeof raw.privacy_status === 'string' && ALLOWED_PRIVACY.has(raw.privacy_status) ? raw.privacy_status : undefined;
    const license = typeof raw.license === 'string' && ALLOWED_LICENSE.has(raw.license) ? raw.license : undefined;
    const category = typeof raw.category_id === 'number' ? String(raw.category_id) : nonEmptyString(raw.category_id);

    const video: VideoData = {
      id: raw.id,
      title: typeof title === 'string' ? title : String(title),
      description: !has('description') ? (base?.description ?? '')
        : typeof raw.description === 'string' ? raw.description : String(raw.description ?? ''),
      published_at: typeof raw.published_at === 'string' ? raw.published_at : (base?.published_at ?? ''),
      privacy_status: privacy ?? base?.privacy_status ?? 'private',
      // null clears a schedule; an unparseable value keeps the baseline's.
      publish_at: raw.publish_at === null ? undefined : (normalizeTimestamp(raw.publish_at) ?? base?.publish_at),
      category_id: category ?? base?.category_id ?? '22',
      tags: parseTags(raw.tags) ?? (base?.tags ? [...base.tags] : []),
      // An empty language code is not valid BCP-47 and YouTube cannot unset a
      // language anyway, so unset/empty keeps the baseline (see AGENTS.md).
      defaultAudioLanguage: nonEmptyString(raw.defaultAudioLanguage) ?? base?.defaultAudioLanguage,
      default_language: nonEmptyString(raw.default_language) ?? base?.default_language,
      recording_date: recordingDate === null ? undefined : (recordingDate ?? base?.recording_date),
      latitude: latitude === null ? undefined : (latitude ?? base?.latitude),
      longitude: longitude === null ? undefined : (longitude ?? base?.longitude),
      license: license ?? base?.license,
      contains_synthetic_media: optionalBoolean(raw.contains_synthetic_media) ?? base?.contains_synthetic_media ?? false,
      made_for_kids: optionalBoolean(raw.made_for_kids) ?? base?.made_for_kids,
      embeddable: optionalBoolean(raw.embeddable) ?? base?.embeddable,
      public_stats_viewable: optionalBoolean(raw.public_stats_viewable) ?? base?.public_stats_viewable,
      // Thumbnail URLs flow into src/srcset attributes. Without a baseline keep
      // them only when they are strings with a safe scheme; non-conforming
      // values are dropped so the default thumbnail is used (see also
      // escapeHtmlAttribute in the renderer).
      thumbnail_url: base ? base.thumbnail_url : sanitizeImageUrl(raw.thumbnail_url),
      thumbnails: base ? structuredClone(base.thumbnails) : sanitizeThumbnailMap(raw.thumbnails)
    };

    // Read-only display data: copied (deep, see B12) from the baseline only.
    if (base) {
      Object.assign(video, structuredClone({
        duration: base.duration,
        width_pixels: base.width_pixels,
        height_pixels: base.height_pixels,
        upload_status: base.upload_status,
        processing_status: base.processing_status,
        processing_progress: base.processing_progress,
        statistics: base.statistics
      }));
    }

    sanitized.push(video);
  }

  return sanitized;
}
