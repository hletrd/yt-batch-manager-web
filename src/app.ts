import rendererI18n from './i18n/renderer-i18n.js';
import { YouTubeAPI } from './youtube-api.js';
import type { VideoData, ThumbnailData } from './types.js';

interface AppState {
  changedVideos: Set<string>;
  allVideos: VideoData[];
  displayedVideos: VideoData[];
  currentSort: string;
  videosPerPage: number;
  currentPage: number;
  isLoading: boolean;
}

interface VideoCacheData {
  videos: VideoData[];
  timestamp: number;
  channelId?: string;
}

interface TemporaryFormData {
  title: string;
  description: string;
  privacy_status: string;
  category_id: string;
  defaultAudioLanguage?: string;
  tags: string[];
}

interface TemporaryChangesData {
  changed: Record<string, TemporaryFormData>;
}

class YouTubeBatchManager {
  private state: AppState = {
    changedVideos: new Set(),
    allVideos: [],
    displayedVideos: [],
    currentSort: 'date-desc',
    videosPerPage: 20,
    currentPage: 0,
    isLoading: false,
  };
  private originalVideosState: Map<string, VideoData> = new Map();
  // id -> live VideoData index, mirroring state.allVideos. Rebuilt whenever
  // allVideos is (re)assigned so hot-path lookups in per-keystroke handlers are
  // O(1) instead of a linear scan over potentially hundreds of videos.
  private videoIndex: Map<string, VideoData> = new Map();
  private youtubeAPI: YouTubeAPI;
  private batchSaveInProgress: boolean = false;
  private skipCacheUpdates: boolean = false;
  // 16:9 transparent placeholder (muted play glyph). Transparent so the themed
  // .video-thumbnail img background shows through in both light and dark mode,
  // and 16:9 so it isn't distorted to fill the 320x180 thumbnail slot.
  private defaultThumbnail: string = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDMyMCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTYwIiBjeT0iOTAiIHI9IjI4IiBzdHJva2U9IiM5Y2EzYWYiIHN0cm9rZS13aWR0aD0iMyIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xNTIgNzggTDE3NiA5MCBMMTUyIDEwMiBaIiBmaWxsPSIjOWNhM2FmIi8+PC9zdmc+';
  private videoCategories: Record<string, { id: string; title: string }> = {};
  private i18nLanguages: Record<string, { id: string; name: string }> = {};
  private readonly CACHE_EXPIRY_HOURS = 24;
  private readonly VIDEO_CACHE_KEY = 'yt_video_cache';
  private readonly TEMP_CHANGES_KEY = 'yt_temp_form_changes';
  private isOAuthRedirecting = false;
  // In-memory copy of the cached channelId so updateVideoCache does not have to
  // re-parse the entire serialized video cache on every single-video save.
  private cachedChannelId?: string;

  constructor() {
    this.youtubeAPI = new YouTubeAPI();
    this.youtubeAPI.setBeforeRedirectCallback(() => {
      this.isOAuthRedirecting = true;
      this.saveTemporaryChanges();
    });
    this.initializeTheme();
    this.setupEventListeners();
    this.setupInputEditListeners();
    this.setupBeforeUnloadHandler();
    this.initializeApp();

    setTimeout(() => {
      this.updateAuthDependentButtons();
    }, 100);
  }

  // Keep videoIndex in sync with state.allVideos. Call after any assignment to
  // state.allVideos. Lookups go through getVideo() for O(1) access.
  private rebuildVideoIndex(): void {
    this.videoIndex = new Map(this.state.allVideos.map(v => [v.id, v]));
  }

  private getVideo(videoId: string): VideoData | undefined {
    return this.videoIndex.get(videoId);
  }

  // Parse an ISO-8601 duration (e.g. P1DT2H3M4S) into days/hours/minutes/seconds.
  // Long uploads/archives can exceed 24h and carry a days (D) component, which
  // the previous PT-only regex silently dropped.
  private parseIsoDuration(isoDuration?: string): { days: number; hours: number; minutes: number; seconds: number } | null {
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

  private formatDuration(isoDuration?: string): string {
    const parsed = this.parseIsoDuration(isoDuration);
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

  private parseDurationToSeconds(isoDuration?: string): number {
    const parsed = this.parseIsoDuration(isoDuration);
    if (!parsed) return 0;
    return parsed.days * 86400 + parsed.hours * 3600 + parsed.minutes * 60 + parsed.seconds;
  }

  // The Data API has no official "is this a Short" flag, so this is a heuristic:
  // a Short is vertical/square AND 3 minutes or shorter (the current Shorts
  // length limit). Orientation comes from fileDetails (owner-only); a landscape
  // video is never flagged. When the dimensions are unknown (fileDetails absent,
  // e.g. a file import) we fall back to the duration test alone.
  private isLikelyShort(video: VideoData): boolean {
    const seconds = this.parseDurationToSeconds(video.duration);
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

  private formatNumber(num?: string): string {
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

  private showStatus(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    const statusEl = document.getElementById('status-message');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `status-message status-${type} show`;

      setTimeout(() => {
        statusEl.classList.remove('show');
      }, 3000);
    }
  }

  private showAuthenticationPrompt(): void {
    const videoList = document.getElementById('video-list');
    if (!videoList) return;

    videoList.innerHTML = `
      <div class="auth-prompt">
        <div class="auth-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 data-i18n="auth.title">YouTube Authentication Required</h3>
        <p data-i18n="auth.description">Please authenticate with your YouTube account to manage your videos.</p>
        <button class="btn btn-primary auth-button" onclick="app.authenticate()" data-i18n="auth.button">
          Authenticate with YouTube
        </button>
      </div>
    `;

    rendererI18n.updatePageTexts();
  }

  private showLoadingOverlay(mainText?: string, subText?: string): void {
    const overlay = document.getElementById('loading-overlay');
    const mainTextEl = document.getElementById('loading-text');
    const subTextEl = document.getElementById('loading-subtext');

    if (overlay) {
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-busy', 'true');
      setTimeout(() => {
        overlay.classList.add('show');
      }, 10);
    }

    if (mainTextEl && mainText) {
      mainTextEl.textContent = mainText;
    }

    if (subTextEl && subText) {
      subTextEl.textContent = subText;
    }
  }

  private hideLoadingOverlay(): void {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.remove('show');
      overlay.setAttribute('aria-busy', 'false');
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 300);
    }
  }

  private markChanged(videoId: string): void {
    this.state.changedVideos.add(videoId);
    const videoEl = document.getElementById(`video-${videoId}`);
    if (videoEl) {
      videoEl.classList.add('changed');
    }
    this.updateSaveAllButton();
  }

  private unmarkChanged(videoId: string): void {
    this.state.changedVideos.delete(videoId);
    const videoEl = document.getElementById(`video-${videoId}`);
    if (videoEl) {
      videoEl.classList.remove('changed');
    }
    this.updateSaveAllButton();
  }

  private updateAuthDependentButtons(): void {
    const refreshBtn = document.getElementById('refresh-videos-btn') as HTMLButtonElement;
    const logoutBtn = document.getElementById('logout-btn') as HTMLAnchorElement;

    const isAuthenticated = this.youtubeAPI.isLoggedIn();

    if (refreshBtn) {
      refreshBtn.disabled = !isAuthenticated;
      if (!isAuthenticated) {
        refreshBtn.style.opacity = '0.5';
        refreshBtn.style.cursor = 'default';
        refreshBtn.title = rendererI18n.t('tooltips.authRequired');
      } else {
        refreshBtn.style.opacity = '1';
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.title = '';
      }
    }

    if (logoutBtn) {
      if (!isAuthenticated) {
        logoutBtn.style.opacity = '0.5';
        logoutBtn.style.cursor = 'default';
        logoutBtn.style.pointerEvents = 'none';
        logoutBtn.title = rendererI18n.t('tooltips.authRequired');
      } else {
        logoutBtn.style.opacity = '1';
        logoutBtn.style.cursor = 'pointer';
        logoutBtn.style.pointerEvents = 'auto';
        logoutBtn.title = '';
      }
    }
  }

  private updateSaveAllButton(): void {
    const saveAllBtn = document.getElementById('save-all-btn') as HTMLButtonElement;
    const changesCount = document.getElementById('changes-count');

    if (saveAllBtn) {
      if (this.state.changedVideos.size > 0) {
        saveAllBtn.style.display = 'inline-flex';
        saveAllBtn.disabled = this.batchSaveInProgress;
      } else {
        saveAllBtn.style.display = 'none';
      }
    }

    if (changesCount) {
      changesCount.textContent = '(' + this.state.changedVideos.size.toString() + ')';
    }
  }

  private hasCurrentChanges(videoId: string, savedTitle: string, savedDescription: string, savedPrivacyStatus: string, savedCategoryId: string, savedDefaultAudioLanguage?: string, savedContainsSyntheticMedia?: boolean, savedRecordingDate?: string, savedLatitude?: number, savedLongitude?: number, savedLicense?: string, savedDefaultLanguage?: string): boolean {
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

    const currentTags = this.getCurrentTags(videoId);
    const originalTags = this.getOriginalTags(videoId);

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
      !this.arraysEqual(currentTags, originalTags)
    );
  }

  private getCurrentTags(videoId: string): string[] {
    const tagsContainer = document.getElementById(`tags-container-${videoId}`);
    if (!tagsContainer) return [];

    const tagElements = tagsContainer.querySelectorAll('.tag-text');
    return Array.from(tagElements).map(el => el.textContent || '');
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    const minHeight = 140;
    const newHeight = Math.max(textarea.scrollHeight, minHeight);
    textarea.style.height = newHeight + 'px';
  }

  private initializeTextarea(videoId: string): void {
    const textarea = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
    if (textarea) {
      this.autoResizeTextarea(textarea);
      textarea.addEventListener('input', () => {
        this.autoResizeTextarea(textarea);
      });
    }
  }

  private async renderVideos(clear: boolean = false): Promise<void> {
    const videoList = document.getElementById('video-list');
    if (!videoList) return;

    if (clear) {
      videoList.innerHTML = '';
      this.state.displayedVideos = [];
      this.state.currentPage = 0;
    }

    const startIndex = this.state.currentPage * this.state.videosPerPage;
    const endIndex = startIndex + this.state.videosPerPage;
    const videosToAdd = this.state.allVideos.slice(startIndex, endIndex);

    if (videosToAdd.length === 0) {
      if (this.state.allVideos.length === 0) {
        if (!this.youtubeAPI.isLoggedIn() && this.youtubeAPI.hasCredentials()) {
          this.showAuthenticationPrompt();
          return;
        } else if (!this.youtubeAPI.hasCredentials()) {
          videoList.innerHTML = `
            <div class="no-credentials">
              <div class="info-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <h3 data-i18n="credentials.notFound">No Credentials Found</h3>
              <p data-i18n="credentials.notFoundDescription">Please ensure that credentials.json is available at the root of your web server.</p>
            </div>
          `;
          rendererI18n.updatePageTexts();
          return;
        } else {
          videoList.innerHTML = `
            <div class="no-videos">
              <h3 data-i18n="app.noVideosLoaded">No videos loaded</h3>
              <p data-i18n="app.noVideosLoadedDescription">Click "Load from YouTube" to fetch your videos, or "Load from File" to load a previous backup.</p>
            </div>
          `;
          rendererI18n.updatePageTexts();
        }
      }
      this.state.isLoading = false;
      return;
    }

    if (this.state.currentPage === 0 && videosToAdd.length > 0) {
      videoList.innerHTML = '';
    }

    for (let i = 0; i < videosToAdd.length; i++) {
      const video = videosToAdd[i];

      const videoHTML = `
        <div class="video-item${this.state.changedVideos.has(video.id) ? ' changed' : ''}" id="video-${video.id}" data-video-id="${video.id}">
          <div class="video-header">
            <div class="video-thumbnail">
              ${this.generateResponsiveImageHtml(video)}
            </div>
            <div class="video-info">
              <a href="https://www.youtube.com/watch?v=${video.id}" target="_blank" rel="noopener noreferrer" class="video-id-link">
                https://youtu.be/${video.id}
              </a>
              <div class="video-title">${this.escapeHtml(video.title)}</div>
              <div class="video-published">
                <span class="video-published-text" data-i18n="app.published">Published</span> ${video.published_at.substring(0, 10)}
                ${video.duration ? `<span class="video-duration">${this.formatDuration(video.duration)}</span>` : ''}
                ${this.isLikelyShort(video) ? `<span class="short-badge" data-i18n="video.shortBadge">Short</span>` : ''}
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
                    ${this.generateCategoryOptions(video.category_id)}
                  </select>
                </div>
                <div class="language-control">
                  <select class="language-select" id="language-${video.id}" onchange="app.handleLanguageChange('${video.id}')">
                    ${this.generateLanguageOptions(video.defaultAudioLanguage)}
                  </select>
                </div>
                <div class="language-control">
                  <label for="default-language-${video.id}" data-i18n="video.titleDescriptionLanguage">Title/description language</label>
                  <select class="language-select" id="default-language-${video.id}" onchange="app.handleDefaultLanguageChange('${video.id}')">
                    ${this.generateLanguageOptions(video.default_language)}
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
                  <input type="date" class="recording-date-input" id="recording-date-${video.id}" value="${this.escapeHtmlAttribute(video.recording_date || '')}" onchange="app.handleRecordingDateChange('${video.id}')">
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
                      ${this.formatNumber(video.statistics.view_count)}
                    </div>
                    <div class="stat-item">
                      <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                      </svg>
                      ${this.formatNumber(video.statistics.like_count)}
                    </div>
                    <div class="stat-item">
                       <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                         <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>
                       </svg>
                       ${this.formatNumber(video.statistics.dislike_count)}
                     </div>
                    <div class="stat-item">
                      <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                      ${this.formatNumber(video.statistics.comment_count)}
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
              value="${this.escapeHtml(video.title)}"
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
            >${this.escapeHtml(video.description)}</textarea>
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
                  <span class="tag-text" title="${this.escapeHtmlAttribute(tag)}">${this.escapeHtml(tag)}</span>
                  <button type="button" class="tag-remove" data-video-id="${this.escapeHtmlAttribute(video.id)}" data-tag="${this.escapeHtmlAttribute(tag)}" aria-label="Remove tag">×</button>
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
            <button class="btn btn-success" onclick="app.updateVideo('${video.id}')" id="update-btn-${video.id}" style="display: ${this.state.changedVideos.has(video.id) ? 'inline-flex' : 'none'};" data-i18n="buttons.updateVideoInfo">
              Update Video
            </button>
          </div>
        </div>
      `;

      videoList.insertAdjacentHTML('beforeend', videoHTML);
    }

    // Size textareas and refresh counters for the whole inserted batch in a single
    // animation frame instead of one setTimeout per video, avoiding a burst of N
    // timers that each force layout reads. The i18n sweep runs once in the same
    // frame (it queries the entire document per call).
    const insertedIds = videosToAdd.map(v => v.id);
    requestAnimationFrame(() => {
      for (const id of insertedIds) {
        const textarea = document.getElementById(`description-${id}`) as HTMLTextAreaElement;
        if (textarea) {
          textarea.style.height = 'auto';
          this.autoResizeTextarea(textarea);
        }
        this.updateTitleCounter(id);
        this.updateDescriptionCounter(id);
        this.updateTagsCounter(id);
      }
      rendererI18n.updatePageTexts();
    });

    this.state.displayedVideos = this.state.displayedVideos.concat(videosToAdd);
    this.state.currentPage++;
    this.state.isLoading = false;

    const saveJsonLink = document.getElementById('save-json-link');
    if (saveJsonLink) {
      if (this.state.allVideos.length > 0) {
        saveJsonLink.classList.remove('disabled');
      } else {
        saveJsonLink.classList.add('disabled');
      }
    }
  }

  private generateResponsiveImageHtml(video: VideoData): string {
    // Videos still uploading/processing only have a tiny placeholder thumbnail
    // that looks blurry and stretched when force-upscaled into the 320x180 slot.
    // Show the clean themed placeholder instead until processing completes.
    if (video.upload_status && video.upload_status !== 'processed') {
      return `
      <img src="${this.escapeHtmlAttribute(this.defaultThumbnail)}" alt="Video thumbnail" loading="lazy" />
    `;
    }

    const fallbackUrl = video.thumbnail_url || this.defaultThumbnail;

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
        srcsetParts.push(`${this.escapeHtmlAttribute(thumb.url)} ${sizesMap[key]}w`);
      }
    });

    const srcset = srcsetParts.length > 0 ? srcsetParts.join(', ') : '';
    const sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 320px';

    return `
      <img
        src="${this.escapeHtmlAttribute(fallbackUrl)}"
        ${srcset ? `srcset="${srcset}"` : ''}
        ${srcset ? `sizes="${sizes}"` : ''}
        alt="Video thumbnail"
        loading="lazy"
        onerror="app.handleImageError(this)"
      />
    `;
  }

  async authenticate(): Promise<void> {
    if (!this.youtubeAPI.hasCredentials()) {
      this.showStatus(rendererI18n.t('status.credentialsNotLoaded'), 'error');
      return;
    }

    this.showLoadingOverlay(rendererI18n.t('loading.authenticating'), rendererI18n.t('loading.authenticatingSubtext'));

    try {
      this.isOAuthRedirecting = true;
      this.saveTemporaryChanges();

      const result = await this.youtubeAPI.authenticate();
      if (result.success) {
        this.isOAuthRedirecting = false;
        this.showStatus(rendererI18n.t('status.authenticationSuccessful'), 'success');
        this.updateAuthDependentButtons();
        await this.loadVideoMetadata();
        await this.loadVideos();
        this.restoreTemporaryChanges();
      } else if (result.error && !result.error.includes('Redirecting')) {
        this.isOAuthRedirecting = false;
        this.showStatus(rendererI18n.t('status.authenticationFailed') + ': ' + (result.error || 'Unknown error'), 'error');
        this.updateAuthDependentButtons();
        this.showAuthenticationPrompt();
      }
    } catch (error) {
      this.isOAuthRedirecting = false;
      this.showStatus(rendererI18n.t('status.authenticationFailed') + ': ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
      this.updateAuthDependentButtons();
      this.showAuthenticationPrompt();
    } finally {
      this.hideLoadingOverlay();
    }
  }

  private saveVideosToCache(videos: VideoData[], channelId?: string): void {
    try {
      const cacheData: VideoCacheData = {
        videos,
        timestamp: Date.now(),
        channelId
      };
      localStorage.setItem(this.VIDEO_CACHE_KEY, JSON.stringify(cacheData));
      this.cachedChannelId = channelId;
      console.log('Videos cached to localStorage:', videos.length);
    } catch (error) {
      console.warn('Failed to cache videos:', error);
    }
  }

  private loadVideosFromCache(): VideoData[] | null {
    try {
      const cached = localStorage.getItem(this.VIDEO_CACHE_KEY);
      if (!cached) return null;

      const cacheData: VideoCacheData = JSON.parse(cached);
      const now = Date.now();
      const cacheAge = now - cacheData.timestamp;
      const maxAge = this.CACHE_EXPIRY_HOURS * 60 * 60 * 1000;

      if (cacheAge > maxAge) {
        console.log('Cache expired, will load fresh data');
        localStorage.removeItem(this.VIDEO_CACHE_KEY);
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
        localStorage.removeItem(this.VIDEO_CACHE_KEY);
        return null;
      }

      this.cachedChannelId = cacheData.channelId;
      console.log('Loading videos from cache:', cacheData.videos.length);
      return cacheData.videos;
    } catch (error) {
      console.warn('Failed to load cached videos:', error);
      localStorage.removeItem(this.VIDEO_CACHE_KEY);
      return null;
    }
  }

  private clearVideoCache(): void {
    localStorage.removeItem(this.VIDEO_CACHE_KEY);
    this.cachedChannelId = undefined;
    console.log('Video cache cleared');
  }

  private updateVideoCache(): void {
    try {
      if (this.state.allVideos.length > 0) {
        // Reuse the in-memory channelId instead of re-parsing the whole cache on
        // every save.
        this.saveVideosToCache(this.state.allVideos, this.cachedChannelId);
        console.log('Video cache updated with latest changes');
      }
    } catch (error) {
      console.warn('Failed to update video cache:', error);
    }
  }

  async loadVideos(forceRefresh: boolean = false): Promise<void> {
    if (!this.youtubeAPI.isLoggedIn()) {
      this.updateAuthDependentButtons();
      if (this.youtubeAPI.hasCredentials()) {
        this.showAuthenticationPrompt();
      } else {
        this.showStatus(rendererI18n.t('status.credentialsNotLoaded'), 'error');
      }
      return;
    }

    this.state.isLoading = true;

    try {
      let videos: VideoData[] = [];

      if (!forceRefresh) {
        const cachedVideos = this.loadVideosFromCache();
        if (cachedVideos) {
          videos = cachedVideos;
          this.showLoadingOverlay(rendererI18n.t('loading.loadingFromCache'), rendererI18n.t('loading.loadingFromCacheSubtext'));
        }
      }

      if (videos.length === 0 || forceRefresh) {
        this.showLoadingOverlay(rendererI18n.t('loading.loadingFromYouTube'), rendererI18n.t('loading.loadingFromYouTubeSubtext'));
        videos = await this.youtubeAPI.getVideos();

        this.saveVideosToCache(videos);
      }

      this.state.allVideos = videos;
      this.rebuildVideoIndex();
      this.state.displayedVideos = [...videos];
      this.state.changedVideos.clear();

      this.originalVideosState.clear();
      videos.forEach(video => {
        this.originalVideosState.set(video.id, { ...video, tags: [...(video.tags || [])] });
      });

      this.sortAllVideos();
      await this.renderVideos(true);

      const cacheStatus = forceRefresh ? '' : ' ' + rendererI18n.t('status.cached');
      this.showStatus(rendererI18n.t('status.videosLoaded', { count: videos.length }) + cacheStatus, 'success');
    } catch (error) {
      console.error('Error loading videos:', error);
      this.updateAuthDependentButtons();
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (/quotaExceeded|dailyLimitExceeded/i.test(msg)) {
        this.showStatus(rendererI18n.t('status.quotaExceeded'), 'error');
      } else {
        this.showStatus(rendererI18n.t('status.failedToLoadVideos') + ': ' + msg, 'error');
      }
    } finally {
      this.state.isLoading = false;
      this.hideLoadingOverlay();
    }
  }

  async loadChannelInfo(): Promise<void> {
    try {
      console.log('Loading channel info...');
      const channelData = await this.youtubeAPI.getChannelInfo();
      console.log('Channel data received:', channelData);

      if (channelData?.items?.[0]) {
        const channel = channelData.items[0];
        const channelName = document.getElementById('channel-name');
        const channelAvatar = document.getElementById('channel-avatar') as HTMLImageElement;
        const channelInfo = document.getElementById('channel-info');
        const mainContent = document.getElementById('main-content');

        console.log('Channel info:', {
          title: channel.snippet.title,
          hasNameElement: !!channelName,
          hasAvatarElement: !!channelAvatar,
          thumbnailUrl: channel.snippet.thumbnails?.default?.url
        });

        if (channelName) {
          channelName.textContent = channel.snippet.title;
          channelName.removeAttribute('data-i18n');
          console.log('Channel name set to:', channel.snippet.title);
        }

        if (channelAvatar && channel.snippet.thumbnails?.default?.url) {
          channelAvatar.src = channel.snippet.thumbnails.default.url;
          channelAvatar.style.display = 'block';
          console.log('Channel avatar set');
        }

        if (channelInfo) {
          channelInfo.classList.add('show');
        }
        if (mainContent) {
          mainContent.classList.add('with-channel');
        }
      } else {
        console.warn('No channel data found in response');
      }
    } catch (error) {
      console.error('Error loading channel info:', error);
    }
  }

  toggleTheme(): void {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
  }

  private setTheme(theme: string): void {
    document.documentElement.setAttribute('data-theme', theme);
    this.updateThemeIcon(theme);
    localStorage.setItem('theme', theme);
  }

  private updateThemeIcon(theme: string): void {
    const iconPath = document.getElementById('theme-icon-path');
    if (iconPath) {
      if (theme === 'dark') {
        iconPath.setAttribute('d', 'M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93');
      } else {
        iconPath.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
      }
    }
  }

  private initializeTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
      this.updateThemeIcon(savedTheme);
    } else {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.updateThemeIcon(systemPrefersDark ? 'dark' : 'light');
    }
  }

  private setupEventListeners(): void {
    // Coalesce scroll events to at most one handler run per animation frame and
    // register the listener as passive so it never blocks scrolling. handleScroll
    // reads layout properties, so firing it on every raw scroll event caused jank.
    let scrollRafScheduled = false;
    window.addEventListener('scroll', () => {
      if (scrollRafScheduled) return;
      scrollRafScheduled = true;
      requestAnimationFrame(() => {
        scrollRafScheduled = false;
        void this.handleScroll();
      });
    }, { passive: true });

    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      // Delegated tag-remove handling. The tag value is read from data-* rather
      // than interpolated into an inline handler, so a tag containing quotes or
      // other JS-significant characters cannot inject script (see escapeHtmlAttribute).
      const removeBtn = target.closest('.tag-remove') as HTMLElement | null;
      if (removeBtn) {
        const videoId = removeBtn.getAttribute('data-video-id');
        const tag = removeBtn.getAttribute('data-tag');
        if (videoId !== null && tag !== null) {
          this.removeTag(videoId, tag);
        }
        return;
      }

      if (target.closest('.dropdown-content')) {
        document.querySelectorAll('.dropdown').forEach(dropdown => {
          dropdown.classList.remove('show');
        });
      }

      if (!target.closest('.dropdown')) {
        document.querySelectorAll('.dropdown').forEach(dropdown => {
          dropdown.classList.remove('show');
        });
      }

      if (window.innerWidth <= 768 && !target.closest('.header-content')) {
        const mobileMenu = document.getElementById('mobile-menu');
        const burgerMenu = document.querySelector('.burger-menu');
        if (mobileMenu && !mobileMenu.classList.contains('hide')) {
          mobileMenu.classList.add('hide');
          burgerMenu?.classList.remove('active');
          burgerMenu?.setAttribute('aria-expanded', 'false');
        }
      }
    });

    document.addEventListener('focusout', (event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('dropdown-btn')) {
        setTimeout(() => {
          const dropdown = target.closest('.dropdown');
          if (dropdown && !dropdown.querySelector(':focus')) {
            dropdown.classList.remove('show');
          }
        }, 100);
      }
    });

    window.addEventListener('resize', () => {
      const mobileMenu = document.getElementById('mobile-menu');
      const burgerMenu = document.querySelector('.burger-menu');
      if (window.innerWidth > 768) {
        mobileMenu?.classList.remove('hide');
        burgerMenu?.classList.remove('active');
          burgerMenu?.setAttribute('aria-expanded', 'false');
      } else {
        mobileMenu?.classList.add('hide');
        burgerMenu?.classList.remove('active');
          burgerMenu?.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const mobileMenu = document.getElementById('mobile-menu');
        const burgerMenu = document.querySelector('.burger-menu');
        if (mobileMenu && !mobileMenu.classList.contains('hide')) {
          mobileMenu.classList.add('hide');
          burgerMenu?.classList.remove('active');
          burgerMenu?.setAttribute('aria-expanded', 'false');
        }
        document.querySelectorAll('.dropdown').forEach(dropdown => {
          dropdown.classList.remove('show');
        });
      }
    });
  }

  private async initializeApp(): Promise<void> {
    await rendererI18n.waitForInitialization();
    // Reflect the detected UI language on <html lang> for assistive tech (WCAG 3.1.1).
    document.documentElement.lang = rendererI18n.getCurrentLanguage();
    rendererI18n.updatePageTexts();


    console.log('Waiting for YouTube API credentials...');
    await this.youtubeAPI.waitForCredentials();
    console.log('YouTube API credentials ready');

    this.initializeFallbackData();

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    console.log('App initialization - OAuth check:', {
      url: window.location.href,
      hasCode: !!code,
      hasState: !!state,
      code: code ? code.substring(0, 20) + '...' : null,
      state: state ? state.substring(0, 8) + '...' : null
    });

    if (!code && !state && !this.youtubeAPI.isLoggedIn() && this.youtubeAPI.hasRefreshToken()) {
      console.log('Access token expired; attempting silent session restore via refresh token...');
      await this.youtubeAPI.tryRestoreSession();
    }

    if (code && state) {
      this.showLoadingOverlay(rendererI18n.t('loading.processingAuthentication'), rendererI18n.t('loading.processingAuthSubtext'));

      try {
        const result = await this.youtubeAPI.authenticate();
        if (result.success) {
          this.isOAuthRedirecting = false;
          this.showStatus(rendererI18n.t('status.authenticationSuccessful'), 'success');
          this.updateAuthDependentButtons();
          await this.loadVideoMetadata();
          await this.loadVideos();
          this.restoreTemporaryChanges();

          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          this.isOAuthRedirecting = false;
          this.showStatus(rendererI18n.t('status.authenticationFailed') + ': ' + (result.error || 'Unknown error'), 'error');
          this.updateAuthDependentButtons();
          window.history.replaceState({}, document.title, window.location.pathname);
          this.showAuthenticationPrompt();
        }
      } catch (error) {
        this.isOAuthRedirecting = false;
        this.showStatus(rendererI18n.t('status.authenticationFailed') + ': ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
        this.updateAuthDependentButtons();
        window.history.replaceState({}, document.title, window.location.pathname);
        this.showAuthenticationPrompt();
      } finally {
        this.hideLoadingOverlay();
      }
    } else if (this.youtubeAPI.isLoggedIn()) {
      console.log('User is already logged in, loading data...');
      console.log('Auth status:', this.youtubeAPI.getAuthStatus());
      this.showStatus(rendererI18n.t('status.credentialsLoaded'), 'success');
      this.updateAuthDependentButtons();
      await this.loadVideoMetadata();
      await this.loadVideos();
    } else if (this.youtubeAPI.hasCredentials()) {
      this.updateAuthDependentButtons();
      this.showAuthenticationPrompt();
    } else {
      this.updateAuthDependentButtons();
      const videoList = document.getElementById('video-list');
      if (videoList) {
        videoList.innerHTML = `
          <div class="no-credentials">
            <div class="info-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <h3 data-i18n="credentials.notFound">No Credentials Found</h3>
            <p data-i18n="credentials.notFoundDescription">Please ensure that credentials.json is available at the root of your web server.</p>
          </div>
        `;
      }
    }

    setTimeout(() => {
      rendererI18n.updatePageTexts();
    }, 100);
  }

  private initializeFallbackData(): void {
    this.videoCategories = {
      '1': { id: '1', title: 'Film & Animation' },
      '2': { id: '2', title: 'Autos & Vehicles' },
      '10': { id: '10', title: 'Music' },
      '15': { id: '15', title: 'Pets & Animals' },
      '17': { id: '17', title: 'Sports' },
      '19': { id: '19', title: 'Travel & Events' },
      '20': { id: '20', title: 'Gaming' },
      '22': { id: '22', title: 'People & Blogs' },
      '23': { id: '23', title: 'Comedy' },
      '24': { id: '24', title: 'Entertainment' },
      '25': { id: '25', title: 'News & Politics' },
      '26': { id: '26', title: 'Howto & Style' },
      '27': { id: '27', title: 'Education' },
      '28': { id: '28', title: 'Science & Technology' }
    };

    this.i18nLanguages = {
      'en': { id: 'en', name: 'English' },
      'es': { id: 'es', name: 'Spanish' },
      'fr': { id: 'fr', name: 'French' },
      'de': { id: 'de', name: 'German' },
      'it': { id: 'it', name: 'Italian' },
      'pt': { id: 'pt', name: 'Portuguese' },
      'ru': { id: 'ru', name: 'Russian' },
      'ja': { id: 'ja', name: 'Japanese' },
      'ko': { id: 'ko', name: 'Korean' },
      'zh': { id: 'zh', name: 'Chinese' },
      'ar': { id: 'ar', name: 'Arabic' },
      'hi': { id: 'hi', name: 'Hindi' }
    };
  }

  private async loadVideoMetadata(): Promise<void> {
    await Promise.all([
      this.loadVideoCategories(),
      this.loadI18nLanguages(),
      this.loadChannelInfo()
    ]);

    const channelInfo = document.getElementById('channel-info');
    if (channelInfo) channelInfo.classList.add('show');
  }

  private async loadVideoCategories(): Promise<void> {
    if (!this.youtubeAPI.isLoggedIn()) {
      console.log('Skipping video categories load - not authenticated');
      return;
    }

    try {
      const data = await this.youtubeAPI.getVideoCategories();
      this.videoCategories = {};
      data.items?.forEach((category: any) => {
        this.videoCategories[category.id] = {
          id: category.id,
          title: category.snippet.title
        };
      });
      console.log('Video categories loaded from API');
    } catch (error) {
      console.warn('Failed to load video categories, keeping fallback data:', error);
    }
  }

  private generateCategoryOptions(selectedCategoryId: string): string {
    // Escape the API-sourced id/title before they enter option markup. The data
    // comes from videoCategories.list (or the fallback map), but escaping keeps
    // this consistent with the rest of the render path and prevents a title/id
    // containing &, <, >, or " from breaking the attribute or the option list.
    const options = Object.values(this.videoCategories).map(category =>
      `<option value="${this.escapeHtmlAttribute(category.id)}" ${category.id === selectedCategoryId ? 'selected' : ''}>${this.escapeHtml(category.title)}</option>`
    );
    return `<option value="">${this.escapeHtml(rendererI18n.t('form.selectCategory'))}</option>${options.join('')}`;
  }

  private async loadI18nLanguages(): Promise<void> {
    if (!this.youtubeAPI.isLoggedIn()) {
      console.log('Skipping i18n languages load - not authenticated');
      return;
    }

    try {
      const data = await this.youtubeAPI.getI18nLanguages();
      this.i18nLanguages = {};
      data.items?.forEach((language: any) => {
        this.i18nLanguages[language.id] = {
          id: language.id,
          name: language.snippet.name
        };
      });
      console.log('i18n languages loaded from API');
    } catch (error) {
      console.warn('Failed to load i18n languages, keeping fallback data:', error);
    }
  }

  private generateLanguageOptions(selectedLanguageId?: string): string {
    // Escape the API-sourced id/name before they enter option markup (see
    // generateCategoryOptions). Data is from i18nLanguages.list/fallback, but
    // escaping keeps the render path consistent and special-char-safe.
    const options = Object.values(this.i18nLanguages).map(language =>
      `<option value="${this.escapeHtmlAttribute(language.id)}" ${language.id === selectedLanguageId ? 'selected' : ''}>${this.escapeHtml(language.name)}</option>`
    );
    return `<option value="">${this.escapeHtml(rendererI18n.t('form.autoLanguage'))}</option>${options.join('')}`;
  }

  toggleMobileMenu(): void {
    const menu = document.getElementById('mobile-menu');
    const burgerMenu = document.querySelector('.burger-menu');

    if (menu) {
      menu.classList.toggle('hide');

      if (burgerMenu) {
        burgerMenu.classList.toggle('active');
        // Reflect the open/closed state for assistive tech. The menu is open
        // when it does NOT carry the `hide` class.
        burgerMenu.setAttribute('aria-expanded', String(!menu.classList.contains('hide')));
      }
    }
  }

  toggleDropdown(): void {
    const dropdown = document.querySelector('.dropdown');
    if (dropdown) {
      dropdown.classList.toggle('show');
    }
  }

  toggleFileDropdown(): void {
    const dropdown = document.querySelector('.dropdown:last-of-type');
    if (dropdown) {
      dropdown.classList.toggle('show');
    }
  }

  closeDropdowns(): void {
    const dropdowns = document.querySelectorAll('.dropdown');
    dropdowns.forEach(dropdown => {
      dropdown.classList.remove('show');
    });
  }

  async sortVideos(sortType: string): Promise<void> {
    this.state.currentSort = sortType;
    this.sortAllVideos();
    await this.renderVideos(true);

    const sortHint = document.getElementById('current-sort');
    if (sortHint) {
      // Map each sort type to an i18n key and update both the data-i18n attribute
      // and the text so the label stays localized (and re-localizable on a later
      // updatePageTexts sweep) instead of being overwritten with hardcoded English.
      const sortKeys: Record<string, string> = {
        'date-desc': 'sorting.dateNewestFirst',
        'date-asc': 'sorting.dateOldestFirst',
        'title-asc': 'sorting.titleAZ',
        'title-desc': 'sorting.titleZA'
      };
      const key = sortKeys[sortType];
      if (key) {
        sortHint.setAttribute('data-i18n', key);
        sortHint.textContent = rendererI18n.t(key);
      } else {
        sortHint.removeAttribute('data-i18n');
        sortHint.textContent = sortType;
      }
    }
  }

  // Parse a published_at date to epoch ms, treating missing/invalid dates as 0
  // (oldest). Without this an empty published_at (e.g. from an imported backup)
  // yields NaN, and NaN comparisons make the sort order non-deterministic.
  private publishedTime(value: string): number {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  private sortAllVideos(): void {
    this.state.allVideos.sort((a, b) => {
      switch (this.state.currentSort) {
        case 'date-desc':
          return this.publishedTime(b.published_at) - this.publishedTime(a.published_at);
        case 'date-asc':
          return this.publishedTime(a.published_at) - this.publishedTime(b.published_at);
        case 'title-asc':
          return a.title.localeCompare(b.title);
        case 'title-desc':
          return b.title.localeCompare(a.title);
        case 'views-desc':
          return parseInt(b.statistics?.view_count || '0', 10) - parseInt(a.statistics?.view_count || '0', 10);
        case 'views-asc':
          return parseInt(a.statistics?.view_count || '0', 10) - parseInt(b.statistics?.view_count || '0', 10);
        default:
          return 0;
      }
    });
  }

  private async handleScroll(): Promise<void> {
    if (this.state.isLoading || this.state.displayedVideos.length >= this.state.allVideos.length) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    if (scrollTop + windowHeight >= documentHeight - 1000) {
      this.state.isLoading = true;
      await this.renderVideos();
    }
  }

  private setupInputEditListeners(): void {
    const handleInputEdit = () => {
      const activeElement = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
      if (activeElement && (activeElement.classList.contains('title-input') || activeElement.classList.contains('form-control'))) {
        const videoItem = activeElement.closest('.video-item');
        if (videoItem) {
          const videoId = videoItem.getAttribute('data-video-id');
          if (videoId) {
            this.setupInputEditListenersForVideo(videoId);
          }
        }
      }
    };

    document.addEventListener('focus', handleInputEdit, true);
    document.addEventListener('input', handleInputEdit, true);
  }

  private setupInputEditListenersForVideo(videoId: string): void {
    const handleInputEdit = () => {
      this.checkForChanges(videoId);
    };

    const titleInput = document.getElementById(`title-${videoId}`);
    const descriptionInput = document.getElementById(`description-${videoId}`);
    const privacySelect = document.getElementById(`privacy-${videoId}`);
    const categorySelect = document.getElementById(`category-${videoId}`);
    const languageSelect = document.getElementById(`language-${videoId}`);

    [titleInput, descriptionInput, privacySelect, categorySelect, languageSelect].forEach(element => {
      if (element) {
        element.removeEventListener('input', handleInputEdit);
        element.addEventListener('input', handleInputEdit);
      }
    });
  }

  private escapeHtml(text: string): string {
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
  private escapeHtmlAttribute(text: string): string {
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
  private sanitizeImageUrl(url: unknown): string {
    if (typeof url !== 'string' || url.length === 0) return '';
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^data:image\//i.test(trimmed)) return trimmed;
    return '';
  }

  private sanitizeThumbnailMap(thumbnails: unknown): Record<string, ThumbnailData> {
    const clean: Record<string, ThumbnailData> = {};
    if (!thumbnails || typeof thumbnails !== 'object') return clean;
    for (const [key, value] of Object.entries(thumbnails as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const t = value as { url?: unknown; width?: unknown; height?: unknown };
      const safeUrl = this.sanitizeImageUrl(t.url);
      if (!safeUrl) continue;
      clean[key] = {
        url: safeUrl,
        width: typeof t.width === 'number' ? t.width : 0,
        height: typeof t.height === 'number' ? t.height : 0
      };
    }
    return clean;
  }

  async saveAllChanges(): Promise<void> {
    if (this.state.changedVideos.size === 0) {
      this.showStatus(rendererI18n.t('status.noChangesToSave'), 'info');
      return;
    }

    if (this.batchSaveInProgress) {
      this.showStatus(rendererI18n.t('status.saveInProgress'), 'info');
      return;
    }

    this.batchSaveInProgress = true;
    this.skipCacheUpdates = true;
    this.updateSaveAllButton();

    const changedVideosArray = Array.from(this.state.changedVideos);
    let processedCount = 0;
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    this.showLoadingOverlay(
      rendererI18n.t('status.savingBatch', { current: 1, total: changedVideosArray.length }),
      rendererI18n.t('status.processingVideo', { videoNumber: 1 })
    );

    for (let i = 0; i < changedVideosArray.length; i++) {
      const videoId = changedVideosArray[i];
      const video = this.getVideo(videoId);

      if (!video) {
        errorCount++;
        errors.push(`Video ${videoId}: Video not found`);
        continue;
      }

      const original = this.originalVideosState.get(videoId);
      if (!original) {
        errorCount++;
        errors.push(`Video ${videoId}: Original state not found`);
        continue;
      }

      this.showLoadingOverlay(
        rendererI18n.t('status.savingBatch', { current: i + 1, total: changedVideosArray.length }),
        rendererI18n.t('status.processingVideo', { videoNumber: i + 1 })
      );

      try {
        await this.updateVideo(videoId, true);
        successCount++;
      } catch (error) {
        errorCount++;
        errors.push(`Video ${videoId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      processedCount++;
    }

    this.batchSaveInProgress = false;
    this.skipCacheUpdates = false;
    this.hideLoadingOverlay();

    if (successCount > 0) {
      this.showStatus(
        rendererI18n.t('status.batchSaveComplete', {
          successful: successCount,
          failed: errorCount,
          total: processedCount
        }),
        errorCount === 0 ? 'success' : 'info'
      );

      this.updateVideoCache();
    } else {
      this.showStatus(
        rendererI18n.t('status.batchSaveFailed', { failed: errorCount }),
        'error'
      );
    }

    if (errors.length > 0 && errors.length <= 5) {
      console.error('Batch save errors:', errors);
    }

    this.updateSaveAllButton();
  }

  async downloadVideoInfo(): Promise<void> {
    if (this.state.allVideos.length === 0) {
      this.showStatus(rendererI18n.t('status.noVideosToExport'), 'info');
      return;
    }

    try {
      const videoData = this.filterVideoDataForBackup(this.state.allVideos);

      const dataStr = JSON.stringify(videoData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });

      const link = document.createElement('a');
      link.href = URL.createObjectURL(dataBlob);
      link.download = `youtube-videos-${new Date().toISOString().split('T')[0]}.json`;
      link.click();

      URL.revokeObjectURL(link.href);
      this.showStatus(rendererI18n.t('status.videosExported', { count: this.state.allVideos.length }), 'success');
    } catch {
      this.showStatus(rendererI18n.t('status.failedToExportVideos'), 'error');
    }
  }

  private filterVideoDataForBackup(videos: VideoData[]): Record<string, unknown>[] {
    // Emit every editable field for each video. Unset optional fields are written
    // as null (rather than dropped — JSON.stringify omits undefined-valued keys)
    // so the exported JSON is a complete, fill-in-able template. Derived/read-only
    // fields (thumbnails, duration, statistics, pixel dimensions, upload/processing
    // status) are intentionally omitted.
    return videos.map(video => ({
      id: video.id,
      title: video.title,
      description: video.description,
      published_at: video.published_at,
      privacy_status: video.privacy_status,
      category_id: video.category_id,
      tags: video.tags ?? [],
      defaultAudioLanguage: video.defaultAudioLanguage ?? null,
      default_language: video.default_language ?? null,
      recording_date: video.recording_date ?? null,
      latitude: video.latitude ?? null,
      longitude: video.longitude ?? null,
      license: video.license ?? null,
      contains_synthetic_media: video.contains_synthetic_media ?? false,
      made_for_kids: video.made_for_kids ?? null,
      embeddable: video.embeddable ?? null,
      public_stats_viewable: video.public_stats_viewable ?? null
    }));
  }

  async loadFromFile(): Promise<void> {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        this.showLoadingOverlay(rendererI18n.t('app.loading'), rendererI18n.t('loading.importingData'));

        try {
          const text = await file.text();
          const videoData = JSON.parse(text);
          await this.importVideoData(videoData);
        } catch {
          this.showStatus(rendererI18n.t('status.failedToParseData'), 'error');
        } finally {
          this.hideLoadingOverlay();
        }
      };

      input.click();
    } catch {
      this.showStatus(rendererI18n.t('status.failedToSelectFile'), 'error');
    }
  }

  async importVideoData(videoData: VideoData[]): Promise<void> {
    if (!Array.isArray(videoData)) {
      this.showStatus(rendererI18n.t('status.invalidFileFormat'), 'error');
      return;
    }

    // A YouTube video id is exactly 11 chars from [A-Za-z0-9_-]. The id is later
    // interpolated into single-quoted JS strings inside inline on* handlers
    // (renderVideos/renderTagsContainer), so an unconstrained id from an imported
    // backup is a DOM-XSS sink. Constraining the id to this charset here makes that
    // interpolation safe and is the primary defense; records with a bad id are
    // dropped rather than rendered.
    const validIdPattern = /^[A-Za-z0-9_-]{11}$/;
    videoData = videoData.filter(video =>
      video && typeof video.id === 'string' && validIdPattern.test(video.id) &&
      video.title != null
    );

    if (videoData.length === 0) {
      this.showStatus(rendererI18n.t('status.invalidVideoData'), 'error');
      return;
    }

    // Defense-in-depth: coerce/sanitize each imported record's fields rather than
    // trusting the file shape. Tags must be an array of strings; privacy_status
    // is constrained to the known set; text fields are coerced to strings;
    // contains_synthetic_media to a boolean. This bounds what later flows into
    // the DOM and into YouTube update requests.
    const allowedPrivacy = new Set(['private', 'unlisted', 'public']);
    videoData = videoData.map((video: VideoData) => ({
      ...video,
      title: typeof video.title === 'string' ? video.title : String(video.title ?? ''),
      description: typeof video.description === 'string' ? video.description : String(video.description ?? ''),
      privacy_status: allowedPrivacy.has(video.privacy_status) ? video.privacy_status : 'private',
      category_id: video.category_id != null ? String(video.category_id) : '22',
      tags: Array.isArray(video.tags) ? video.tags.filter((t): t is string => typeof t === 'string') : [],
      defaultAudioLanguage: typeof video.defaultAudioLanguage === 'string' ? video.defaultAudioLanguage : undefined,
      // Normalize optional fields: the backup writes unset values as null, but a
      // null must become undefined here so it is treated as "not set" and is not
      // sent to videos.update (which would wipe or reject the field).
      default_language: typeof video.default_language === 'string' ? video.default_language : undefined,
      recording_date: typeof video.recording_date === 'string' ? video.recording_date : undefined,
      latitude: typeof video.latitude === 'number' ? video.latitude : undefined,
      longitude: typeof video.longitude === 'number' ? video.longitude : undefined,
      license: typeof video.license === 'string' ? video.license : undefined,
      made_for_kids: typeof video.made_for_kids === 'boolean' ? video.made_for_kids : undefined,
      embeddable: typeof video.embeddable === 'boolean' ? video.embeddable : undefined,
      public_stats_viewable: typeof video.public_stats_viewable === 'boolean' ? video.public_stats_viewable : undefined,
      contains_synthetic_media: video.contains_synthetic_media === true,
      // Thumbnail URLs flow into src/srcset attributes. Keep them only when they
      // are strings with a safe scheme; non-conforming values are dropped so the
      // default thumbnail is used (see also escapeHtmlAttribute in the renderer).
      thumbnail_url: this.sanitizeImageUrl(video.thumbnail_url),
      thumbnails: this.sanitizeThumbnailMap(video.thumbnails)
    }));

    // Preserve any existing YouTube baseline so we can detect which imported
    // videos actually differ from what is live on YouTube. A plain file-only
    // load (no baseline) just becomes the new baseline and is NOT pre-marked as
    // changed: the save prompt appears only for videos the user edits, or for
    // videos that genuinely differ from a loaded YouTube baseline.
    const baselineState = new Map(this.originalVideosState);

    this.state.allVideos = videoData;
    this.rebuildVideoIndex();
    this.state.displayedVideos = [...videoData];
    this.state.changedVideos.clear();
    this.originalVideosState.clear();

    videoData.forEach((video: VideoData) => {
      const baseline = baselineState.get(video.id);
      if (baseline) {
        this.originalVideosState.set(video.id, baseline);
        if (this.videoDiffersFromBaseline(video, baseline)) {
          this.state.changedVideos.add(video.id);
        }
      } else {
        this.originalVideosState.set(video.id, { ...video, tags: [...(video.tags || [])] });
      }
    });

    await this.renderVideos(true);
    this.updateSaveAllButton();
    this.showStatus(rendererI18n.t('status.videosImported', { count: videoData.length }), 'success');
  }

  async logout(): Promise<void> {
    try {
      this.youtubeAPI.logout();
      this.state.allVideos = [];
      this.rebuildVideoIndex();
      this.state.displayedVideos = [];
      this.state.changedVideos.clear();
      this.originalVideosState.clear();
      this.clearVideoCache();
      this.clearTemporaryChanges();
      this.updateAuthDependentButtons();

      const channelName = document.getElementById('channel-name');
      if (channelName) {
        channelName.setAttribute('data-i18n', 'app.loading');
        channelName.textContent = 'Loading...';
      }

      const channelInfo = document.getElementById('channel-info');
      const mainContent = document.getElementById('main-content');
      if (channelInfo) {
        channelInfo.classList.remove('show');
      }
      if (mainContent) {
        mainContent.classList.remove('with-channel');
      }

      if (this.youtubeAPI.hasCredentials()) {
        this.showAuthenticationPrompt();
      } else {
        const container = document.getElementById('video-list');
        if (container) {
          container.innerHTML = `
            <div class="no-videos">
              <h3 data-i18n="app.noVideosLoaded">No videos loaded</h3>
            </div>
          `;
        }
      }

      this.showStatus(rendererI18n.t('status.loggedOut'), 'success');
    } catch {
      this.showStatus(rendererI18n.t('status.failedToLogout'), 'error');
      this.updateAuthDependentButtons();
    }
  }

  async deleteCache(): Promise<void> {
    try {
      // Clear the full auth/session key set. oauth_code_verifier was previously
      // omitted here while clearStoredToken removes it, leaving a stale verifier
      // behind on this path.
      const keysToRemove = ['youtube_access_token', 'youtube_token_expiry', 'youtube_refresh_token', 'oauth_state', 'oauth_code_verifier'];
      keysToRemove.forEach(key => localStorage.removeItem(key));

      this.state.allVideos = [];
      this.rebuildVideoIndex();
      this.state.displayedVideos = [];
      this.state.changedVideos.clear();
      this.originalVideosState.clear();
      this.clearVideoCache();

      const container = document.getElementById('video-list');
      if (container) {
        container.innerHTML = '';
      }

      this.showStatus(rendererI18n.t('status.cacheCleared'), 'success');
    } catch {
      this.showStatus(rendererI18n.t('status.failedToClearCache'), 'error');
    }
  }

  async removeSavedCredentials(): Promise<void> {
    try {
      // logout() -> clearStoredToken() already removes the full token/OAuth key
      // set (including oauth_code_verifier), so no separate manual list is needed.
      this.youtubeAPI.logout();

      this.state.allVideos = [];
      this.rebuildVideoIndex();
      this.state.displayedVideos = [];
      this.state.changedVideos.clear();
      this.originalVideosState.clear();
      this.clearVideoCache();
      this.clearTemporaryChanges();

      const channelName = document.getElementById('channel-name');
      if (channelName) {
        channelName.setAttribute('data-i18n', 'app.loading');
        channelName.textContent = 'Loading...';
      }

      const channelInfo = document.getElementById('channel-info');
      const mainContent = document.getElementById('main-content');
      if (channelInfo) {
        channelInfo.classList.remove('show');
      }
      if (mainContent) {
        mainContent.classList.remove('with-channel');
      }

      if (this.youtubeAPI.hasCredentials()) {
        this.showAuthenticationPrompt();
      } else {
        const container = document.getElementById('video-list');
        if (container) {
          container.innerHTML = `
            <div class="no-videos">
              <h3 data-i18n="app.noVideosLoaded">No videos loaded</h3>
            </div>
          `;
        }
      }

      this.showStatus(rendererI18n.t('status.credentialsRemoved'), 'success');
    } catch {
      this.showStatus(rendererI18n.t('status.failedToRemoveCredentials'), 'error');
    }
  }

  async selectCredentialsFile(): Promise<void> {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        try {
          const result = await this.youtubeAPI.setCredentials(file);
          if (result.success) {
            this.showStatus(rendererI18n.t('status.credentialsLoaded'), 'success');
            await this.authenticate();
          } else {
            this.showStatus(rendererI18n.t('status.failedToLoadCredentials') + ': ' + (result.error || 'Unknown error'), 'error');
          }
        } catch (error) {
          this.showStatus(rendererI18n.t('status.failedToParseCredentialsFile') + ': ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
        }
      };

      input.click();
    } catch {
      this.showStatus(rendererI18n.t('status.failedToSelectFile'), 'error');
    }
  }

  updateTitleCounter(videoId: string): void {
    const titleEl = document.getElementById(`title-${videoId}`) as HTMLInputElement;
    const counterEl = document.getElementById(`title-counter-${videoId}`);
    if (titleEl && counterEl) {
      const length = titleEl.value.length;
      counterEl.textContent = `${length}/100`;
      counterEl.className = `title-counter ${length > 90 ? 'warning' : ''}`;
    }
  }

  updateDescriptionCounter(videoId: string): void {
    const descEl = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
    const counterEl = document.getElementById(`description-counter-${videoId}`);
    if (descEl && counterEl) {
      const length = descEl.value.length;
      counterEl.textContent = `${length}/5000`;
      counterEl.className = `description-counter ${length > 4500 ? 'warning' : ''}`;
    }
  }

  updateTagsCounter(videoId: string): void {
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

  focusTagInput(videoId: string): void {
    const tagInput = document.getElementById(`tag-input-${videoId}`) as HTMLInputElement;
    if (tagInput) {
      tagInput.focus();
    }
  }

  handleTitleChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  handleDescriptionChange(videoId: string): void {
    const textarea = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
    if (textarea) {
      this.autoResizeTextarea(textarea);
    }
    this.checkForChanges(videoId);
  }

  handlePrivacyChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  handleCategoryChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  handleLanguageChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  handleSyntheticMediaChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  handleRecordingDateChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  handleLocationChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  useCurrentLocation(videoId: string): void {
    if (!navigator.geolocation) {
      this.showStatus(rendererI18n.t('status.geolocationUnavailable'), 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latEl = document.getElementById(`latitude-${videoId}`) as HTMLInputElement | null;
        const lngEl = document.getElementById(`longitude-${videoId}`) as HTMLInputElement | null;
        if (latEl) latEl.value = pos.coords.latitude.toFixed(6);
        if (lngEl) lngEl.value = pos.coords.longitude.toFixed(6);
        this.checkForChanges(videoId);
      },
      () => {
        this.showStatus(rendererI18n.t('status.geolocationFailed'), 'error');
      }
    );
  }

  viewLocationOnMap(videoId: string): void {
    const lat = (document.getElementById(`latitude-${videoId}`) as HTMLInputElement | null)?.value.trim();
    const lng = (document.getElementById(`longitude-${videoId}`) as HTMLInputElement | null)?.value.trim();
    if (!lat || !lng) {
      this.showStatus(rendererI18n.t('status.noLocationSet'), 'info');
      return;
    }
    window.open(`https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`, '_blank', 'noopener');
  }

  handleLicenseChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  handleDefaultLanguageChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  private parseCoordInput(raw: string | undefined, fallback: number | undefined): number | undefined {
    if (raw === undefined) return fallback;
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }

  private checkForChanges(videoId: string): void {
    const video = this.getVideo(videoId);
    const original = this.originalVideosState.get(videoId);

    if (!video || !original) return;

    const updateBtn = document.getElementById(`update-btn-${videoId}`) as HTMLButtonElement;

    const hasChanges = this.hasCurrentChanges(
      videoId,
      original.title,
      original.description,
      original.privacy_status,
      original.category_id,
      original.defaultAudioLanguage,
      original.contains_synthetic_media,
      original.recording_date,
      original.latitude,
      original.longitude,
      original.license,
      original.default_language
    );

    if (hasChanges) {
      this.markChanged(videoId);
      if (updateBtn) {
        updateBtn.style.display = 'inline-flex';
      }
    } else {
      this.unmarkChanged(videoId);
      if (updateBtn) {
        updateBtn.style.display = 'none';
      }
    }
  }

  private getOriginalTags(videoId: string): string[] {
    const original = this.originalVideosState.get(videoId);
    return original?.tags || [];
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((val, index) => val === b[index]);
  }

  private videoDiffersFromBaseline(video: VideoData, baseline: VideoData): boolean {
    return (
      (video.title || '') !== (baseline.title || '') ||
      (video.description || '') !== (baseline.description || '') ||
      (video.privacy_status || '') !== (baseline.privacy_status || '') ||
      (video.category_id || '') !== (baseline.category_id || '') ||
      (video.defaultAudioLanguage || '') !== (baseline.defaultAudioLanguage || '') ||
      (video.contains_synthetic_media || false) !== (baseline.contains_synthetic_media || false) ||
      (video.recording_date || '') !== (baseline.recording_date || '') ||
      (video.latitude ?? null) !== (baseline.latitude ?? null) ||
      (video.longitude ?? null) !== (baseline.longitude ?? null) ||
      (video.license || 'youtube') !== (baseline.license || 'youtube') ||
      (video.default_language || '') !== (baseline.default_language || '') ||
      !this.arraysEqual(video.tags || [], baseline.tags || [])
    );
  }

  handleTextareaResize(textarea: HTMLTextAreaElement): void {
    this.autoResizeTextarea(textarea);
  }

  handleImageError(img: HTMLImageElement): void {
    if (img.src !== this.defaultThumbnail) {
      img.src = this.defaultThumbnail;
    }
  }

  handleTagKeydown(event: KeyboardEvent, videoId: string): void {
    const input = event.target as HTMLInputElement;

    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.processTagInput(videoId, input.value.trim());
      input.value = '';
    }

    if (event.key === 'Backspace' && input.value === '' && input.selectionStart === 0) {
      const tagsContainer = document.getElementById(`tags-container-${videoId}`);
      const tagChips = tagsContainer?.querySelectorAll('.tag-chip');
      if (tagChips && tagChips.length > 0) {
        const lastTag = tagChips[tagChips.length - 1];
        const tagText = lastTag.querySelector('.tag-text')?.textContent;
        if (tagText) {
          this.removeTag(videoId, tagText);
        }
      }
    }
  }

  handleTagChange(videoId: string): void {
    const input = document.getElementById(`tag-input-${videoId}`) as HTMLInputElement;
    if (input && input.value.includes(',')) {
      const tags = input.value.split(',').map(tag => tag.trim()).filter(tag => tag);
      input.value = '';
      tags.forEach(tag => this.processTagInput(videoId, tag));
    }
  }

  processTagInput(videoId: string, inputValue: string): void {
    if (!inputValue || inputValue.length === 0) return;

    const tags = inputValue.split(',').map(tag => tag.trim()).filter(tag => tag && tag.length > 0);
    tags.forEach(tag => this.addTag(videoId, tag));
  }

  handleTagPaste(event: ClipboardEvent, videoId: string): void {
    event.preventDefault();
    const paste = event.clipboardData?.getData('text') || '';
    const tags = paste.split(/[,\n\t]/).map(tag => tag.trim()).filter(tag => tag && tag.length > 0);

    tags.forEach(tag => this.addTag(videoId, tag));
  }

  handleTagBlur(event: FocusEvent, videoId: string): void {
    const input = event.target as HTMLInputElement;
    if (input.value.trim()) {
      this.processTagInput(videoId, input.value.trim());
      input.value = '';
    }
  }

  async copyTags(videoId: string): Promise<void> {
    const tags = this.getCurrentTags(videoId);
    if (tags.length === 0) {
      this.showStatus(rendererI18n.t('status.noTagsToCopy'), 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(tags.join(', '));
      this.showStatus(rendererI18n.t('status.tagsCopied', { count: tags.length }), 'success');
    } catch {
      this.showStatus(rendererI18n.t('status.failedToCopyTags'), 'error');
    }
  }

  addTag(videoId: string, tagText: string): void {
    if (!tagText || tagText.length === 0) return;

    const video = this.getVideo(videoId);
    if (!video) return;

    const cleanTag = tagText.trim();
    if (!video.tags) {
      video.tags = [];
    }

    const tagExists = video.tags.some(tag => tag.toLowerCase() === cleanTag.toLowerCase());
    if (tagExists) return;

    video.tags.push(cleanTag);

    this.renderTagsContainer(videoId);
    this.updateTagsCounter(videoId);
    this.markChanged(videoId);
    this.checkForChanges(videoId);

    setTimeout(() => {
      const input = document.getElementById(`tag-input-${videoId}`) as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 10);
  }

  private renderTagsContainer(videoId: string): void {
    const container = document.getElementById(`tags-container-${videoId}`);
    const video = this.getVideo(videoId);

    if (!container || !video) return;

    const currentInput = container.querySelector('.tag-input') as HTMLInputElement;
    const hadFocus = currentInput && document.activeElement === currentInput;

    const tagsHtml = (video.tags || []).map(tag => `
      <div class="tag-chip">
        <span class="tag-text" title="${this.escapeHtmlAttribute(tag)}">${this.escapeHtml(tag)}</span>
        <button type="button" class="tag-remove" data-video-id="${this.escapeHtmlAttribute(videoId)}" data-tag="${this.escapeHtmlAttribute(tag)}" aria-label="Remove tag">×</button>
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
        placeholder="${this.escapeHtmlAttribute(placeholder)}"
        onkeydown="app.handleTagKeydown(event, '${videoId}')"
        oninput="app.handleTagChange('${videoId}')"
        onpaste="app.handleTagPaste(event, '${videoId}')"
        onblur="app.handleTagBlur(event, '${videoId}')"
      />
    `;

    if (hadFocus) {
      const newInput = container.querySelector('.tag-input') as HTMLInputElement;
      if (newInput) {
        setTimeout(() => newInput.focus(), 0);
      }
    }
  }

  removeTag(videoId: string, tagText: string): void {
    const video = this.getVideo(videoId);
    if (!video || !video.tags) return;

    video.tags = video.tags.filter(tag => tag !== tagText);

    this.renderTagsContainer(videoId);
    this.updateTagsCounter(videoId);
    this.markChanged(videoId);
    this.checkForChanges(videoId);

    setTimeout(() => {
      const input = document.getElementById(`tag-input-${videoId}`) as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 10);
  }

  async updateVideo(videoId: string, suppressStatus: boolean = false): Promise<void> {
    const video = this.getVideo(videoId);
    if (!video) return;

    const updateBtn = document.getElementById(`update-btn-${videoId}`) as HTMLButtonElement;

    if (updateBtn) {
      updateBtn.textContent = rendererI18n.t('buttons.updateVideoInfoUpdating');
      updateBtn.disabled = true;
    }

    try {
      const titleEl = document.getElementById(`title-${videoId}`) as HTMLInputElement;
      const descriptionEl = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
      const privacyEl = document.getElementById(`privacy-${videoId}`) as HTMLSelectElement;
      const categoryEl = document.getElementById(`category-${videoId}`) as HTMLSelectElement;
      const languageEl = document.getElementById(`language-${videoId}`) as HTMLSelectElement;

      const syntheticEl = document.getElementById(`synthetic-${videoId}`) as HTMLInputElement;

      // videos.update replaces the whole `status` part, deleting any omitted
      // property. For a video imported from a backup, license/embeddable/
      // public_stats_viewable are unknown locally (the backup export strips them),
      // so re-sending them as undefined would wipe them on YouTube. When all three
      // are missing, backfill the live status from YouTube before building the
      // request so the save preserves the creator's existing settings.
      if (video.license === undefined && video.embeddable === undefined && video.public_stats_viewable === undefined) {
        const liveStatus = await this.youtubeAPI.getVideoStatus(videoId);
        if (liveStatus) {
          video.license = liveStatus.license;
          video.embeddable = liveStatus.embeddable;
          video.public_stats_viewable = liveStatus.public_stats_viewable;
          if (video.made_for_kids === undefined) {
            video.made_for_kids = liveStatus.made_for_kids;
          }
        }
      }

      // Read the live element value when the element exists, falling back to the
      // stored value only when the element is missing. Using `el?.value || stored`
      // would treat an intentionally-cleared field (empty string) as "unchanged"
      // and silently revert it, so an emptied description was never saved.
      const updates = {
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
        recording_date: ((document.getElementById(`recording-date-${videoId}`) as HTMLInputElement | null)?.value) ?? (video.recording_date || ''),
        latitude: this.parseCoordInput((document.getElementById(`latitude-${videoId}`) as HTMLInputElement | null)?.value, video.latitude),
        longitude: this.parseCoordInput((document.getElementById(`longitude-${videoId}`) as HTMLInputElement | null)?.value, video.longitude)
      };

      const result = await this.youtubeAPI.updateVideo(videoId, updates);

      if (result.success) {
        Object.assign(video, updates);

        this.originalVideosState.set(videoId, { ...video, tags: [...(video.tags || [])] });

        const videoTitleEl = document.querySelector(`[data-video-id="${videoId}"] .video-title`);
        if (videoTitleEl) {
          videoTitleEl.textContent = updates.title;
        }

        this.unmarkChanged(videoId);

        if (updateBtn) {
          updateBtn.style.display = 'none';
        }

        if (!suppressStatus) {
          this.showStatus(rendererI18n.t('status.videoUpdated'), 'success');
        }

        if (!this.skipCacheUpdates) {
          this.updateVideoCache();
        }
      } else {
        if (!suppressStatus) {
          this.showStatus(result.error || rendererI18n.t('status.failedToUpdateVideo'), 'error');
        }
        this.checkForChanges(videoId);
      }
    } catch (error) {
      if (!suppressStatus) {
        this.showStatus(rendererI18n.t('status.failedToUpdateVideo') + ': ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
      }
      this.checkForChanges(videoId);
    } finally {
      if (updateBtn) {
        updateBtn.textContent = rendererI18n.t('buttons.updateVideoInfo');
        updateBtn.disabled = false;
      }
    }
  }

  async refreshVideos(): Promise<void> {
    if (!this.youtubeAPI.isLoggedIn()) {
      this.showStatus(rendererI18n.t('status.authRequiredToRefresh'), 'error');
      return;
    }
    console.log('Force refreshing videos from YouTube API...');
    this.updateAuthDependentButtons();
    await this.loadVideos(true);
  }

  private setupBeforeUnloadHandler(): void {
    window.addEventListener('beforeunload', (event) => {
      if (this.isOAuthRedirecting) {
        return undefined;
      }

      if (this.state.changedVideos.size > 0) {
        event.preventDefault();
        return (event.returnValue = 'You have unsaved changes. Are you sure you want to leave?');
      }

      return undefined;
    });
  }

  private saveTemporaryChanges(): void {
    try {
      if (this.state.changedVideos.size === 0) {
        return;
      }

      const tempData: TemporaryChangesData = { changed: {} };

      this.state.changedVideos.forEach(videoId => {
        const titleEl = document.getElementById(`title-${videoId}`) as HTMLInputElement;
        const descriptionEl = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
        const privacyEl = document.getElementById(`privacy-${videoId}`) as HTMLSelectElement;
        const categoryEl = document.getElementById(`category-${videoId}`) as HTMLSelectElement;
        const languageEl = document.getElementById(`language-${videoId}`) as HTMLSelectElement;
        const currentTags = this.getCurrentTags(videoId);

        if (titleEl || descriptionEl || privacyEl || categoryEl || languageEl || currentTags.length > 0) {
          tempData.changed[videoId] = {
            title: titleEl?.value || '',
            description: descriptionEl?.value || '',
            privacy_status: privacyEl?.value || '',
            category_id: categoryEl?.value || '',
            defaultAudioLanguage: languageEl?.value || undefined,
            tags: currentTags
          };
        }
      });

      localStorage.setItem(this.TEMP_CHANGES_KEY, JSON.stringify(tempData));
      console.log('Temporary changes saved for', Object.keys(tempData.changed).length, 'videos');
    } catch (error) {
      console.error('Failed to save temporary changes:', error);
    }
  }

  private restoreTemporaryChanges(): void {
    try {
      const tempDataStr = localStorage.getItem(this.TEMP_CHANGES_KEY);
      if (!tempDataStr) {
        return;
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
          this.handleTitleChange(videoId);
        }

        if (descriptionEl && formData.description !== descriptionEl.value) {
          descriptionEl.value = formData.description;
          this.handleDescriptionChange(videoId);
          this.autoResizeTextarea(descriptionEl);
        }

        if (privacyEl && formData.privacy_status !== privacyEl.value) {
          privacyEl.value = formData.privacy_status;
          this.handlePrivacyChange(videoId);
        }

        if (categoryEl && formData.category_id !== categoryEl.value) {
          categoryEl.value = formData.category_id;
          this.handleCategoryChange(videoId);
        }

        if (languageEl && formData.defaultAudioLanguage !== languageEl.value) {
          languageEl.value = formData.defaultAudioLanguage || '';
          this.handleLanguageChange(videoId);
        }

        if (formData.tags && formData.tags.length > 0) {
          const video = this.getVideo(videoId);
          if (video) {
            video.tags = [...formData.tags];
            this.renderTagsContainer(videoId);
            this.updateTagsCounter(videoId);
            // Re-evaluate change state directly. handleTagChange only inspects the
            // (now empty) tag input and would not mark a tags-only restore as changed.
            this.checkForChanges(videoId);
          }
        }

        restoredCount++;
      });

      localStorage.removeItem(this.TEMP_CHANGES_KEY);

      if (restoredCount > 0) {
        this.showStatus(rendererI18n.t('status.temporaryChangesRestored', { count: restoredCount }), 'info');
        console.log('Restored temporary changes for', restoredCount, 'videos');
      }
    } catch (error) {
      console.error('Failed to restore temporary changes:', error);
      localStorage.removeItem(this.TEMP_CHANGES_KEY);
    }
  }

  private clearTemporaryChanges(): void {
    localStorage.removeItem(this.TEMP_CHANGES_KEY);
  }
}

declare global {
  interface Window {
    app: YouTubeBatchManager;
  }
}

const app = new YouTubeBatchManager();
window.app = app;

export default app;