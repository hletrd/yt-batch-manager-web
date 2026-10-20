import type { VideoData } from './types.js';
import { isLikelyShort } from './utils/format.js';

// Observed on the public Shorts shelf, 2026-10-20: sardefault is the Studio
// cover; oar2 is an automatic frame. These are CDN conventions, not Data API
// fields. Callers must fall back to the API-provided URL if unavailable.
export function shortsThumbnailSources(video: VideoData): string[] {
  if (!isLikelyShort(video)) return [];
  const base = `https://i.ytimg.com/vi/${encodeURIComponent(video.id)}`;
  return [`${base}/sardefault.jpg`, `${base}/oar2.jpg`];
}
