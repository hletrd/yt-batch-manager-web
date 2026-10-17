// Per-video form readers extracted from YouTubeBatchManager (A11): comparing
// the live form against the saved baseline (hasCurrentChanges) and collecting
// the videos.update payload from the form (collectVideoUpdates). Both read
// the same per-video element ids as before; baselines arrive as parameters.

import type { VideoData } from './types.js';
import { arraysEqual, normalizeNewlines, parseCoordInput } from './utils/format.js';
import { getCurrentTags } from './tags.js';

// Value of a Yes/No select (see generateBooleanOptions). '' ("keep current",
// offered only when the value is unknown) and a missing element (card not
// rendered) fall back to `fallback`.
function readBooleanSelect(elementId: string, fallback: boolean | undefined): boolean | undefined {
  const value = (document.getElementById(elementId) as HTMLSelectElement | null)?.value;
  return value === 'true' ? true : value === 'false' ? false : fallback;
}

// An unknown (undefined) current value means "keep", never a change.
function booleanChanged(current: boolean | undefined, saved: boolean | undefined): boolean {
  return current !== undefined && current !== saved;
}

// `video` is the live record (it carries the fields that have no form control
// and can only change through a backup import); `original` is the saved
// baseline.
export function hasCurrentChanges(videoId: string, video: VideoData, original: VideoData): boolean {
  const titleEl = document.getElementById(`title-${videoId}`) as HTMLInputElement;
  const descriptionEl = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
  const privacyEl = document.getElementById(`privacy-${videoId}`) as HTMLSelectElement;
  const categoryEl = document.getElementById(`category-${videoId}`) as HTMLSelectElement;
  const languageEl = document.getElementById(`language-${videoId}`) as HTMLSelectElement;
  const syntheticEl = document.getElementById(`synthetic-${videoId}`) as HTMLInputElement;
  const recordingDateEl = document.getElementById(`recording-date-${videoId}`) as HTMLInputElement;
  const latEl = document.getElementById(`latitude-${videoId}`) as HTMLInputElement;
  const lngEl = document.getElementById(`longitude-${videoId}`) as HTMLInputElement;
  const licenseEl = document.getElementById(`license-${videoId}`) as HTMLSelectElement;
  const defaultLangEl = document.getElementById(`default-language-${videoId}`) as HTMLSelectElement;

  const currentTags = getCurrentTags(videoId);

  return (
    titleEl?.value !== original.title ||
    descriptionEl?.value !== normalizeNewlines(original.description) ||
    privacyEl?.value !== original.privacy_status ||
    categoryEl?.value !== original.category_id ||
    languageEl?.value !== (original.defaultAudioLanguage || '') ||
    (syntheticEl ? syntheticEl.checked : false) !== (original.contains_synthetic_media || false) ||
    (recordingDateEl ? recordingDateEl.value : '') !== (original.recording_date || '') ||
    (latEl ? latEl.value.trim() : '') !== (original.latitude != null ? String(original.latitude) : '') ||
    (lngEl ? lngEl.value.trim() : '') !== (original.longitude != null ? String(original.longitude) : '') ||
    (licenseEl ? licenseEl.value : (original.license || 'youtube')) !== (original.license || 'youtube') ||
    (defaultLangEl ? defaultLangEl.value : '') !== (original.default_language || '') ||
    booleanChanged(readBooleanSelect(`embeddable-${videoId}`, video.embeddable), original.embeddable) ||
    booleanChanged(readBooleanSelect(`public-stats-${videoId}`, video.public_stats_viewable), original.public_stats_viewable) ||
    booleanChanged(readBooleanSelect(`made-for-kids-${videoId}`, video.made_for_kids), original.made_for_kids) ||
    (video.publish_at ?? null) !== (original.publish_at ?? null) ||
    !arraysEqual(currentTags, original.tags || [])
  );
}

export interface CollectedVideoUpdates {
  title: string;
  description: string;
  privacy_status: string;
  publish_at?: string;
  category_id: string;
  defaultAudioLanguage: string;
  default_language: string;
  tags: string[];
  contains_synthetic_media: boolean;
  license: string;
  embeddable?: boolean;
  public_stats_viewable?: boolean;
  made_for_kids?: boolean;
  recording_date: string;
  latitude?: number;
  longitude?: number;
}

export function collectVideoUpdates(videoId: string, video: VideoData, baseline: VideoData): { updates: CollectedVideoUpdates; recordingDetailsChanged: boolean; madeForKidsChanged: boolean } {
  const titleEl = document.getElementById(`title-${videoId}`) as HTMLInputElement;
  const descriptionEl = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
  const privacyEl = document.getElementById(`privacy-${videoId}`) as HTMLSelectElement;
  const categoryEl = document.getElementById(`category-${videoId}`) as HTMLSelectElement;
  const languageEl = document.getElementById(`language-${videoId}`) as HTMLSelectElement;

  const syntheticEl = document.getElementById(`synthetic-${videoId}`) as HTMLInputElement;
  const privacyStatus = privacyEl ? privacyEl.value : video.privacy_status;

  // Read the live element value when the element exists, falling back to the
  // stored value only when the element is missing. Using `el?.value || stored`
  // would treat an intentionally-cleared field (empty string) as "unchanged"
  // and silently revert it, so an emptied description was never saved.
  const recordingDate = ((document.getElementById(`recording-date-${videoId}`) as HTMLInputElement | null)?.value) ?? (video.recording_date || '');
  const latitude = parseCoordInput((document.getElementById(`latitude-${videoId}`) as HTMLInputElement | null)?.value, video.latitude);
  const longitude = parseCoordInput((document.getElementById(`longitude-${videoId}`) as HTMLInputElement | null)?.value, video.longitude);

  // Did the user actually change date/location vs. the saved baseline? The
  // API layer attaches the recordingDetails part only when this is true:
  // attaching it on every save would wipe an existing date on incidental
  // (e.g. title-only) saves, while never attaching it would make clearing a
  // date impossible to propagate. Comparing against the baseline gives both:
  // untouched fields are preserved, an intentional clear is sent.
  const recordingDetailsChanged =
    recordingDate !== (baseline.recording_date || '') ||
    (latitude ?? null) !== (baseline.latitude ?? null) ||
    (longitude ?? null) !== (baseline.longitude ?? null);

  // The readable madeForKids is the *effective* designation, not the
  // creator's self-declaration, so round-tripping it on every save could flip
  // a video's COPPA designation. selfDeclaredMadeForKids is therefore written
  // only when the user changed the setting vs. a known baseline.
  const madeForKids = readBooleanSelect(`made-for-kids-${videoId}`, video.made_for_kids);
  const madeForKidsChanged = madeForKids !== undefined && baseline.made_for_kids !== undefined && madeForKids !== baseline.made_for_kids;

  const updates: CollectedVideoUpdates = {
    title: titleEl ? titleEl.value : video.title,
    // An untouched textarea differs from the record only by its LF line
    // breaks; send the record's exact text then.
    description: descriptionEl && descriptionEl.value !== normalizeNewlines(video.description) ? descriptionEl.value : video.description,
    privacy_status: privacyStatus,
    // No form control; set from YouTube or a backup import. YouTube keeps a
    // schedule only on a private video, so it is dropped (and forgotten after
    // the save) once the video is made public/unlisted — otherwise switching
    // it back to private later would silently re-schedule it.
    publish_at: privacyStatus === 'private' ? video.publish_at : undefined,
    category_id: categoryEl ? categoryEl.value : video.category_id,
    // Empty string is the "Auto" option and must be allowed to clear a set language.
    defaultAudioLanguage: languageEl ? languageEl.value : (video.defaultAudioLanguage || ''),
    default_language: ((document.getElementById(`default-language-${videoId}`) as HTMLSelectElement | null)?.value) ?? (video.default_language || ''),
    tags: video.tags || [],
    contains_synthetic_media: syntheticEl ? syntheticEl.checked : (video.contains_synthetic_media ?? false),
    // Re-send the other mutable status fields so videos.update doesn't wipe
    // them (it deletes any status property omitted from the request).
    license: (document.getElementById(`license-${videoId}`) as HTMLSelectElement | null)?.value || video.license || 'youtube',
    // "Keep current" (unknown locally) re-sends the baseline value.
    embeddable: readBooleanSelect(`embeddable-${videoId}`, video.embeddable) ?? baseline.embeddable,
    public_stats_viewable: readBooleanSelect(`public-stats-${videoId}`, video.public_stats_viewable) ?? baseline.public_stats_viewable,
    made_for_kids: madeForKids ?? baseline.made_for_kids,
    recording_date: recordingDate,
    latitude,
    longitude
  };

  return { updates, recordingDetailsChanged, madeForKidsChanged };
}
