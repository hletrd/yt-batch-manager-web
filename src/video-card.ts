// Video-card HTML template extracted from YouTubeBatchManager.renderVideos
// (A11). All dynamic inputs arrive as explicit parameters/context instead of
// `this`. IMPORTANT: the template literals below are copied byte-for-byte from
// app.ts (including their original indentation, which intentionally does not
// match this module's two-space style) so the rendered innerHTML stays
// byte-identical with the pre-refactor output.

import rendererI18n from './i18n/renderer-i18n.js';
import type { VideoData } from './types.js';
import { formatDuration, formatNumber, isLikelyShort } from './utils/format.js';
import { escapeHtml, escapeHtmlAttribute } from './utils/html.js';

// 16:9 transparent placeholder (muted play glyph). Transparent so the themed
// .video-thumbnail img background shows through in both light and dark mode,
// and 16:9 so it isn't distorted to fill the 320x180 thumbnail slot.
export const DEFAULT_THUMBNAIL = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMyMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTYwIiBjeT0iOTAiIHI9IjI4IiBzdHJva2U9IiM5Y2EzYWYiIHN0cm9rZS13aWR0aD0iMyIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xNTIgNzggTDE3NiA5MCBMMTUyIDEwMiBaIiBmaWxsPSIjOWNhM2FmIi8+PC9zdmc+';

// App-owned lookup/state the card markup depends on.
export interface VideoCardRenderContext {
  videoCategories: Record<string, { id: string; title: string }>;
  i18nLanguages: Record<string, { id: string; name: string }>;
  changedVideos: Set<string>;
}

export function generateCategoryOptions(videoCategories: Record<string, { id: string; title: string }>, selectedCategoryId: string): string {
  // Escape the API-sourced id/title before they enter option markup. The data
  // comes from videoCategories.list (or the fallback map), but escaping keeps
  // this consistent with the rest of the render path and prevents a title/id
  // containing &, <, >, or " from breaking the attribute or the option list.
  const options = Object.values(videoCategories).map(category =>
    `<option value="${escapeHtmlAttribute(category.id)}" ${category.id === selectedCategoryId ? 'selected' : ''}>${escapeHtml(category.title)}</option>`
  );
  return `<option value="">${escapeHtml(rendererI18n.t('form.selectCategory'))}</option>${options.join('')}`;
}

export function generateLanguageOptions(i18nLanguages: Record<string, { id: string; name: string }>, selectedLanguageId?: string): string {
  // Escape the API-sourced id/name before they enter option markup (see
  // generateCategoryOptions). Data is from i18nLanguages.list/fallback, but
  // escaping keeps the render path consistent and special-char-safe.
  const options = Object.values(i18nLanguages).map(language =>
    `<option value="${escapeHtmlAttribute(language.id)}" ${language.id === selectedLanguageId ? 'selected' : ''}>${escapeHtml(language.name)}</option>`
  );
  return `<option value="">${escapeHtml(rendererI18n.t('form.autoLanguage'))}</option>${options.join('')}`;
}

export function generateResponsiveImageHtml(video: VideoData): string {
  // Videos still uploading/processing only have a tiny placeholder thumbnail
  // that looks blurry and stretched when force-upscaled into the 320x180 slot.
  // Show the clean themed placeholder instead until processing completes.
  if (video.upload_status && video.upload_status !== 'processed') {
    return `
      <img src="${escapeHtmlAttribute(DEFAULT_THUMBNAIL)}" alt="Video thumbnail" loading="lazy" />
    `;
  }

  const fallbackUrl = video.thumbnail_url || DEFAULT_THUMBNAIL;

  const srcsetParts: string[] = [];
  const sizesMap: { [key: string]: number } = {
    'default': 120,
    'medium': 320,
    'high': 480,
    'standard': 640,
    'maxres': 1280
  };

  const thumbnailOrder = ['maxres', 'standard', 'high', 'medium', 'default'];

  thumbnailOrder.forEach(key => {
    const thumb = video.thumbnails?.[key];
    if (thumb?.url && sizesMap[key]) {
      // Attribute-escape each URL before it enters the srcset attribute so a
      // crafted (e.g. imported) URL cannot break out and inject a handler.
      srcsetParts.push(`${escapeHtmlAttribute(thumb.url)} ${sizesMap[key]}w`);
    }
  });

  const srcset = srcsetParts.length > 0 ? srcsetParts.join(', ') : '';
  const sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 320px';

  return `
      <img
        src="${escapeHtmlAttribute(fallbackUrl)}"
        ${srcset ? `srcset="${srcset}"` : ''}
        ${srcset ? `sizes="${sizes}"` : ''}
        alt="Video thumbnail"
        loading="lazy"
        onerror="app.handleImageError(this)"
      />
    `;
}

export function renderVideoCardHtml(video: VideoData, ctx: VideoCardRenderContext): string {
  return `
        <div class="video-item${ctx.changedVideos.has(video.id) ? ' changed' : ''}" id="video-${video.id}" data-video-id="${video.id}">
          <div class="video-header">
            <div class="video-thumbnail">
              ${generateResponsiveImageHtml(video)}
              <input type="file" id="thumb-input-${video.id}" class="thumbnail-input" accept="image/jpeg,image/png" hidden onchange="app.handleThumbnailUpload('${video.id}', this)" />
              <button type="button" class="thumbnail-replace-btn" onclick="document.getElementById('thumb-input-${video.id}').click()" data-i18n="video.replaceThumbnail">Replace thumbnail</button>
            </div>
            <div class="video-info">
              <a href="https://www.youtube.com/watch?v=${video.id}" target="_blank" rel="noopener noreferrer" class="video-id-link">
                https://youtu.be/${video.id}
              </a>
              <div class="video-title">${escapeHtml(video.title)}</div>
              <div class="video-published">
                <span class="video-published-text" data-i18n="app.published">Published</span> ${video.published_at.substring(0, 10)}
                ${video.duration ? `<span class="video-duration">${formatDuration(video.duration)}</span>` : ''}
                ${isLikelyShort(video) ? `<span class="short-badge" data-i18n="video.shortBadge">Short</span>` : ''}
                ${video.made_for_kids === true ? `<span class="made-for-kids-badge" data-i18n="video.madeForKids">Made for kids</span>` : ''}
              </div>
              <div class="video-metadata">
                <div class="privacy-control">
                  <select class="privacy-select" id="privacy-${video.id}" onchange="app.handlePrivacyChange('${video.id}')">
                    <option value="private" ${video.privacy_status === 'private' ? 'selected' : ''} data-i18n="privacy.private">Private</option>
                    <option value="unlisted" ${video.privacy_status === 'unlisted' ? 'selected' : ''} data-i18n="privacy.unlisted">Unlisted</option>
                    <option value="public" ${video.privacy_status === 'public' ? 'selected' : ''} data-i18n="privacy.public">Public</option>
                  </select>
                </div>
                <div class="category-control">
                  <select class="category-select" id="category-${video.id}" onchange="app.handleCategoryChange('${video.id}')">
                    ${generateCategoryOptions(ctx.videoCategories, video.category_id)}
                  </select>
                </div>
                <div class="language-control">
                  <select class="language-select" id="language-${video.id}" onchange="app.handleLanguageChange('${video.id}')">
                    ${generateLanguageOptions(ctx.i18nLanguages, video.defaultAudioLanguage)}
                  </select>
                </div>
                <div class="language-control">
                  <label for="default-language-${video.id}" data-i18n="video.titleDescriptionLanguage">Title/description language</label>
                  <select class="language-select" id="default-language-${video.id}" onchange="app.handleDefaultLanguageChange('${video.id}')">
                    ${generateLanguageOptions(ctx.i18nLanguages, video.default_language)}
                  </select>
                </div>
                <div class="language-control">
                  <label for="license-${video.id}" data-i18n="video.license">License</label>
                  <select class="language-select" id="license-${video.id}" onchange="app.handleLicenseChange('${video.id}')">
                    <option value="youtube" ${(video.license || 'youtube') === 'youtube' ? 'selected' : ''} data-i18n="license.standard">Standard YouTube License</option>
                    <option value="creativeCommon" ${video.license === 'creativeCommon' ? 'selected' : ''} data-i18n="license.creativeCommon">Creative Commons - Attribution</option>
                  </select>
                </div>
                <div class="recording-date-control">
                  <label for="recording-date-${video.id}" data-i18n="video.recordingDate">Recording date</label>
                  <input type="date" class="recording-date-input" id="recording-date-${video.id}" value="${escapeHtmlAttribute(video.recording_date || '')}" onchange="app.handleRecordingDateChange('${video.id}')">
                </div>
                <div class="recording-location-control">
                  <label data-i18n="video.recordingLocation">Location</label>
                  <input type="number" step="any" min="-90" max="90" class="recording-location-input" id="latitude-${video.id}" data-i18n-placeholder="video.latitude" placeholder="Latitude" value="${typeof video.latitude === 'number' ? video.latitude : ''}" onchange="app.handleLocationChange('${video.id}')">
                  <input type="number" step="any" min="-180" max="180" class="recording-location-input" id="longitude-${video.id}" data-i18n-placeholder="video.longitude" placeholder="Longitude" value="${typeof video.longitude === 'number' ? video.longitude : ''}" onchange="app.handleLocationChange('${video.id}')">
                  <button type="button" class="location-btn" onclick="app.useCurrentLocation('${video.id}')" data-i18n-title="video.useCurrentLocation" title="Use current location" aria-label="Use current location">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
                  </button>
                  <button type="button" class="location-btn" onclick="app.viewLocationOnMap('${video.id}')" data-i18n-title="video.viewOnMap" title="View on map" aria-label="View on map">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
                  </button>
                </div>
                <div class="synthetic-control">
                  <label class="synthetic-label">
                    <input type="checkbox" class="synthetic-checkbox" id="synthetic-${video.id}" ${video.contains_synthetic_media ? 'checked' : ''} onchange="app.handleSyntheticMediaChange('${video.id}')">
                    <span data-i18n="video.syntheticContent">Altered or synthetic content</span>
                  </label>
                </div>
                ${video.statistics ? `
                  <div class="video-stats">
                    <div class="stat-item">
                      <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                      ${formatNumber(video.statistics.view_count)}
                    </div>
                    <div class="stat-item">
                      <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                      </svg>
                      ${formatNumber(video.statistics.like_count)}
                    </div>
                    <div class="stat-item">
                       <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>
                       </svg>
                       ${formatNumber(video.statistics.dislike_count)}
                     </div>
                    <div class="stat-item">
                      <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                      ${formatNumber(video.statistics.comment_count)}
                    </div>
                  </div>
                ` : ''}
                ${video.upload_status ? `
                  <span class="video-status status-${video.upload_status}">
                    ${video.upload_status}
                  </span>
                ` : ''}
                ${video.processing_status && video.processing_status !== 'succeeded' ? `
                  <span class="video-status status-${video.processing_status}">
                    ${video.processing_status}
                    ${video.processing_status === 'processing' && video.processing_progress ? `
                      <span class="processing-info">
                        (${video.processing_progress.parts_processed || 0}/${video.processing_progress.parts_total || 0})
                      </span>
                    ` : ''}
                  </span>
                ` : ''}
              </div>
            </div>
          </div>

          <div class="form-group">
            <label for="title-${video.id}" data-i18n="form.title">Title</label>
            <div class="title-counter" id="title-counter-${video.id}">${video.title.length}/100</div>
            <input
              type="text"
              class="form-control title-input"
              id="title-${video.id}"
              value="${escapeHtml(video.title)}"
              oninput="app.handleTitleChange('${video.id}'); app.updateTitleCounter('${video.id}')"
            />
          </div>

          <div class="form-group">
            <label for="description-${video.id}" data-i18n="form.description">Description</label>
            <div class="description-counter" id="description-counter-${video.id}">${video.description.length}/5000</div>
            <textarea
              class="form-control"
              id="description-${video.id}"
              oninput="app.handleDescriptionChange('${video.id}'); app.handleTextareaResize(this); app.updateDescriptionCounter('${video.id}')"
            >${escapeHtml(video.description)}</textarea>
          </div>

          <div class="form-group">
            <div class="tags-header">
              <label for="tags-container-${video.id}" data-i18n="form.tags">Tags</label>
              <button type="button" class="tag-copy-btn" onclick="app.copyTags('${video.id}')" data-i18n-title="form.copyTags" title="Copy tags" aria-label="Copy tags">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span data-i18n="form.copyTags">Copy tags</span>
              </button>
              <div class="tags-counter" id="tags-counter-${video.id}">${(video.tags || []).reduce((s, t) => s + t.length, 0)}/500</div>
            </div>
            <div class="tags-container" id="tags-container-${video.id}" onclick="app.focusTagInput('${video.id}')">
              ${(video.tags || []).map(tag => `
                <div class="tag-chip">
                  <span class="tag-text" title="${escapeHtmlAttribute(tag)}">${escapeHtml(tag)}</span>
                  <button type="button" class="tag-remove" data-video-id="${escapeHtmlAttribute(video.id)}" data-tag="${escapeHtmlAttribute(tag)}" aria-label="Remove tag">×</button>
                </div>
              `).join('')}
              <input
                type="text"
                class="tag-input"
                id="tag-input-${video.id}"
                placeholder="${rendererI18n.t('form.tagsPlaceholder')}"
                onkeydown="app.handleTagKeydown(event, '${video.id}')"
                oninput="app.handleTagChange('${video.id}')"
                onpaste="app.handleTagPaste(event, '${video.id}')"
                onblur="app.handleTagBlur(event, '${video.id}')"
              />
            </div>
          </div>

          <div class="video-actions">
            <button class="btn btn-success" onclick="app.updateVideo('${video.id}')" id="update-btn-${video.id}" style="display: ${ctx.changedVideos.has(video.id) ? 'inline-flex' : 'none'};" data-i18n="buttons.updateVideoInfo">
              Update Video
            </button>
          </div>
        </div>
      `;
}
