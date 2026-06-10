// HTML escaping and untrusted-input sanitizers extracted from
// YouTubeBatchManager (A11). These guard every string that flows into
// innerHTML/attribute sinks; behavior is identical to the former private
// methods of the same names.

import type { ThumbnailData } from '../types.js';

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Escape a value for safe use inside a double-quoted HTML attribute. Unlike
// escapeHtml (which targets text-node content), this also encodes the double
// quote so the value cannot terminate the attribute, and is used for data-*
// attributes that carry user-controlled strings (e.g. tag values). Tag values
// are NEVER interpolated into inline JS handlers anymore; they are read back
// from data-* via delegated listeners.
export function escapeHtmlAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Accept an image URL only if it is a string with a safe scheme (http/https or a
// data: image). Anything else (javascript:, attribute-breakout strings, non-strings)
// is rejected and the caller falls back to the default thumbnail. Used to bound
// attacker-controlled URLs from imported backups before they reach src/srcset.
export function sanitizeImageUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) return '';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  return '';
}

export function sanitizeThumbnailMap(thumbnails: unknown): Record<string, ThumbnailData> {
  const clean: Record<string, ThumbnailData> = {};
  if (!thumbnails || typeof thumbnails !== 'object') return clean;
  for (const [key, value] of Object.entries(thumbnails as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const t = value as { url?: unknown; width?: unknown; height?: unknown };
    const safeUrl = sanitizeImageUrl(t.url);
    if (!safeUrl) continue;
    clean[key] = {
      url: safeUrl,
      width: typeof t.width === 'number' ? t.width : 0,
      height: typeof t.height === 'number' ? t.height : 0
    };
  }
  return clean;
}
