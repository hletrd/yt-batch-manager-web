// JSON backup import/export data shaping extracted from YouTubeBatchManager
// (A11): the export field filter and the import-time validation/sanitization.
// Pure data transforms — no DOM, no app state.

import type { VideoData } from './types.js';
import { sanitizeImageUrl, sanitizeThumbnailMap } from './utils/html.js';

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

// Validate and sanitize an imported backup array. Records with an invalid id
// are dropped; the survivors have every field coerced/bounded. Returns [] when
// nothing valid remains (the caller shows the invalid-data error).
export function sanitizeImportedVideos(videoData: VideoData[]): VideoData[] {
  // A YouTube video id is exactly 11 chars from [A-Za-z0-9_-]. The id is later
  // interpolated into single-quoted JS strings inside inline on* handlers
  // (renderVideos/renderTagsContainer), so an unconstrained id from an imported
  // backup is a DOM-XSS sink. Constraining the id to this charset here makes that
  // interpolation safe and is the primary defense; records with a bad id are
  // dropped rather than rendered.
  const validIdPattern = /^[A-Za-z0-9_-]{11}$/;
  videoData = videoData.filter(video =>
    video && typeof video.id === 'string' && validIdPattern.test(video.id) &&
    video.title != null
  );

  // Defense-in-depth: coerce/sanitize each imported record's fields rather than
  // trusting the file shape. Tags must be an array of strings; privacy_status
  // is constrained to the known set; text fields are coerced to strings;
  // contains_synthetic_media to a boolean. This bounds what later flows into
  // the DOM and into YouTube update requests.
  const allowedPrivacy = new Set(['private', 'unlisted', 'public']);
  return videoData.map((video: VideoData) => ({
    ...video,
    title: typeof video.title === 'string' ? video.title : String(video.title ?? ''),
    description: typeof video.description === 'string' ? video.description : String(video.description ?? ''),
    privacy_status: allowedPrivacy.has(video.privacy_status) ? video.privacy_status : 'private',
    category_id: video.category_id != null ? String(video.category_id) : '22',
    tags: Array.isArray(video.tags) ? video.tags.filter((t): t is string => typeof t === 'string') : [],
    defaultAudioLanguage: typeof video.defaultAudioLanguage === 'string' ? video.defaultAudioLanguage : undefined,
    // Normalize optional fields: the backup writes unset values as null, but a
    // null must become undefined here so it is treated as "not set" and is not
    // sent to videos.update (which would wipe or reject the field).
    default_language: typeof video.default_language === 'string' ? video.default_language : undefined,
    recording_date: typeof video.recording_date === 'string' ? video.recording_date : undefined,
    latitude: typeof video.latitude === 'number' ? video.latitude : undefined,
    longitude: typeof video.longitude === 'number' ? video.longitude : undefined,
    license: typeof video.license === 'string' ? video.license : undefined,
    made_for_kids: typeof video.made_for_kids === 'boolean' ? video.made_for_kids : undefined,
    embeddable: typeof video.embeddable === 'boolean' ? video.embeddable : undefined,
    public_stats_viewable: typeof video.public_stats_viewable === 'boolean' ? video.public_stats_viewable : undefined,
    contains_synthetic_media: video.contains_synthetic_media === true,
    // Thumbnail URLs flow into src/srcset attributes. Keep them only when they
    // are strings with a safe scheme; non-conforming values are dropped so the
    // default thumbnail is used (see also escapeHtmlAttribute in the renderer).
    thumbnail_url: sanitizeImageUrl(video.thumbnail_url),
    thumbnails: sanitizeThumbnailMap(video.thumbnails)
  }));
}
