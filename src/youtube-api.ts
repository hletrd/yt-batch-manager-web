import type { VideoData, ThumbnailData } from './types.js';

interface YouTubeAPIConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

interface OAuthCredentials {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    javascript_origins?: string[];
    redirect_uris?: string[];
  };
}


export class YouTubeAPI {
  private config: YouTubeAPIConfig = {};
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private isAuthenticated: boolean = false;
  private credentials: OAuthCredentials | null = null;
  private beforeRedirectCallback: (() => void) | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(config?: YouTubeAPIConfig) {
    this.config = config || {};
    this.loadStoredToken();
    this.initializeCredentials();
  }

  private async initializeCredentials(): Promise<void> {
    await this.loadCredentials();
  }

  async waitForCredentials(): Promise<void> {
    if (this.credentials !== null) {
      return;
    }

    const maxWait = 5000;
    const checkInterval = 50;
    let waited = 0;

    while (this.credentials === null && waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }

    if (this.credentials === null) {
      console.warn('Timeout waiting for credentials to load');
    }
  }

  private loadStoredToken(): void {
    try {
      const token = localStorage.getItem('youtube_access_token');
      const expiry = localStorage.getItem('youtube_token_expiry');
      this.refreshToken = localStorage.getItem('youtube_refresh_token');

      if (token && expiry && new Date().getTime() < parseInt(expiry)) {
        this.accessToken = token;
        this.isAuthenticated = true;
      } else {
        // Access token is missing or expired, but keep the refresh token so the
        // session can be restored silently via tryRestoreSession().
        this.accessToken = null;
        this.isAuthenticated = false;
        localStorage.removeItem('youtube_access_token');
        localStorage.removeItem('youtube_token_expiry');
        console.log(this.refreshToken
          ? 'Access token expired; refresh token available for silent renewal'
          : 'No valid stored token and no refresh token');
      }
    } catch (error) {
      console.error('Error loading stored token:', error);
      this.accessToken = null;
      this.isAuthenticated = false;
      localStorage.removeItem('youtube_access_token');
      localStorage.removeItem('youtube_token_expiry');
    }
  }

  private storeToken(token: string, expiresIn: number, refreshToken?: string | null): void {
    try {
      this.accessToken = token;
      this.isAuthenticated = true;
      localStorage.setItem('youtube_access_token', token);

      const expiryTime = new Date().getTime() + (expiresIn * 1000);
      localStorage.setItem('youtube_token_expiry', expiryTime.toString());

      // Google only returns a refresh_token on the first consent (or when
      // prompt=consent is used). On a plain refresh it is omitted, so keep the
      // existing one instead of wiping it.
      if (refreshToken) {
        this.refreshToken = refreshToken;
        localStorage.setItem('youtube_refresh_token', refreshToken);
      }
    } catch (error) {
      console.error('Error storing token:', error);
    }
  }

  private clearStoredToken(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.isAuthenticated = false;
    localStorage.removeItem('youtube_access_token');
    localStorage.removeItem('youtube_token_expiry');
    localStorage.removeItem('youtube_refresh_token');
    localStorage.removeItem('oauth_state');
    localStorage.removeItem('oauth_code_verifier');
  }

  private async loadCredentials(): Promise<void> {
    try {
      console.log('Loading credentials from credentials.json');
      const response = await fetch('./credentials.json');
      if (response.ok) {
        this.credentials = await response.json();
        console.log('Credentials loaded successfully');
        this.setupConfig();
        console.log('Config setup complete:', {
          hasClientId: !!this.config.clientId,
          hasClientSecret: !!this.config.clientSecret,
          redirectUri: this.config.redirectUri
        });
      } else if (response.status === 404) {
        console.info('credentials.json not found - user needs to authenticate');
      } else {
        console.warn('Could not load credentials.json:', response.statusText);
      }
    } catch (error) {
      console.warn('Error loading credentials.json:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private setupConfig(): void {
    if (this.credentials?.web) {
      this.config.clientId = this.credentials.web.client_id;
      this.config.clientSecret = this.credentials.web.client_secret;
      this.config.redirectUri = window.location.origin + window.location.pathname;
    } else if (this.credentials?.installed) {
      this.config.clientId = this.credentials.installed.client_id;
      this.config.clientSecret = this.credentials.installed.client_secret;
      this.config.redirectUri = window.location.origin + window.location.pathname;
    }
  }

  async setCredentialsFromObject(credentials: OAuthCredentials): Promise<{ success: boolean; error?: string }> {
    try {
      this.credentials = credentials;
      this.setupConfig();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set credentials'
      };
    }
  }

  async setCredentials(credentialsFile: File): Promise<{ success: boolean; error?: string }> {
    try {
      const text = await credentialsFile.text();
      const credentials = JSON.parse(text);
      return this.setCredentialsFromObject(credentials);
    } catch {
      return {
        success: false,
        error: 'Invalid credentials file format'
      };
    }
  }

    async authenticate(): Promise<{ success: boolean; error?: string }> {
    if (!this.credentials) {
      await this.loadCredentials();
    }

    if (!this.config.clientId) {
      return {
        success: false,
        error: 'No credentials available. Please ensure credentials.json is properly configured.'
      };
    }

    if (this.isAuthenticated && this.accessToken) {
      return { success: true };
    }

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');

      const storedState = localStorage.getItem('oauth_state');

      if (code && state && state === storedState) {
        return await this.handleOAuthCallback(code, state);
      } else {
        if (code && state) {
          // State mismatch: do not redirect (avoids a redirect loop). Avoid
          // echoing the raw state values back to the UI.
          return { success: false, error: 'State validation failed' };
        }

        await this.initiateOAuthFlow();
        return { success: false, error: 'Redirecting to OAuth...' };
      }
    } catch (error) {
      console.error('Authentication error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      };
    }
  }

  private async initiateOAuthFlow(): Promise<void> {
    const authUrl = await this.buildAuthUrl();
    window.location.href = authUrl;
  }

  private async buildAuthUrl(): Promise<string> {
    if (!this.config.clientId || !this.config.redirectUri) {
      throw new Error('OAuth configuration incomplete');
    }

    const state = this.generateRandomString(32);

    // PKCE: bind this authorization request to a one-time code verifier so an
    // intercepted authorization code cannot be exchanged by anyone else.
    // Google still requires the client_secret at the token endpoint, but with
    // PKCE in place the publicly-served secret is not independently exploitable.
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.computeCodeChallenge(codeVerifier);

    try {
      localStorage.setItem('oauth_state', state);
      localStorage.setItem('oauth_code_verifier', codeVerifier);
    } catch (error) {
      console.error('Error storing OAuth state/verifier in localStorage:', error);
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
      access_type: 'offline',
      // Force the consent screen so Google always returns a refresh_token.
      // Without this, offline access only yields a refresh_token on the very
      // first authorization, leaving repeat logins without one.
      prompt: 'consent',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state
    });

    return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
  }

  private generateRandomString(length: number): string {
    // Use a cryptographically strong RNG for the OAuth `state` (CSRF token)
    // rather than Math.random(). Bytes are mapped onto the charset; the modulo
    // bias over a 62-char set is negligible for a CSRF nonce.
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(bytes[i] % chars.length);
    }
    return result;
  }

  private generateCodeVerifier(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return this.base64UrlEncode(bytes);
  }

  private async computeCodeChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return this.base64UrlEncode(new Uint8Array(digest));
  }

  private base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private isTokenValid(): boolean {
    if (!this.accessToken) {
      return false;
    }

    const expiry = localStorage.getItem('youtube_token_expiry');
    if (!expiry) {
      return false;
    }

    const currentTime = new Date().getTime();
    const expiryTime = parseInt(expiry);

    return currentTime < expiryTime;
  }

  setBeforeRedirectCallback(callback: () => void): void {
    this.beforeRedirectCallback = callback;
  }

  hasRefreshToken(): boolean {
    return !!this.refreshToken;
  }

  /**
   * Exchange the stored refresh_token for a fresh access_token without any user
   * interaction. Concurrent callers share a single in-flight request.
   * Returns true on success, false if there is no usable refresh token.
   */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) {
      return false;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performTokenRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performTokenRefresh(): Promise<boolean> {
    if (!this.config.clientId) {
      await this.waitForCredentials();
    }

    if (!this.refreshToken || !this.config.clientId) {
      return false;
    }

    try {
      const body = new URLSearchParams({
        client_id: this.config.clientId,
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken
      });

      if (this.config.clientSecret) {
        body.append('client_secret', this.config.clientSecret);
      }

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.warn('Token refresh failed:', errorData);
        // invalid_grant means the refresh token was revoked/expired; drop the
        // whole session so the app falls back to a full re-login.
        if (errorData.error === 'invalid_grant') {
          this.clearStoredToken();
        }
        return false;
      }

      const tokenData = await response.json();
      if (tokenData.access_token) {
        this.storeToken(
          tokenData.access_token,
          tokenData.expires_in || 3600,
          tokenData.refresh_token
        );
        console.log('Access token refreshed silently via refresh token');
        return true;
      }

      return false;
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  }

  /**
   * Restore an authenticated session on app start. If the access token is still
   * valid it is used as-is; otherwise a silent refresh is attempted. Returns
   * true when the session is usable afterwards.
   */
  async tryRestoreSession(): Promise<boolean> {
    if (this.isTokenValid()) {
      return true;
    }
    if (this.refreshToken) {
      return await this.refreshAccessToken();
    }
    return false;
  }

  private async ensureValidToken(): Promise<void> {
    if (this.isTokenValid()) {
      return;
    }

    // Access token expired: try a silent refresh before forcing re-login.
    if (this.refreshToken && await this.refreshAccessToken()) {
      return;
    }

    console.warn('Token expired and silent refresh unavailable, triggering re-authentication');
    this.clearStoredToken();

    if (this.beforeRedirectCallback) {
      this.beforeRedirectCallback();
    }

    const authResult = await this.authenticate();
    if (!authResult.success && !authResult.error?.includes('Redirecting to OAuth')) {
      throw new Error('Re-authentication failed: ' + authResult.error);
    }

    throw new Error('Token was invalid and re-authentication has been triggered. Please try again.');
  }

  /**
   * Perform an authenticated request and, on a 401, transparently attempt a
   * single silent token refresh + retry before falling back to re-authentication.
   *
   * Previously a successful silent refresh threw "Please retry", but no caller
   * caught it, so a recoverable 401 surfaced to the user as a hard failure. This
   * wrapper performs the retry internally so the original request succeeds.
   *
   * The Authorization header is injected here from the current access token; do
   * not set it in `init`. Other headers in `init` are preserved.
   */
  private async authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const buildHeaders = (): Record<string, string> => ({
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
      'Authorization': `Bearer ${this.accessToken}`
    });

    let response = await fetch(url, { ...init, headers: buildHeaders() });

    if (response.status === 401) {
      // The server rejected the access token (revoked / clock skew). Try one
      // silent refresh and, if it succeeds, retry the original request once.
      if (this.refreshToken && await this.refreshAccessToken()) {
        response = await fetch(url, { ...init, headers: buildHeaders() });
      }

      if (response.status === 401) {
        // Refresh unavailable or the retry still failed: clear and re-auth.
        await this.handleApiResponse(response);
      }
    }

    return response;
  }

  private async handleApiResponse(response: Response): Promise<Response> {
    if (response.status === 401) {
      console.warn('401 Unauthorized - re-authentication required');

      this.clearStoredToken();

      if (this.beforeRedirectCallback) {
        this.beforeRedirectCallback();
      }

      const authResult = await this.authenticate();
      if (!authResult.success && !authResult.error?.includes('Redirecting to OAuth')) {
        throw new Error('Re-authentication failed: ' + authResult.error);
      }

      throw new Error('Token was invalid and re-authentication has been triggered. Please try again.');
    }
    return response;
  }

  async getChannelInfo(): Promise<any> {
    if (!this.isAuthenticated || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    await this.ensureValidToken();

    const response = await this.authedFetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true'
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch channel info: ${response.statusText}`);
    }

    return response.json();
  }

  async getVideoCategories(): Promise<any> {
    if (!this.isAuthenticated || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    await this.ensureValidToken();

    const response = await this.authedFetch(
      'https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US'
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch video categories: ${response.statusText}`);
    }

    return response.json();
  }

  async getI18nLanguages(): Promise<any> {
    if (!this.isAuthenticated || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    await this.ensureValidToken();

    const response = await this.authedFetch(
      'https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet'
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch i18n languages: ${response.statusText}`);
    }

    return response.json();
  }

  async getVideos(maxResults: number = 200): Promise<VideoData[]> {
    if (!this.isAuthenticated || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    await this.ensureValidToken();

    // Page through the channel's "uploads" playlist (1 quota unit per page)
    // instead of search.list?forMine=true (100 units per page). This also
    // returns every upload reliably, including very recent ones.
    const uploadsPlaylistId = await this.getUploadsPlaylistId();

    const videos: VideoData[] = [];
    let nextPageToken: string | undefined;

    do {
      const playlistParams = new URLSearchParams({
        part: 'contentDetails',
        playlistId: uploadsPlaylistId,
        maxResults: Math.min(50, maxResults - videos.length).toString()
      });

      if (nextPageToken) {
        playlistParams.append('pageToken', nextPageToken);
      }

      const playlistResponse = await this.authedFetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?${playlistParams.toString()}`
      );

      if (!playlistResponse.ok) {
        throw new Error(await this.describeError(playlistResponse, 'Failed to fetch videos'));
      }

      const playlistData = await playlistResponse.json();
      nextPageToken = playlistData.nextPageToken;

      const videoIds: string[] = (playlistData.items || [])
        .map((item: any) => item.contentDetails?.videoId)
        .filter(Boolean);

      if (videoIds.length === 0) {
        continue;
      }

      const videosParams = new URLSearchParams({
        // NOTE: fileDetails is intentionally NOT requested here. It is a
        // restricted part and requesting it inline 403s the entire videos.list
        // call when any video in the batch is not accessible for it, which broke
        // loading. Dimensions for Shorts detection are fetched separately below.
        part: 'snippet,status,contentDetails,statistics,recordingDetails',
        id: videoIds.join(',')
      });

      const videosResponse = await this.authedFetch(
        `https://www.googleapis.com/youtube/v3/videos?${videosParams.toString()}`
      );

      if (!videosResponse.ok) {
        throw new Error(await this.describeError(videosResponse, 'Failed to fetch video details'));
      }

      const videosData = await videosResponse.json();

      for (const item of videosData.items || []) {
        const thumbnails: Record<string, ThumbnailData> = {};

        if (item.snippet.thumbnails) {
          for (const [key, thumb] of Object.entries(item.snippet.thumbnails)) {
            const thumbnail = thumb as any;
            thumbnails[key] = {
              url: thumbnail.url,
              width: thumbnail.width || 0,
              height: thumbnail.height || 0
            };
          }
        }

        const video: VideoData = {
          id: item.id,
          title: item.snippet.title || '',
          description: item.snippet.description || '',
          thumbnail_url: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
          thumbnails,
          published_at: item.snippet.publishedAt || '',
          privacy_status: item.status?.privacyStatus || 'private',
          category_id: item.snippet.categoryId || '22',
          tags: item.snippet.tags || [],
          defaultAudioLanguage: item.snippet.defaultAudioLanguage,
          default_language: item.snippet.defaultLanguage,
          contains_synthetic_media: item.status?.containsSyntheticMedia ?? false,
          made_for_kids: item.status?.madeForKids,
          license: item.status?.license,
          embeddable: item.status?.embeddable,
          public_stats_viewable: item.status?.publicStatsViewable,
          recording_date: item.recordingDetails?.recordingDate?.substring(0, 10),
          latitude: item.recordingDetails?.location?.latitude,
          longitude: item.recordingDetails?.location?.longitude,
          duration: item.contentDetails?.duration,
          upload_status: item.status?.uploadStatus,
          processing_status: item.status?.processingStatus,
          statistics: item.statistics ? {
            view_count: item.statistics.viewCount,
            like_count: item.statistics.likeCount,
            dislike_count: item.statistics.dislikeCount,
            comment_count: item.statistics.commentCount
          } : undefined
        };

        videos.push(video);
      }

      // Best-effort: enrich this page with encoded dimensions for Shorts
      // (vertical) detection via a SEPARATE fileDetails call so a restricted
      // video can never 403 the main load.
      await this.applyVideoDimensions(videoIds, videos);

    } while (nextPageToken && videos.length < maxResults);

    return videos;
  }

  // fileDetails is owner-only and restricted: requesting it 403s the whole
  // request if any video in the batch is inaccessible for it. Fetch it on its
  // own and swallow any failure — dimensions are only used to tell vertical
  // Shorts apart, and the heuristic falls back to duration when they are absent.
  private async applyVideoDimensions(videoIds: string[], videos: VideoData[]): Promise<void> {
    try {
      const params = new URLSearchParams({ part: 'fileDetails', id: videoIds.join(',') });
      const response = await this.authedFetch(
        `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`
      );
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const dims = new Map<string, { w?: number; h?: number }>();
      for (const item of data.items || []) {
        const stream = item.fileDetails?.videoStreams?.[0];
        if (stream) {
          dims.set(item.id, { w: stream.widthPixels, h: stream.heightPixels });
        }
      }
      for (const video of videos) {
        const d = dims.get(video.id);
        if (d) {
          video.width_pixels = d.w;
          video.height_pixels = d.h;
        }
      }
    } catch {
      // Best-effort: dimensions stay unknown; Shorts badge falls back to duration.
    }
  }

  private async getUploadsPlaylistId(): Promise<string> {
    const response = await this.authedFetch(
      'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true'
    );

    if (!response.ok) {
      throw new Error(await this.describeError(response, 'Failed to fetch channel'));
    }

    const data = await response.json();
    const uploads = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploads) {
      throw new Error('Could not find the uploads playlist for this channel');
    }

    return uploads;
  }

  // Surface the YouTube API error reason (e.g. quotaExceeded,
  // ACCESS_TOKEN_SCOPE_INSUFFICIENT) instead of a bare status code.
  private async describeError(response: Response, prefix: string): Promise<string> {
    let detail = `${response.status}`;
    try {
      const data = await response.json();
      const reason = data?.error?.errors?.[0]?.reason || data?.error?.status;
      const message = data?.error?.message;
      if (reason) {
        detail += ` ${reason}`;
      }
      if (message) {
        detail += `: ${message}`;
      }
    } catch {
      if (response.statusText) {
        detail += ` ${response.statusText}`;
      }
    }
    return `${prefix}: ${detail}`;
  }

  /**
   * Fetch the current mutable status fields for a single video. Used before an
   * update of a video whose status was not loaded from YouTube (e.g. imported
   * from a backup) so that videos.update does not wipe properties that are simply
   * unknown locally — videos.update replaces the whole `status` part, deleting any
   * omitted property. Returns null on failure so the caller can proceed without
   * blocking the save.
   */
  async getVideoStatus(videoId: string): Promise<Pick<VideoData, 'license' | 'embeddable' | 'public_stats_viewable' | 'contains_synthetic_media' | 'made_for_kids'> | null> {
    if (!this.isAuthenticated || !this.accessToken) {
      return null;
    }

    try {
      await this.ensureValidToken();

      const params = new URLSearchParams({ part: 'status', id: videoId });
      const response = await this.authedFetch(
        `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const status = data.items?.[0]?.status;
      if (!status) {
        return null;
      }

      return {
        license: status.license,
        embeddable: status.embeddable,
        public_stats_viewable: status.publicStatsViewable,
        contains_synthetic_media: status.containsSyntheticMedia,
        made_for_kids: status.madeForKids
      };
    } catch {
      return null;
    }
  }

  async updateVideo(videoId: string, updates: Partial<VideoData>): Promise<{ success: boolean; error?: string }> {
    if (!this.isAuthenticated || !this.accessToken) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      await this.ensureValidToken();

      const requestBody = {
        id: videoId,
        snippet: {},
        status: {}
      };

      if (updates.title !== undefined) {
        (requestBody.snippet as any).title = updates.title;
      }
      if (updates.description !== undefined) {
        (requestBody.snippet as any).description = updates.description;
      }
      if (updates.category_id !== undefined) {
        (requestBody.snippet as any).categoryId = updates.category_id;
      }
      if (updates.tags !== undefined) {
        (requestBody.snippet as any).tags = updates.tags;
      }
      if (updates.defaultAudioLanguage !== undefined) {
        (requestBody.snippet as any).defaultAudioLanguage = updates.defaultAudioLanguage;
      }
      if (updates.default_language !== undefined) {
        (requestBody.snippet as any).defaultLanguage = updates.default_language;
      }
      if (updates.privacy_status !== undefined) {
        (requestBody.status as any).privacyStatus = updates.privacy_status;
      }
      // Always round-trip the remaining mutable status fields. videos.update
      // deletes any status property omitted from the request, so leaving these
      // out would silently wipe them (e.g. an existing AI-content disclosure,
      // the made-for-kids designation, license, or embeddable setting).
      if (updates.contains_synthetic_media !== undefined) {
        (requestBody.status as any).containsSyntheticMedia = updates.contains_synthetic_media;
      }
      if (updates.license !== undefined) {
        (requestBody.status as any).license = updates.license;
      }
      if (updates.embeddable !== undefined) {
        (requestBody.status as any).embeddable = updates.embeddable;
      }
      if (updates.public_stats_viewable !== undefined) {
        (requestBody.status as any).publicStatsViewable = updates.public_stats_viewable;
      }
      // Intentionally NOT writing selfDeclaredMadeForKids: the read-back field is
      // the *effective* madeForKids value, not the creator's self-declaration, so
      // round-tripping it on every save could flip a video's COPPA designation.
      // The UI does not expose this control; omitting it leaves the existing
      // self-declaration untouched.

      const parts = ['snippet', 'status'];
      if (updates.recording_date !== undefined || updates.latitude !== undefined || updates.longitude !== undefined) {
        // recordingDate is ISO 8601 (YouTube keeps only the date portion).
        // recordingDetails.location is deprecated but still accepted. Round-trip
        // BOTH so videos.update does not wipe the untouched one (it deletes any
        // omitted property). recordingDetails is added to the part only when we
        // manage it. An empty date / missing coordinates clears that field.
        const recordingDetails: any = {};
        if (updates.recording_date) {
          recordingDetails.recordingDate = `${updates.recording_date}T00:00:00.000Z`;
        }
        if (typeof updates.latitude === 'number' && typeof updates.longitude === 'number') {
          recordingDetails.location = { latitude: updates.latitude, longitude: updates.longitude };
        }
        (requestBody as any).recordingDetails = recordingDetails;
        parts.push('recordingDetails');
      }

      const response = await this.authedFetch(
        `https://www.googleapis.com/youtube/v3/videos?part=${parts.join(',')}`,
        {
          method: 'PUT',
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  isLoggedIn(): boolean {
    return this.isAuthenticated && !!this.accessToken && this.isTokenValid();
  }

  hasCredentials(): boolean {
    return !!this.config.clientId;
  }

  getAuthStatus(): { isLoggedIn: boolean; hasCredentials: boolean; hasToken: boolean; hasRefreshToken: boolean; tokenLength?: number; isTokenValid: boolean } {
    return {
      isLoggedIn: this.isLoggedIn(),
      hasCredentials: this.hasCredentials(),
      hasToken: !!this.accessToken,
      hasRefreshToken: !!this.refreshToken,
      tokenLength: this.accessToken?.length,
      isTokenValid: this.isTokenValid()
    };
  }

  logout(): void {
    this.clearStoredToken();
  }

  async handleOAuthCallback(code: string, state: string): Promise<{ success: boolean; error?: string }> {
    try {
      const storedState = localStorage.getItem('oauth_state');

      if (state !== storedState) {
        return { success: false, error: 'Invalid state parameter' };
      }

      if (!this.config.clientId || !this.config.redirectUri) {
        return { success: false, error: 'OAuth configuration incomplete' };
      }

      const codeVerifier = localStorage.getItem('oauth_code_verifier');

      const tokenRequestBody = new URLSearchParams({
        code,
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code'
      });

      // PKCE proof of possession. Google additionally requires the client_secret
      // for "Web application" clients, so both are sent.
      if (codeVerifier) {
        tokenRequestBody.append('code_verifier', codeVerifier);
      }

      if (this.config.clientSecret) {
        tokenRequestBody.append('client_secret', this.config.clientSecret);
      }

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: tokenRequestBody
      });

      // Note: the token endpoint is not a bearer-authenticated API call, so it
      // is NOT routed through authedFetch/handleApiResponse; its errors (400 on
      // bad grant, etc.) are handled explicitly below.
      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        const errorMessage = errorData.error_description || errorData.error || 'Token exchange failed';
        console.error('Token exchange error:', errorData);
        throw new Error(errorMessage);
      }

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        this.storeToken(
          tokenData.access_token,
          tokenData.expires_in || 3600,
          tokenData.refresh_token
        );
        localStorage.removeItem('oauth_state');
        localStorage.removeItem('oauth_code_verifier');
        return { success: true };
      } else {
        return { success: false, error: 'No access token received' };
      }
    } catch (error) {
      console.error('OAuth callback error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth callback failed'
      };
    }
  }
}

export default YouTubeAPI;