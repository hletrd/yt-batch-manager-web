// Pure formatting/parsing helpers extracted from YouTubeBatchManager (A11).
// No DOM, no app state — every function is a deterministic input → output map.

import type { VideoData } from '../types.js';

// Parse an ISO-8601 duration (e.g. P1DT2H3M4S) into days/hours/minutes/seconds.
// Long uploads/archives can exceed 24h and carry a days (D) component, which
// the previous PT-only regex silently dropped.
export function parseIsoDuration(isoDuration?: string): { days: number; hours: number; minutes: number; seconds: number } | null {
  if (!isoDuration) return null;
  const match = isoDuration.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
  if (!match) return null;
  return {
    days: parseInt(match[1] || '0', 10),
    hours: parseInt(match[2] || '0', 10),
    minutes: parseInt(match[3] || '0', 10),
    seconds: parseInt(match[4] || '0', 10)
  };
}

export function formatDuration(isoDuration?: string): string {
  const parsed = parseIsoDuration(isoDuration);
  if (!parsed) return '';

  // Roll any days into the hours component for a compact H:MM:SS display.
  const hours = parsed.days * 24 + parsed.hours;
  const { minutes, seconds } = parsed;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

export function parseDurationToSeconds(isoDuration?: string): number {
  const parsed = parseIsoDuration(isoDuration);
  if (!parsed) return 0;
  return parsed.days * 86400 + parsed.hours * 3600 + parsed.minutes * 60 + parsed.seconds;
}

// The Data API has no official "is this a Short" flag, so this is a heuristic:
// a Short is vertical/square AND 3 minutes or shorter (the current Shorts
// length limit). Orientation comes from fileDetails (owner-only); a landscape
// video is never flagged. When the dimensions are unknown (fileDetails absent,
// e.g. a file import) we fall back to the duration test alone.
export function isLikelyShort(video: VideoData): boolean {
  const seconds = parseDurationToSeconds(video.duration);
  if (seconds <= 0 || seconds > 180) {
    return false;
  }
  const w = video.width_pixels;
  const h = video.height_pixels;
  if (w && h) {
    return h >= w;
  }
  return true;
}

export function formatNumber(num?: string): string {
  if (!num) return '0';
  const number = parseInt(num);
  if (number >= 1000000) {
    return (number / 1000000).toFixed(1) + 'M';
  } else if (number >= 1000) {
    return (number / 1000).toFixed(1) + 'K';
  } else {
    return number.toString();
  }
}

// Parse a published_at date to epoch ms, treating missing/invalid dates as 0
// (oldest). Without this an empty published_at (e.g. from an imported backup)
// yields NaN, and NaN comparisons make the sort order non-deterministic.
export function publishedTime(value: string): number {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function parseCoordInput(raw: string | undefined, fallback: number | undefined): number | undefined {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((val, index) => val === b[index]);
}
