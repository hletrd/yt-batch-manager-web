// yt_video_cache persistence extracted from YouTubeBatchManager (A11).
// Pure localStorage save/load/validate/clear — no DOM, no app state. The
// caller owns the in-memory channelId mirror and the imported-set persistence
// policy (C2); this module only (de)serializes and validates the cache.

import type { VideoData } from './types.js';

export interface VideoCacheData {
  videos: VideoData[];
  timestamp: number;
  channelId?: string;
  version?: number;
}

const CACHE_EXPIRY_HOURS = 24;
// Bump when VideoData gains a field whose absence in an older cache would be
// misread. v2: publish_at — a pre-v2 cache has none, which would look like
// "not scheduled" and cancel the schedule on the next save.
const CACHE_VERSION = 2;
const VIDEO_CACHE_KEY = 'yt_video_cache';

// Returns true when the cache write succeeded, so the caller can keep its
// in-memory channelId mirror in sync only on success.
export function saveVideosToCache(videos: VideoData[], channelId?: string): boolean {
  try {
    const cacheData: VideoCacheData = {
      videos,
      timestamp: Date.now(),
      channelId,
      version: CACHE_VERSION
    };
    localStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify(cacheData));
    console.log('Videos cached to localStorage:', videos.length);
    return true;
  } catch (error) {
    console.warn('Failed to cache videos:', error);
    return false;
  }
}

export function loadVideosFromCache(): { videos: VideoData[]; channelId?: string } | null {
  try {
    const cached = localStorage.getItem(VIDEO_CACHE_KEY);
    if (!cached) return null;

    const cacheData: VideoCacheData = JSON.parse(cached);
    const now = Date.now();
    const cacheAge = now - cacheData.timestamp;
    const maxAge = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;

    if (cacheAge > maxAge) {
      console.log('Cache expired, will load fresh data');
      localStorage.removeItem(VIDEO_CACHE_KEY);
      return null;
    }

    if (cacheData.version !== CACHE_VERSION) {
      console.log('Cache was written by an older version; discarding and loading fresh');
      localStorage.removeItem(VIDEO_CACHE_KEY);
      return null;
    }

    // Discard a cache that looks thin/broken (e.g. backup records, or a cache
    // written during a failed load): videos fetched from YouTube always carry
    // thumbnail data, so if none do, drop the cache and load fresh instead of
    // showing empty cards forever — a browser refresh does not clear localStorage.
    const cachedVideos = cacheData.videos || [];
    const hasThumbnails = cachedVideos.some(v =>
      !!v.thumbnail_url || (!!v.thumbnails && Object.keys(v.thumbnails).length > 0)
    );
    if (cachedVideos.length > 0 && !hasThumbnails) {
      console.log('Cached videos look thin (no thumbnails); discarding cache and loading fresh');
      localStorage.removeItem(VIDEO_CACHE_KEY);
      return null;
    }

    console.log('Loading videos from cache:', cacheData.videos.length);
    return { videos: cacheData.videos, channelId: cacheData.channelId };
  } catch (error) {
    console.warn('Failed to load cached videos:', error);
    localStorage.removeItem(VIDEO_CACHE_KEY);
    return null;
  }
}

// Fields a save can change, i.e. what patchCachedVideos copies.
const SAVED_FIELDS = [
  'title', 'description', 'privacy_status', 'publish_at', 'category_id', 'tags',
  'defaultAudioLanguage', 'default_language', 'recording_date', 'latitude', 'longitude',
  'license', 'contains_synthetic_media', 'made_for_kids', 'embeddable', 'public_stats_viewable'
] as const satisfies readonly (keyof VideoData)[];

// Write just-saved values into the cached copies of those videos (matched by
// id), keeping each cached record's other data and the cache's age. Used when
// the on-screen set is an import, which must not replace the cache wholesale
// (C2) — without this, a reload served the pre-save values from the cache, and
// with the API quota exhausted a refresh could not correct them.
export function patchCachedVideos(saved: VideoData[]): void {
  try {
    const raw = localStorage.getItem(VIDEO_CACHE_KEY);
    if (!raw || saved.length === 0) return;
    const cacheData: VideoCacheData = JSON.parse(raw);
    const byId = new Map(saved.map(video => [video.id, video]));
    let patched = 0;
    cacheData.videos = (cacheData.videos || []).map(cached => {
      const video = byId.get(cached.id);
      if (!video) return cached;
      patched++;
      const next: VideoData = { ...cached };
      for (const field of SAVED_FIELDS) {
        (next as unknown as Record<string, unknown>)[field] = video[field];
      }
      return next;
    });
    if (patched > 0) {
      localStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify(cacheData));
    }
  } catch (error) {
    console.warn('Failed to patch cached videos:', error);
  }
}

export function clearVideoCache(): void {
  localStorage.removeItem(VIDEO_CACHE_KEY);
  console.log('Video cache cleared');
}
