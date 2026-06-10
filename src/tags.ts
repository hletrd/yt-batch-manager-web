// Tag-editing subsystem extracted from YouTubeBatchManager (A11): the tag
// chips renderer, the tag input handlers (keydown/comma/paste/blur), add /
// remove / copy, and the tags character counter. The DOM ids, markup, and
// inline-handler wiring are unchanged; the app's public handleTag* / addTag /
// removeTag / copyTags methods now delegate here. App-state access (video
// lookup, change marking/re-checking) is injected via TagEditorDeps.

import rendererI18n from './i18n/renderer-i18n.js';
import type { VideoData } from './types.js';
import { escapeHtml, escapeHtmlAttribute } from './utils/html.js';
import { showStatus } from './ui-feedback.js';

export interface TagEditorDeps {
  getVideo(videoId: string): VideoData | undefined;
  markChanged(videoId: string): void;
  checkForChanges(videoId: string): void;
}

export function getCurrentTags(videoId: string): string[] {
  const tagsContainer = document.getElementById(`tags-container-${videoId}`);
  if (!tagsContainer) return [];

  const tagElements = tagsContainer.querySelectorAll('.tag-text');
  return Array.from(tagElements).map(el => el.textContent || '');
}

export function updateTagsCounter(videoId: string): void {
  const containerEl = document.getElementById(`tags-container-${videoId}`);
  const counterEl = document.getElementById(`tags-counter-${videoId}`);
  if (containerEl && counterEl) {
    // YouTube limits tags by total character count (~500), not by number of
    // tags. Count the combined length of all tag texts so the counter and its
    // warning threshold match the real limit and the initial-render format.
    const tagTexts = Array.from(containerEl.querySelectorAll('.tag-text'));
    const usedChars = tagTexts.reduce((sum, el) => sum + (el.textContent || '').length, 0);
    counterEl.textContent = `${usedChars}/500`;
    counterEl.className = `tags-counter ${usedChars > 450 ? 'warning' : ''}`;
  }
}

export function focusTagInput(videoId: string): void {
  const tagInput = document.getElementById(`tag-input-${videoId}`) as HTMLInputElement;
  if (tagInput) {
    tagInput.focus();
  }
}

export function handleTagKeydown(deps: TagEditorDeps, event: KeyboardEvent, videoId: string): void {
  const input = event.target as HTMLInputElement;

  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    processTagInput(deps, videoId, input.value.trim());
    input.value = '';
  }

  if (event.key === 'Backspace' && input.value === '' && input.selectionStart === 0) {
    const tagsContainer = document.getElementById(`tags-container-${videoId}`);
    const tagChips = tagsContainer?.querySelectorAll('.tag-chip');
    if (tagChips && tagChips.length > 0) {
      const lastTag = tagChips[tagChips.length - 1];
      const tagText = lastTag.querySelector('.tag-text')?.textContent;
      if (tagText) {
        removeTag(deps, videoId, tagText);
      }
    }
  }
}

export function handleTagChange(deps: TagEditorDeps, videoId: string): void {
  const input = document.getElementById(`tag-input-${videoId}`) as HTMLInputElement;
  if (input && input.value.includes(',')) {
    const tags = input.value.split(',').map(tag => tag.trim()).filter(tag => tag);
    input.value = '';
    tags.forEach(tag => processTagInput(deps, videoId, tag));
  }
}

export function processTagInput(deps: TagEditorDeps, videoId: string, inputValue: string): void {
  if (!inputValue || inputValue.length === 0) return;

  const tags = inputValue.split(',').map(tag => tag.trim()).filter(tag => tag && tag.length > 0);
  tags.forEach(tag => addTag(deps, videoId, tag));
}

export function handleTagPaste(deps: TagEditorDeps, event: ClipboardEvent, videoId: string): void {
  event.preventDefault();
  const paste = event.clipboardData?.getData('text') || '';
  const tags = paste.split(/[,\n\t]/).map(tag => tag.trim()).filter(tag => tag && tag.length > 0);

  tags.forEach(tag => addTag(deps, videoId, tag));
}

export function handleTagBlur(deps: TagEditorDeps, event: FocusEvent, videoId: string): void {
  const input = event.target as HTMLInputElement;
  if (input.value.trim()) {
    processTagInput(deps, videoId, input.value.trim());
    input.value = '';
  }
}

export async function copyTags(videoId: string): Promise<void> {
  const tags = getCurrentTags(videoId);
  if (tags.length === 0) {
    showStatus(rendererI18n.t('status.noTagsToCopy'), 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(tags.join(', '));
    showStatus(rendererI18n.t('status.tagsCopied', { count: tags.length }), 'success');
  } catch {
    showStatus(rendererI18n.t('status.failedToCopyTags'), 'error');
  }
}

export function addTag(deps: TagEditorDeps, videoId: string, tagText: string): void {
  if (!tagText || tagText.length === 0) return;

  const video = deps.getVideo(videoId);
  if (!video) return;

  const cleanTag = tagText.trim();
  if (!video.tags) {
    video.tags = [];
  }

  const tagExists = video.tags.some(tag => tag.toLowerCase() === cleanTag.toLowerCase());
  if (tagExists) return;

  video.tags.push(cleanTag);

  renderTagsContainer(deps, videoId);
  updateTagsCounter(videoId);
  deps.markChanged(videoId);
  deps.checkForChanges(videoId);

  // rAF instead of a 10ms timer (A28): the rebuilt tag input exists
  // synchronously after renderTagsContainer, so refocusing on the next
  // frame keeps the caret in the tag input without an arbitrary delay.
  requestAnimationFrame(() => {
    const input = document.getElementById(`tag-input-${videoId}`) as HTMLInputElement;
    if (input) {
      input.focus();
    }
  });
}

export function renderTagsContainer(deps: TagEditorDeps, videoId: string): void {
  const container = document.getElementById(`tags-container-${videoId}`);
  const video = deps.getVideo(videoId);

  if (!container || !video) return;

  const currentInput = container.querySelector('.tag-input') as HTMLInputElement;
  const hadFocus = currentInput && document.activeElement === currentInput;

  const tagsHtml = (video.tags || []).map(tag => `
      <div class="tag-chip">
        <span class="tag-text" title="${escapeHtmlAttribute(tag)}">${escapeHtml(tag)}</span>
        <button type="button" class="tag-remove" data-video-id="${escapeHtmlAttribute(videoId)}" data-tag="${escapeHtmlAttribute(tag)}" aria-label="Remove tag">×</button>
      </div>
    `).join('');

  const tagInput = container.querySelector('.tag-input') as HTMLInputElement;
  const placeholder = tagInput?.placeholder || rendererI18n.t('form.tagsPlaceholder');

  container.innerHTML = `
      ${tagsHtml}
      <input
        type="text"
        class="tag-input"
        id="tag-input-${videoId}"
        placeholder="${escapeHtmlAttribute(placeholder)}"
        onkeydown="app.handleTagKeydown(event, '${videoId}')"
        oninput="app.handleTagChange('${videoId}')"
        onpaste="app.handleTagPaste(event, '${videoId}')"
        onblur="app.handleTagBlur(event, '${videoId}')"
      />
    `;

  if (hadFocus) {
    const newInput = container.querySelector('.tag-input') as HTMLInputElement;
    if (newInput) {
      // rAF instead of setTimeout(0) (A28): restore focus on the next frame,
      // after the innerHTML replacement above has been fully processed.
      requestAnimationFrame(() => newInput.focus());
    }
  }
}

export function removeTag(deps: TagEditorDeps, videoId: string, tagText: string): void {
  const video = deps.getVideo(videoId);
  if (!video || !video.tags) return;

  video.tags = video.tags.filter(tag => tag !== tagText);

  renderTagsContainer(deps, videoId);
  updateTagsCounter(videoId);
  deps.markChanged(videoId);
  deps.checkForChanges(videoId);

  // rAF instead of a 10ms timer (A28): see addTag.
  requestAnimationFrame(() => {
    const input = document.getElementById(`tag-input-${videoId}`) as HTMLInputElement;
    if (input) {
      input.focus();
    }
  });
}
