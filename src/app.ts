import rendererI18n from './i18n/renderer-i18n.js';
import { YouTubeAPI } from './youtube-api.js';
import type { VideoData } from './types.js';
import { arraysEqual, parseCoordInput, publishedTime } from './utils/format.js';
import { escapeHtml, escapeHtmlAttribute } from './utils/html.js';
import * as videoCache from './video-cache.js';
import * as tempChanges from './temp-changes.js';
import { DEFAULT_THUMBNAIL, renderVideoCardHtml } from './video-card.js';
import { hideLoadingOverlay, renderNoCredentials, showAuthenticationPrompt, showLoadingOverlay, showStatus } from './ui-feedback.js';
import * as backup from './backup.js';
import * as theme from './theme.js';

interface AppState {
  changedVideos: Set<string>;
  allVideos: VideoData[];
  displayedVideos: VideoData[];
  currentSort: string;
  videosPerPage: number;
  currentPage: number;
  isLoading: boolean;
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
  // Provenance of state.allVideos. Backup imports are thin records (no
  // statistics/thumbnails/duration/upload_status), so cache persistence is
  // limited to YouTube-sourced sets (C2).
  private videosSource: 'youtube' | 'import' = 'youtube';
  private videoCategories: Record<string, { id: string; title: string }> = {};
  private i18nLanguages: Record<string, { id: string; name: string }> = {};
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
    theme.initializeTheme();
    this.setupEventListeners();
    this.setupInputEditListeners();
    this.setupBeforeUnloadHandler();
    this.initializeApp();

    // Real timer (kept, A28): a short startup settle so the auth-dependent
    // buttons reflect the synchronously-restored token state once i18n (which
    // supplies the tooltip strings) has had a moment to initialize; a rAF
    // would race that async init. initializeApp re-runs this authoritatively
    // in every async init branch.
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
      !arraysEqual(currentTags, originalTags)
    );
  }

  private getCurrentTags(videoId: string): string[] {
    const tagsContainer = document.getElementById(`tags-container-${videoId}`);
    if (!tagsContainer) return [];

    const tagElements = tagsContainer.querySelectorAll('.tag-text');
    return Array.from(tagElements).map(el => el.textContent || '');
  }

  // Textareas with a resize already scheduled for the next frame (A30). A
  // WeakSet so entries are GC'd together with their (removed) textareas.
  private pendingTextareaResizes = new WeakSet<HTMLTextAreaElement>();

  // rAF-throttled auto-resize (A30): the resize forces a synchronous reflow
  // (height write + scrollHeight read), so running it inline made every
  // keystroke reflow the page. At most one resize per textarea per frame is
  // scheduled; rapid input events coalesce into a single final resize.
  private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    if (this.pendingTextareaResizes.has(textarea)) {
      return;
    }
    this.pendingTextareaResizes.add(textarea);
    requestAnimationFrame(() => {
      this.pendingTextareaResizes.delete(textarea);
      this.resizeTextareaNow(textarea);
    });
  }

  // Synchronous resize, used directly by callers that are already inside an
  // animation frame (the post-insert batch in renderVideos), where deferring
  // by another frame would flash the unsized textarea for one paint.
  private resizeTextareaNow(textarea: HTMLTextAreaElement): void {
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
          showAuthenticationPrompt();
          return;
        } else if (!this.youtubeAPI.hasCredentials()) {
          renderNoCredentials(videoList);
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

      const videoHTML = renderVideoCardHtml(video, {
        videoCategories: this.videoCategories,
        i18nLanguages: this.i18nLanguages,
        changedVideos: this.state.changedVideos
      });

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
          // Already inside the batch rAF: size synchronously so the first
          // paint of the inserted cards shows correctly-sized textareas.
          this.resizeTextareaNow(textarea);
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

  async authenticate(): Promise<void> {
    if (!this.youtubeAPI.hasCredentials()) {
      showStatus(rendererI18n.t('status.credentialsNotLoaded'), 'error');
      return;
    }

    showLoadingOverlay(rendererI18n.t('loading.authenticating'), rendererI18n.t('loading.authenticatingSubtext'));

    try {
      this.isOAuthRedirecting = true;
      this.saveTemporaryChanges();

      const result = await this.youtubeAPI.authenticate();
      if (result.success) {
        this.isOAuthRedirecting = false;
        showStatus(rendererI18n.t('status.authenticationSuccessful'), 'success');
        this.updateAuthDependentButtons();
        await this.loadVideoMetadata();
        await this.loadVideos();
        this.restoreTemporaryChanges();
      } else if (result.error && !result.error.includes('Redirecting')) {
        this.isOAuthRedirecting = false;
        showStatus(rendererI18n.t('status.authenticationFailed') + ': ' + (result.error || 'Unknown error'), 'error');
        this.updateAuthDependentButtons();
        showAuthenticationPrompt();
      }
    } catch (error) {
      this.isOAuthRedirecting = false;
      showStatus(rendererI18n.t('status.authenticationFailed') + ': ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
      this.updateAuthDependentButtons();
      showAuthenticationPrompt();
    } finally {
      hideLoadingOverlay();
    }
  }

  // Thin wrappers over src/video-cache.ts (A11): the module owns persistence;
  // the app keeps its in-memory channelId mirror in sync here.
  private saveVideosToCache(videos: VideoData[], channelId?: string): void {
    if (videoCache.saveVideosToCache(videos, channelId)) {
      this.cachedChannelId = channelId;
    }
  }

  private loadVideosFromCache(): VideoData[] | null {
    const cached = videoCache.loadVideosFromCache();
    if (!cached) return null;
    this.cachedChannelId = cached.channelId;
    return cached.videos;
  }

  private clearVideoCache(): void {
    videoCache.clearVideoCache();
    this.cachedChannelId = undefined;
  }

  private updateVideoCache(): void {
    try {
      // An imported set must not be persisted: saving one imported video would
      // overwrite yt_video_cache with thin backup records that lack YouTube-only
      // fields, degrading the next non-forced load (C2). The thin-cache discard
      // in loadVideosFromCache stays as defense-in-depth.
      if (this.videosSource !== 'youtube') {
        console.log('Skipping video cache update: current video set came from a file import');
        return;
      }
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
        showAuthenticationPrompt();
      } else {
        showStatus(rendererI18n.t('status.credentialsNotLoaded'), 'error');
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
          showLoadingOverlay(rendererI18n.t('loading.loadingFromCache'), rendererI18n.t('loading.loadingFromCacheSubtext'));
        }
      }

      if (videos.length === 0 || forceRefresh) {
        showLoadingOverlay(rendererI18n.t('loading.loadingFromYouTube'), rendererI18n.t('loading.loadingFromYouTubeSubtext'));
        videos = await this.youtubeAPI.getVideos();

        this.saveVideosToCache(videos);
      }

      this.state.allVideos = videos;
      this.videosSource = 'youtube';
      this.rebuildVideoIndex();
      this.state.displayedVideos = [...videos];
      this.state.changedVideos.clear();

      this.originalVideosState.clear();
      videos.forEach(video => {
        // Deep snapshot: nested objects (statistics/thumbnails/processing_progress)
        // must not be shared with the live record, or a future in-place mutation
        // would silently corrupt the change-detection baseline (B12).
        this.originalVideosState.set(video.id, structuredClone(video));
      });

      this.sortAllVideos();
      await this.renderVideos(true);

      const cacheStatus = forceRefresh ? '' : ' ' + rendererI18n.t('status.cached');
      showStatus(rendererI18n.t('status.videosLoaded', { count: videos.length }) + cacheStatus, 'success');
    } catch (error) {
      console.error('Error loading videos:', error);
      this.updateAuthDependentButtons();
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (/quotaExceeded|dailyLimitExceeded/i.test(msg)) {
        showStatus(rendererI18n.t('status.quotaExceeded'), 'error');
      } else {
        showStatus(rendererI18n.t('status.failedToLoadVideos') + ': ' + msg, 'error');
      }
    } finally {
      this.state.isLoading = false;
      hideLoadingOverlay();
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

  // Delegates to src/theme.ts (A11); kept as a method because the header
  // theme button calls app.toggleTheme() via an inline handler.
  toggleTheme(): void {
    theme.toggleTheme();
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
        // Real timer (kept, A28): grace period so focus can land inside the
        // same dropdown first — focusout fires before the next element gains
        // focus, and a rAF can run between the two focus events and close the
        // dropdown too early.
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
      showLoadingOverlay(rendererI18n.t('loading.processingAuthentication'), rendererI18n.t('loading.processingAuthSubtext'));

      try {
        const result = await this.youtubeAPI.authenticate();
        if (result.success) {
          this.isOAuthRedirecting = false;
          showStatus(rendererI18n.t('status.authenticationSuccessful'), 'success');
          this.updateAuthDependentButtons();
          await this.loadVideoMetadata();
          await this.loadVideos();
          this.restoreTemporaryChanges();

          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          this.isOAuthRedirecting = false;
          showStatus(rendererI18n.t('status.authenticationFailed') + ': ' + (result.error || 'Unknown error'), 'error');
          this.updateAuthDependentButtons();
          window.history.replaceState({}, document.title, window.location.pathname);
          showAuthenticationPrompt();
        }
      } catch (error) {
        this.isOAuthRedirecting = false;
        showStatus(rendererI18n.t('status.authenticationFailed') + ': ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
        this.updateAuthDependentButtons();
        window.history.replaceState({}, document.title, window.location.pathname);
        showAuthenticationPrompt();
      } finally {
        hideLoadingOverlay();
      }
    } else if (this.youtubeAPI.isLoggedIn()) {
      console.log('User is already logged in, loading data...');
      console.log('Auth status:', this.youtubeAPI.getAuthStatus());
      showStatus(rendererI18n.t('status.credentialsLoaded'), 'success');
      this.updateAuthDependentButtons();
      await this.loadVideoMetadata();
      await this.loadVideos();
    } else if (this.youtubeAPI.hasCredentials()) {
      this.updateAuthDependentButtons();
      showAuthenticationPrompt();
    } else {
      this.updateAuthDependentButtons();
      const videoList = document.getElementById('video-list');
      if (videoList) {
        renderNoCredentials(videoList);
      }
    }

    // Final localization sweep on the next frame (A28): every init-path DOM
    // insertion above (auth prompt / no-credentials notice) is synchronous by
    // this point, so a frame boundary — not an arbitrary 100ms timer — is
    // enough for it all to be queryable here.
    requestAnimationFrame(() => {
      rendererI18n.updatePageTexts();
    });
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
      data.items?.forEach(category => {
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

  private async loadI18nLanguages(): Promise<void> {
    if (!this.youtubeAPI.isLoggedIn()) {
      console.log('Skipping i18n languages load - not authenticated');
      return;
    }

    try {
      const data = await this.youtubeAPI.getI18nLanguages();
      this.i18nLanguages = {};
      data.items?.forEach(language => {
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

  private sortAllVideos(): void {
    this.state.allVideos.sort((a, b) => {
      switch (this.state.currentSort) {
        case 'date-desc':
          return publishedTime(b.published_at) - publishedTime(a.published_at);
        case 'date-asc':
          return publishedTime(a.published_at) - publishedTime(b.published_at);
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

  async saveAllChanges(): Promise<void> {
    if (this.state.changedVideos.size === 0) {
      showStatus(rendererI18n.t('status.noChangesToSave'), 'info');
      return;
    }

    if (this.batchSaveInProgress) {
      showStatus(rendererI18n.t('status.saveInProgress'), 'info');
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

    showLoadingOverlay(
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

      showLoadingOverlay(
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
    hideLoadingOverlay();

    if (successCount > 0) {
      showStatus(
        rendererI18n.t('status.batchSaveComplete', {
          successful: successCount,
          failed: errorCount,
          total: processedCount
        }),
        errorCount === 0 ? 'success' : 'info'
      );

      this.updateVideoCache();
    } else {
      showStatus(
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
      showStatus(rendererI18n.t('status.noVideosToExport'), 'info');
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
      showStatus(rendererI18n.t('status.videosExported', { count: this.state.allVideos.length }), 'success');
    } catch {
      showStatus(rendererI18n.t('status.failedToExportVideos'), 'error');
    }
  }

  // Delegates to src/backup.ts (A11); kept as a method so the export path
  // (and external callers of app['filterVideoDataForBackup']) are unchanged.
  private filterVideoDataForBackup(videos: VideoData[]): Record<string, unknown>[] {
    return backup.filterVideoDataForBackup(videos);
  }

  async loadFromFile(): Promise<void> {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';

      input.onchange = async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        showLoadingOverlay(rendererI18n.t('app.loading'), rendererI18n.t('loading.importingData'));

        try {
          const text = await file.text();
          const videoData = JSON.parse(text);
          await this.importVideoData(videoData);
        } catch {
          showStatus(rendererI18n.t('status.failedToParseData'), 'error');
        } finally {
          hideLoadingOverlay();
        }
      };

      input.click();
    } catch {
      showStatus(rendererI18n.t('status.failedToSelectFile'), 'error');
    }
  }

  async importVideoData(videoData: VideoData[]): Promise<void> {
    if (!Array.isArray(videoData)) {
      showStatus(rendererI18n.t('status.invalidFileFormat'), 'error');
      return;
    }

    // Validation + field-level sanitization live in src/backup.ts (A11). An
    // empty result means no record had a valid id; nothing is rendered.
    videoData = backup.sanitizeImportedVideos(videoData);

    if (videoData.length === 0) {
      showStatus(rendererI18n.t('status.invalidVideoData'), 'error');
      return;
    }

    // Preserve any existing YouTube baseline so we can detect which imported
    // videos actually differ from what is live on YouTube. A plain file-only
    // load (no baseline) just becomes the new baseline and is NOT pre-marked as
    // changed: the save prompt appears only for videos the user edits, or for
    // videos that genuinely differ from a loaded YouTube baseline.
    const baselineState = new Map(this.originalVideosState);

    this.state.allVideos = videoData;
    this.videosSource = 'import';
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
        // Deep snapshot (see loadVideos): keep the baseline independent of the
        // live record's nested objects (B12).
        this.originalVideosState.set(video.id, structuredClone(video));
      }
    });

    await this.renderVideos(true);
    this.updateSaveAllButton();
    showStatus(rendererI18n.t('status.videosImported', { count: videoData.length }), 'success');
  }

  // Shared logout core (A26): drop the API session via youtubeAPI.logout()
  // (clearStoredToken removes the full token/OAuth key set including
  // oauth_code_verifier), then clear all in-memory video/edit state plus the
  // persisted video cache and temporary changes.
  private clearSessionAndVideoState(): void {
    this.youtubeAPI.logout();
    this.state.allVideos = [];
    this.rebuildVideoIndex();
    this.state.displayedVideos = [];
    this.state.changedVideos.clear();
    this.originalVideosState.clear();
    this.clearVideoCache();
    this.clearTemporaryChanges();
  }

  // Reset the channel header back to its pre-login placeholder (A26): shared
  // by logout() and removeSavedCredentials().
  private resetChannelHeader(): void {
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
  }

  // Shared signed-out video-list placeholder (A26): prompt for authentication
  // when credentials exist, otherwise show the empty "no videos" notice. The
  // template's indentation matches the original logout/removeSavedCredentials
  // blocks so the rendered innerHTML stays byte-identical.
  private showSignedOutVideoList(): void {
    if (this.youtubeAPI.hasCredentials()) {
      showAuthenticationPrompt();
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
  }

  async logout(): Promise<void> {
    try {
      this.clearSessionAndVideoState();
      this.updateAuthDependentButtons();
      this.resetChannelHeader();
      this.showSignedOutVideoList();
      showStatus(rendererI18n.t('status.loggedOut'), 'success');
    } catch {
      showStatus(rendererI18n.t('status.failedToLogout'), 'error');
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

      showStatus(rendererI18n.t('status.cacheCleared'), 'success');
    } catch {
      showStatus(rendererI18n.t('status.failedToClearCache'), 'error');
    }
  }

  async removeSavedCredentials(): Promise<void> {
    try {
      // Same core as logout(); only the status message differs (and, as before
      // the A26 extraction, no auth-button refresh on this path).
      this.clearSessionAndVideoState();
      this.resetChannelHeader();
      this.showSignedOutVideoList();
      showStatus(rendererI18n.t('status.credentialsRemoved'), 'success');
    } catch {
      showStatus(rendererI18n.t('status.failedToRemoveCredentials'), 'error');
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
            showStatus(rendererI18n.t('status.credentialsLoaded'), 'success');
            await this.authenticate();
          } else {
            showStatus(rendererI18n.t('status.failedToLoadCredentials') + ': ' + (result.error || 'Unknown error'), 'error');
          }
        } catch (error) {
          showStatus(rendererI18n.t('status.failedToParseCredentialsFile') + ': ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
        }
      };

      input.click();
    } catch {
      showStatus(rendererI18n.t('status.failedToSelectFile'), 'error');
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
      showStatus(rendererI18n.t('status.geolocationUnavailable'), 'error');
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
        showStatus(rendererI18n.t('status.geolocationFailed'), 'error');
      }
    );
  }

  viewLocationOnMap(videoId: string): void {
    const lat = (document.getElementById(`latitude-${videoId}`) as HTMLInputElement | null)?.value.trim();
    const lng = (document.getElementById(`longitude-${videoId}`) as HTMLInputElement | null)?.value.trim();
    if (!lat || !lng) {
      showStatus(rendererI18n.t('status.noLocationSet'), 'info');
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
      !arraysEqual(video.tags || [], baseline.tags || [])
    );
  }

  handleTextareaResize(textarea: HTMLTextAreaElement): void {
    this.autoResizeTextarea(textarea);
  }

  handleImageError(img: HTMLImageElement): void {
    if (img.src !== DEFAULT_THUMBNAIL) {
      img.src = DEFAULT_THUMBNAIL;
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

  private renderTagsContainer(videoId: string): void {
    const container = document.getElementById(`tags-container-${videoId}`);
    const video = this.getVideo(videoId);

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

  removeTag(videoId: string, tagText: string): void {
    const video = this.getVideo(videoId);
    if (!video || !video.tags) return;

    video.tags = video.tags.filter(tag => tag !== tagText);

    this.renderTagsContainer(videoId);
    this.updateTagsCounter(videoId);
    this.markChanged(videoId);
    this.checkForChanges(videoId);

    // rAF instead of a 10ms timer (A28): see addTag.
    requestAnimationFrame(() => {
      const input = document.getElementById(`tag-input-${videoId}`) as HTMLInputElement;
      if (input) {
        input.focus();
      }
    });
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
      const recordingDate = ((document.getElementById(`recording-date-${videoId}`) as HTMLInputElement | null)?.value) ?? (video.recording_date || '');
      const latitude = parseCoordInput((document.getElementById(`latitude-${videoId}`) as HTMLInputElement | null)?.value, video.latitude);
      const longitude = parseCoordInput((document.getElementById(`longitude-${videoId}`) as HTMLInputElement | null)?.value, video.longitude);

      // Did the user actually change date/location vs. the saved baseline? The
      // API layer attaches the recordingDetails part only when this is true:
      // attaching it on every save would wipe an existing date on incidental
      // (e.g. title-only) saves, while never attaching it would make clearing a
      // date impossible to propagate. Comparing against the baseline gives both:
      // untouched fields are preserved, an intentional clear is sent.
      const recordingBaseline = this.originalVideosState.get(videoId) ?? video;
      const recordingDetailsChanged =
        recordingDate !== (recordingBaseline.recording_date || '') ||
        (latitude ?? null) !== (recordingBaseline.latitude ?? null) ||
        (longitude ?? null) !== (recordingBaseline.longitude ?? null);

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
        recording_date: recordingDate,
        latitude,
        longitude
      };

      const result = await this.youtubeAPI.updateVideo(videoId, { ...updates, recording_details_changed: recordingDetailsChanged });

      if (result.success) {
        Object.assign(video, updates);

        // Deep snapshot (see loadVideos): keep the baseline independent of the
        // live record's nested objects (B12).
        this.originalVideosState.set(videoId, structuredClone(video));

        const videoTitleEl = document.querySelector(`[data-video-id="${videoId}"] .video-title`);
        if (videoTitleEl) {
          videoTitleEl.textContent = updates.title;
        }

        this.unmarkChanged(videoId);

        if (updateBtn) {
          updateBtn.style.display = 'none';
        }

        if (!suppressStatus) {
          showStatus(rendererI18n.t('status.videoUpdated'), 'success');
        }

        if (!this.skipCacheUpdates) {
          this.updateVideoCache();
        }
      } else {
        if (!suppressStatus) {
          showStatus(result.error || rendererI18n.t('status.failedToUpdateVideo'), 'error');
        }
        this.checkForChanges(videoId);
      }
    } catch (error) {
      if (!suppressStatus) {
        showStatus(rendererI18n.t('status.failedToUpdateVideo') + ': ' + (error instanceof Error ? error.message : 'Unknown error'), 'error');
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
      showStatus(rendererI18n.t('status.authRequiredToRefresh'), 'error');
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

  // Thin wrappers over src/temp-changes.ts (A11): the module owns the
  // yt_temp_form_changes snapshot; the app supplies its state and reactions.
  private saveTemporaryChanges(): void {
    tempChanges.saveTemporaryChanges(this.state.changedVideos, (videoId) => this.getCurrentTags(videoId));
  }

  private restoreTemporaryChanges(): void {
    const restoredCount = tempChanges.restoreTemporaryChanges({
      getVideo: (videoId) => this.getVideo(videoId),
      handleTitleChange: (videoId) => this.handleTitleChange(videoId),
      handleDescriptionChange: (videoId) => this.handleDescriptionChange(videoId),
      handlePrivacyChange: (videoId) => this.handlePrivacyChange(videoId),
      handleCategoryChange: (videoId) => this.handleCategoryChange(videoId),
      handleLanguageChange: (videoId) => this.handleLanguageChange(videoId),
      handleRecordingDateChange: (videoId) => this.handleRecordingDateChange(videoId),
      handleLocationChange: (videoId) => this.handleLocationChange(videoId),
      handleLicenseChange: (videoId) => this.handleLicenseChange(videoId),
      handleDefaultLanguageChange: (videoId) => this.handleDefaultLanguageChange(videoId),
      handleSyntheticMediaChange: (videoId) => this.handleSyntheticMediaChange(videoId),
      autoResizeTextarea: (textarea) => this.autoResizeTextarea(textarea),
      renderTagsContainer: (videoId) => this.renderTagsContainer(videoId),
      updateTagsCounter: (videoId) => this.updateTagsCounter(videoId),
      checkForChanges: (videoId) => this.checkForChanges(videoId)
    });

    if (restoredCount > 0) {
      showStatus(rendererI18n.t('status.temporaryChangesRestored', { count: restoredCount }), 'info');
    }
  }

  private clearTemporaryChanges(): void {
    tempChanges.clearTemporaryChanges();
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