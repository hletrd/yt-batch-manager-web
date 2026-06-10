// yt_temp_form_changes snapshot persistence extracted from
// YouTubeBatchManager (A11). Saves the in-progress form edits of changed
// videos before an OAuth redirect and restores them after the round-trip.
// DOM reads/writes target the same per-video element ids as before; all
// app-level reactions (change re-checking, tag re-rendering, status toast)
// are injected via explicit deps so behavior stays identical.

import type { VideoData } from './types.js';

interface TemporaryFormData {
  title: string;
  description: string;
  privacy_status: string;
  category_id: string;
  defaultAudioLanguage?: string;
  tags: string[];
  // Editable fields added in later feature cycles. Optional so a snapshot written by an
  // older build (lacking these keys) still restores the original fields without error.
  // Coordinates are stored as the raw input strings (not numbers) so that an emptied
  // coordinate round-trips as '' through JSON (a `number | undefined` would be dropped by
  // JSON.stringify, losing a "cleared the coordinate" edit on restore).
  recording_date?: string;
  latitude?: string;
  longitude?: string;
  license?: string;
  default_language?: string;
  contains_synthetic_media?: boolean;
}

interface TemporaryChangesData {
  changed: Record<string, TemporaryFormData>;
}

const TEMP_CHANGES_KEY = 'yt_temp_form_changes';

export function saveTemporaryChanges(changedVideos: Set<string>, getCurrentTags: (videoId: string) => string[]): void {
  try {
    if (changedVideos.size === 0) {
      return;
    }

    const tempData: TemporaryChangesData = { changed: {} };

    changedVideos.forEach(videoId => {
      const titleEl = document.getElementById(`title-${videoId}`) as HTMLInputElement;
      const descriptionEl = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
      const privacyEl = document.getElementById(`privacy-${videoId}`) as HTMLSelectElement;
      const categoryEl = document.getElementById(`category-${videoId}`) as HTMLSelectElement;
      const languageEl = document.getElementById(`language-${videoId}`) as HTMLSelectElement;
      const recordingDateEl = document.getElementById(`recording-date-${videoId}`) as HTMLInputElement | null;
      const latEl = document.getElementById(`latitude-${videoId}`) as HTMLInputElement | null;
      const lngEl = document.getElementById(`longitude-${videoId}`) as HTMLInputElement | null;
      const licenseEl = document.getElementById(`license-${videoId}`) as HTMLSelectElement | null;
      const defaultLangEl = document.getElementById(`default-language-${videoId}`) as HTMLSelectElement | null;
      const syntheticEl = document.getElementById(`synthetic-${videoId}`) as HTMLInputElement | null;
      const currentTags = getCurrentTags(videoId);

      if (titleEl || descriptionEl || privacyEl || categoryEl || languageEl || currentTags.length > 0) {
        tempData.changed[videoId] = {
          title: titleEl?.value || '',
          description: descriptionEl?.value || '',
          privacy_status: privacyEl?.value || '',
          category_id: categoryEl?.value || '',
          defaultAudioLanguage: languageEl?.value || undefined,
          tags: currentTags,
          // Editable fields added in later cycles. Persisted so an unsaved edit to any of
          // them survives the OAuth-redirect round-trip; only included when the input
          // exists so older layouts still round-trip the original fields. Coordinates are
          // stored as raw strings so a cleared coordinate ('') round-trips through JSON.
          ...(recordingDateEl ? { recording_date: recordingDateEl.value } : {}),
          ...(latEl ? { latitude: latEl.value } : {}),
          ...(lngEl ? { longitude: lngEl.value } : {}),
          ...(licenseEl ? { license: licenseEl.value } : {}),
          ...(defaultLangEl ? { default_language: defaultLangEl.value } : {}),
          ...(syntheticEl ? { contains_synthetic_media: syntheticEl.checked } : {})
        };
      }
    });

    localStorage.setItem(TEMP_CHANGES_KEY, JSON.stringify(tempData));
    console.log('Temporary changes saved for', Object.keys(tempData.changed).length, 'videos');
  } catch (error) {
    console.error('Failed to save temporary changes:', error);
  }
}

// Restore a value into a <select>, preserving it even when its <option> is
// absent (e.g. category/language metadata failed to load and the restored
// value is outside the fallback set). Assigning a value with no matching
// option leaves the select empty and silently drops the user's unsaved
// choice (A32), so the missing option is appended (value doubling as its
// label) and selected. DOM assignment (value/textContent) is used instead of
// HTML interpolation, so the value needs no manual attribute escaping.
function setSelectValuePreservingChoice(select: HTMLSelectElement, value: string): void {
  select.value = value;
  if (value !== '' && select.value !== value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
    select.value = value;
  }
}

// Everything the restore pass needs from the app: per-field change handlers
// (identical to the inline-handler entry points), tag re-rendering, and
// change re-evaluation.
export interface TempChangesRestoreDeps {
  getVideo(videoId: string): VideoData | undefined;
  handleTitleChange(videoId: string): void;
  handleDescriptionChange(videoId: string): void;
  handlePrivacyChange(videoId: string): void;
  handleCategoryChange(videoId: string): void;
  handleLanguageChange(videoId: string): void;
  handleRecordingDateChange(videoId: string): void;
  handleLocationChange(videoId: string): void;
  handleLicenseChange(videoId: string): void;
  handleDefaultLanguageChange(videoId: string): void;
  handleSyntheticMediaChange(videoId: string): void;
  autoResizeTextarea(textarea: HTMLTextAreaElement): void;
  renderTagsContainer(videoId: string): void;
  updateTagsCounter(videoId: string): void;
  checkForChanges(videoId: string): void;
}

// Returns the number of restored videos; the caller owns the user-facing
// status toast.
export function restoreTemporaryChanges(deps: TempChangesRestoreDeps): number {
  try {
    const tempDataStr = localStorage.getItem(TEMP_CHANGES_KEY);
    if (!tempDataStr) {
      return 0;
    }

    const tempData: TemporaryChangesData = JSON.parse(tempDataStr);
    let restoredCount = 0;

    Object.entries(tempData.changed).forEach(([videoId, formData]) => {
      const titleEl = document.getElementById(`title-${videoId}`) as HTMLInputElement;
      const descriptionEl = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
      const privacyEl = document.getElementById(`privacy-${videoId}`) as HTMLSelectElement;
      const categoryEl = document.getElementById(`category-${videoId}`) as HTMLSelectElement;
      const languageEl = document.getElementById(`language-${videoId}`) as HTMLSelectElement;

      if (titleEl && formData.title !== titleEl.value) {
        titleEl.value = formData.title;
        deps.handleTitleChange(videoId);
      }

      if (descriptionEl && formData.description !== descriptionEl.value) {
        descriptionEl.value = formData.description;
        deps.handleDescriptionChange(videoId);
        deps.autoResizeTextarea(descriptionEl);
      }

      if (privacyEl && formData.privacy_status !== privacyEl.value) {
        privacyEl.value = formData.privacy_status;
        deps.handlePrivacyChange(videoId);
      }

      if (categoryEl && formData.category_id !== categoryEl.value) {
        setSelectValuePreservingChoice(categoryEl, formData.category_id);
        deps.handleCategoryChange(videoId);
      }

      if (languageEl && formData.defaultAudioLanguage !== languageEl.value) {
        setSelectValuePreservingChoice(languageEl, formData.defaultAudioLanguage || '');
        deps.handleLanguageChange(videoId);
      }

      // Restore the later-cycle editable fields. Each is tolerant of older snapshots that
      // lack the key (the `in` check leaves the input untouched) and is guarded on the
      // input existing and the value actually differing, mirroring the blocks above.
      if ('recording_date' in formData) {
        const recordingDateEl = document.getElementById(`recording-date-${videoId}`) as HTMLInputElement | null;
        const restored = formData.recording_date || '';
        if (recordingDateEl && recordingDateEl.value !== restored) {
          recordingDateEl.value = restored;
          deps.handleRecordingDateChange(videoId);
        }
      }

      if ('latitude' in formData || 'longitude' in formData) {
        const latEl = document.getElementById(`latitude-${videoId}`) as HTMLInputElement | null;
        const lngEl = document.getElementById(`longitude-${videoId}`) as HTMLInputElement | null;
        let locationChanged = false;
        if (latEl && 'latitude' in formData && latEl.value !== (formData.latitude || '')) {
          latEl.value = formData.latitude || '';
          locationChanged = true;
        }
        if (lngEl && 'longitude' in formData && lngEl.value !== (formData.longitude || '')) {
          lngEl.value = formData.longitude || '';
          locationChanged = true;
        }
        if (locationChanged) {
          deps.handleLocationChange(videoId);
        }
      }

      if ('license' in formData) {
        const licenseEl = document.getElementById(`license-${videoId}`) as HTMLSelectElement | null;
        const restored = formData.license || 'youtube';
        if (licenseEl && licenseEl.value !== restored) {
          licenseEl.value = restored;
          deps.handleLicenseChange(videoId);
        }
      }

      if ('default_language' in formData) {
        const defaultLangEl = document.getElementById(`default-language-${videoId}`) as HTMLSelectElement | null;
        const restored = formData.default_language || '';
        if (defaultLangEl && defaultLangEl.value !== restored) {
          setSelectValuePreservingChoice(defaultLangEl, restored);
          deps.handleDefaultLanguageChange(videoId);
        }
      }

      if ('contains_synthetic_media' in formData) {
        const syntheticEl = document.getElementById(`synthetic-${videoId}`) as HTMLInputElement | null;
        const restored = formData.contains_synthetic_media === true;
        if (syntheticEl && syntheticEl.checked !== restored) {
          syntheticEl.checked = restored;
          deps.handleSyntheticMediaChange(videoId);
        }
      }

      if (formData.tags && formData.tags.length > 0) {
        const video = deps.getVideo(videoId);
        if (video) {
          video.tags = [...formData.tags];
          deps.renderTagsContainer(videoId);
          deps.updateTagsCounter(videoId);
          // Re-evaluate change state directly. handleTagChange only inspects the
          // (now empty) tag input and would not mark a tags-only restore as changed.
          deps.checkForChanges(videoId);
        }
      }

      restoredCount++;
    });

    localStorage.removeItem(TEMP_CHANGES_KEY);

    if (restoredCount > 0) {
      console.log('Restored temporary changes for', restoredCount, 'videos');
    }

    return restoredCount;
  } catch (error) {
    console.error('Failed to restore temporary changes:', error);
    localStorage.removeItem(TEMP_CHANGES_KEY);
    return 0;
  }
}

export function clearTemporaryChanges(): void {
  localStorage.removeItem(TEMP_CHANGES_KEY);
}
