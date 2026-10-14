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

export function clearVideoCache(): void {
  localStorage.removeItem(VIDEO_CACHE_KEY);
  console.log('Video cache cleared');
}
