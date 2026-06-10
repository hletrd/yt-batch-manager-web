// Per-video form readers extracted from YouTubeBatchManager (A11): comparing
// the live form against the saved baseline (hasCurrentChanges) and collecting
// the videos.update payload from the form (collectVideoUpdates). Both read
// the same per-video element ids as before; baselines arrive as parameters.

import type { VideoData } from './types.js';
import { arraysEqual, parseCoordInput } from './utils/format.js';
import { getCurrentTags } from './tags.js';

export function hasCurrentChanges(videoId: string, savedTitle: string, savedDescription: string, savedPrivacyStatus: string, savedCategoryId: string, savedDefaultAudioLanguage?: string, savedContainsSyntheticMedia?: boolean, savedRecordingDate?: string, savedLatitude?: number, savedLongitude?: number, savedLicense?: string, savedDefaultLanguage?: string, originalTags: string[] = []): boolean {
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
    titleEl?.value !== savedTitle ||
    descriptionEl?.value !== savedDescription ||
    privacyEl?.value !== savedPrivacyStatus ||
    categoryEl?.value !== savedCategoryId ||
    languageEl?.value !== (savedDefaultAudioLanguage || '') ||
    (syntheticEl ? syntheticEl.checked : false) !== (savedContainsSyntheticMedia || false) ||
    (recordingDateEl ? recordingDateEl.value : '') !== (savedRecordingDate || '') ||
    (latEl ? latEl.value.trim() : '') !== (savedLatitude != null ? String(savedLatitude) : '') ||
    (lngEl ? lngEl.value.trim() : '') !== (savedLongitude != null ? String(savedLongitude) : '') ||
    (licenseEl ? licenseEl.value : (savedLicense || 'youtube')) !== (savedLicense || 'youtube') ||
    (defaultLangEl ? defaultLangEl.value : '') !== (savedDefaultLanguage || '') ||
    !arraysEqual(currentTags, originalTags)
  );
}

export interface CollectedVideoUpdates {
  title: string;
  description: string;
  privacy_status: string;
  category_id: string;
  defaultAudioLanguage: string;
  default_language: string;
  tags: string[];
  contains_synthetic_media: boolean;
  license: string;
  embeddable?: boolean;
  public_stats_viewable?: boolean;
  recording_date: string;
  latitude?: number;
  longitude?: number;
}

export function collectVideoUpdates(videoId: string, video: VideoData, recordingBaseline: VideoData): { updates: CollectedVideoUpdates; recordingDetailsChanged: boolean } {
  const titleEl = document.getElementById(`title-${videoId}`) as HTMLInputElement;
  const descriptionEl = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
  const privacyEl = document.getElementById(`privacy-${videoId}`) as HTMLSelectElement;
  const categoryEl = document.getElementById(`category-${videoId}`) as HTMLSelectElement;
  const languageEl = document.getElementById(`language-${videoId}`) as HTMLSelectElement;

  const syntheticEl = document.getElementById(`synthetic-${videoId}`) as HTMLInputElement;

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
    recordingDate !== (recordingBaseline.recording_date || '') ||
    (latitude ?? null) !== (recordingBaseline.latitude ?? null) ||
    (longitude ?? null) !== (recordingBaseline.longitude ?? null);

  const updates: CollectedVideoUpdates = {
    title: titleEl ? titleEl.value : video.title,
    description: descriptionEl ? descriptionEl.value : video.description,
    privacy_status: privacyEl ? privacyEl.value : video.privacy_status,
    category_id: categoryEl ? categoryEl.value : video.category_id,
    // Empty string is the "Auto" option and must be allowed to clear a set language.
    defaultAudioLanguage: languageEl ? languageEl.value : (video.defaultAudioLanguage || ''),
    default_language: ((document.getElementById(`default-language-${videoId}`) as HTMLSelectElement | null)?.value) ?? (video.default_language || ''),
    tags: video.tags || [],
    contains_synthetic_media: syntheticEl ? syntheticEl.checked : (video.contains_synthetic_media ?? false),
    // Re-send the other mutable status fields so videos.update doesn't wipe
    // them (it deletes any status property omitted from the request).
    license: (document.getElementById(`license-${videoId}`) as HTMLSelectElement | null)?.value || video.license || 'youtube',
    embeddable: video.embeddable,
    public_stats_viewable: video.public_stats_viewable,
    recording_date: recordingDate,
    latitude,
    longitude
  };

  return { updates, recordingDetailsChanged };
}
