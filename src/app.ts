import rendererI18n from './i18n/renderer-i18n.js';
import { YouTubeAPI } from './youtube-api.js';
import type { VideoData } from './types.js';
import { arraysEqual, publishedTime } from './utils/format.js';
import * as videoCache from './video-cache.js';
import * as tempChanges from './temp-changes.js';
import { DEFAULT_THUMBNAIL, renderVideoCardHtml } from './video-card.js';
import { hideLoadingOverlay, renderNoCredentials, showAuthenticationPrompt, showLoadingOverlay, showStatus } from './ui-feedback.js';
import * as backup from './backup.js';
import * as theme from './theme.js';
import { FALLBACK_I18N_LANGUAGES, FALLBACK_VIDEO_CATEGORIES } from './fallback-data.js';
import * as tags from './tags.js';
import { autoResizeTextarea, resizeTextareaNow } from './textarea-resize.js';
import * as headerUi from './header-ui.js';
import { setupGlobalEventListeners } from './global-events.js';
import { collectVideoUpdates, hasCurrentChanges } from './video-form.js';

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
  // App-state accessors handed to the extracted tag editor (src/tags.ts).
  private tagDeps: tags.TagEditorDeps = {
    getVideo: (videoId) => this.getVideo(videoId),
    markChanged: (videoId) => this.markChanged(videoId),
    checkForChanges: (videoId) => this.checkForChanges(videoId)
  };
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

  // Thin wrappers over src/header-ui.ts (A11): the module owns the DOM; the
  // app supplies its auth/changed-count state.
  private updateAuthDependentButtons(): void {
    headerUi.updateAuthDependentButtons(this.youtubeAPI.isLoggedIn());
  }

  private updateSaveAllButton(): void {
    headerUi.updateSaveAllButton(this.state.changedVideos.size, this.batchSaveInProgress);
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
          resizeTextareaNow(textarea);
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

  // Delegates to src/global-events.ts (A11); the app supplies the
  // infinite-scroll and tag-removal reactions.
  private setupEventListeners(): void {
    setupGlobalEventListeners({
      onScroll: () => this.handleScroll(),
      removeTag: (videoId, tag) => this.removeTag(videoId, tag)
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
    // Fresh copies so later API loads can reassign/refill without ever
    // touching the shared catalogs in src/fallback-data.ts.
    this.videoCategories = { ...FALLBACK_VIDEO_CATEGORIES };
    this.i18nLanguages = { ...FALLBACK_I18N_LANGUAGES };
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
    headerUi.toggleMobileMenu();
  }

  toggleDropdown(): void {
    headerUi.toggleDropdown();
  }

  toggleFileDropdown(): void {
    headerUi.toggleFileDropdown();
  }

  closeDropdowns(): void {
    headerUi.closeDropdowns();
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
      headerUi.resetChannelHeader();
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
      headerUi.resetChannelHeader();
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
    tags.updateTagsCounter(videoId);
  }

  focusTagInput(videoId: string): void {
    tags.focusTagInput(videoId);
  }

  handleTitleChange(videoId: string): void {
    this.checkForChanges(videoId);
  }

  handleDescriptionChange(videoId: string): void {
    const textarea = document.getElementById(`description-${videoId}`) as HTMLTextAreaElement;
    if (textarea) {
      autoResizeTextarea(textarea);
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

  // Thumbnail replacement is an immediate action (not part of the batched
  // "Save changes" flow): validate the file client-side, POST it to
  // thumbnails.set, then swap the card image to the local file for instant
  // feedback (YouTube's thumbnail CDN lags behind the API by minutes).
  async handleThumbnailUpload(videoId: string, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      showStatus(rendererI18n.t('status.thumbnailInvalidType'), 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showStatus(rendererI18n.t('status.thumbnailTooLarge'), 'error');
      return;
    }

    const btn = document.querySelector(
      `#video-${videoId} .thumbnail-replace-btn`
    ) as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
    }
    showStatus(rendererI18n.t('status.thumbnailUploading'), 'info');

    try {
      await this.youtubeAPI.setThumbnail(videoId, file);
      const img = document.querySelector(
        `#video-${videoId} .video-thumbnail img`
      ) as HTMLImageElement | null;
      if (img) {
        img.removeAttribute('srcset');
        img.src = URL.createObjectURL(file);
      }
      showStatus(rendererI18n.t('status.thumbnailUpdated'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showStatus(rendererI18n.t('status.thumbnailFailed', { error: message }), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
      }
    }
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

    const hasChanges = hasCurrentChanges(
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
      original.default_language,
      this.getOriginalTags(videoId)
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
    autoResizeTextarea(textarea);
  }

  handleImageError(img: HTMLImageElement): void {
    if (img.src !== DEFAULT_THUMBNAIL) {
      img.src = DEFAULT_THUMBNAIL;
    }
  }

  // Tag-editing entry points (A11): the implementations live in src/tags.ts;
  // these stubs keep the inline-handler surface (app.handleTag*/addTag/
  // removeTag/copyTags/processTagInput) unchanged.
  handleTagKeydown(event: KeyboardEvent, videoId: string): void {
    tags.handleTagKeydown(this.tagDeps, event, videoId);
  }

  handleTagChange(videoId: string): void {
    tags.handleTagChange(this.tagDeps, videoId);
  }

  processTagInput(videoId: string, inputValue: string): void {
    tags.processTagInput(this.tagDeps, videoId, inputValue);
  }

  handleTagPaste(event: ClipboardEvent, videoId: string): void {
    tags.handleTagPaste(this.tagDeps, event, videoId);
  }

  handleTagBlur(event: FocusEvent, videoId: string): void {
    tags.handleTagBlur(this.tagDeps, event, videoId);
  }

  async copyTags(videoId: string): Promise<void> {
    await tags.copyTags(videoId);
  }

  addTag(videoId: string, tagText: string): void {
    tags.addTag(this.tagDeps, videoId, tagText);
  }

  removeTag(videoId: string, tagText: string): void {
    tags.removeTag(this.tagDeps, videoId, tagText);
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

      // Form reading + payload assembly live in src/video-form.ts (A11).
      const { updates, recordingDetailsChanged } = collectVideoUpdates(videoId, video, this.originalVideosState.get(videoId) ?? video);

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
    tempChanges.saveTemporaryChanges(this.state.changedVideos, (videoId) => tags.getCurrentTags(videoId));
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
      autoResizeTextarea: (textarea) => autoResizeTextarea(textarea),
      renderTagsContainer: (videoId) => tags.renderTagsContainer(this.tagDeps, videoId),
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