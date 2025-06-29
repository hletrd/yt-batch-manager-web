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

interface VideoData {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  thumbnails: Record<string, ThumbnailData>;
  published_at: string;
  privacy_status: string;
  category_id: string;
  tags?: string[];
  defaultAudioLanguage?: string;
  duration?: string;
  upload_status?: string;
  processing_status?: string;
  statistics?: {
    view_count?: string;
    like_count?: string;
    dislike_count?: string;
    comment_count?: string;
  };
}

interface ThumbnailData {
  url: string;
  width: number;
  height: number;
}

export class YouTubeAPI {
  private config: YouTubeAPIConfig = {};
  private accessToken: string | null = null;
  private isAuthenticated: boolean = false;
  private credentials: OAuthCredentials | null = null;
  private beforeRedirectCallback: (() => void) | null = null;

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

      console.log('Loading stored token:', {
        hasToken: !!token,
        hasExpiry: !!expiry,
        tokenLength: token?.length,
        expiryValue: expiry,
        currentTime: new Date().getTime(),
        isValid: token && expiry && new Date().getTime() < parseInt(expiry)
      });

      if (token && expiry && new Date().getTime() < parseInt(expiry)) {
        this.accessToken = token;
        this.isAuthenticated = true;
        console.log('Stored token loaded and is valid');
      } else {
        this.accessToken = null;
        this.isAuthenticated = false;
        localStorage.removeItem('youtube_access_token');
        localStorage.removeItem('youtube_token_expiry');
        console.log('No valid stored token found or token expired');
      }
    } catch (error) {
      console.error('Error loading stored token:', error);
      this.accessToken = null;
      this.isAuthenticated = false;
      localStorage.removeItem('youtube_access_token');
      localStorage.removeItem('youtube_token_expiry');
    }
  }

  private storeToken(token: string, expiresIn: number): void {
    try {
      this.accessToken = token;
      this.isAuthenticated = true;
      localStorage.setItem('youtube_access_token', token);

      const expiryTime = new Date().getTime() + (expiresIn * 1000);
      localStorage.setItem('youtube_token_expiry', expiryTime.toString());
    } catch (error) {
      console.error('Error storing token:', error);
    }
  }

  private clearStoredToken(): void {
    this.accessToken = null;
    this.isAuthenticated = false;
    localStorage.removeItem('youtube_access_token');
    localStorage.removeItem('youtube_token_expiry');
    localStorage.removeItem('oauth_state');
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
    console.log('authenticate() called');

    if (!this.credentials) {
      console.log('Waiting for credentials to load...');
      await this.loadCredentials();
    }

    if (!this.config.clientId) {
      console.log('No client ID available');
      return {
        success: false,
        error: 'No credentials available. Please ensure credentials.json is properly configured.'
      };
    }

    if (this.isAuthenticated && this.accessToken) {
      console.log('Already authenticated');
      return { success: true };
    }

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');

      console.log('Checking localStorage for oauth_state...');
      console.log('localStorage contents:', Object.keys(localStorage));
      console.log('All localStorage items:', {...localStorage});

      const storedState = localStorage.getItem('oauth_state');
      console.log('Retrieved stored state:', storedState);

      console.log('OAuth parameters:', {
        hasCode: !!code,
        hasState: !!state,
        stateMatches: state === storedState,
        storedState: storedState,
        receivedState: state,
        codeLength: code?.length,
        stateLength: state?.length
      });

      if (code && state && state === storedState) {
        console.log('Processing OAuth callback');
        return await this.handleOAuthCallback(code, state);
      } else {
        console.log('Initiating OAuth flow because:');
        console.log('  - hasCode:', !!code);
        console.log('  - hasState:', !!state);
        console.log('  - stateMatches:', state === storedState);
        console.log('  - storedState:', storedState);
        console.log('  - receivedState:', state);

        if (code && state) {
          console.log('State validation failed, not redirecting to prevent loop');
          return { success: false, error: `State validation failed. Expected: ${storedState}, Got: ${state}` };
        }

        this.initiateOAuthFlow();
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

  private initiateOAuthFlow(): void {
    const authUrl = this.buildAuthUrl();
    window.location.href = authUrl;
  }

  private buildAuthUrl(): string {
    if (!this.config.clientId || !this.config.redirectUri) {
      throw new Error('OAuth configuration incomplete');
    }

    const state = this.generateRandomString(32);
    console.log('Generated OAuth state:', state);

    try {
      localStorage.setItem('oauth_state', state);
      console.log('Stored OAuth state in localStorage');

      const storedState = localStorage.getItem('oauth_state');
      console.log('Verified stored state:', storedState);
      console.log('localStorage contents:', Object.keys(localStorage));
    } catch (error) {
      console.error('Error storing state in localStorage:', error);
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl',
      access_type: 'offline',
      state: state
    });

    const authUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
    console.log('Built auth URL:', authUrl.substring(0, 100) + '...');
    return authUrl;
  }

  private generateRandomString(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
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

  private async ensureValidToken(): Promise<void> {
    if (!this.isTokenValid()) {
      console.warn('Token is expired or invalid, clearing stored token and triggering re-authentication');
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
  }

  private async handleApiResponse(response: Response): Promise<Response> {
    if (response.status === 401) {
      console.warn('401 Unauthorized - token may be invalid, clearing stored token and triggering re-authentication');
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
    console.log('getChannelInfo auth check:', {
      isAuthenticated: this.isAuthenticated,
      hasAccessToken: !!this.accessToken,
      tokenLength: this.accessToken?.length
    });

    if (!this.isAuthenticated || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    await this.ensureValidToken();

    const response = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    await this.handleApiResponse(response);

    if (!response.ok) {
      throw new Error(`Failed to fetch channel info: ${response.statusText}`);
    }

    return response.json();
  }

  async getVideoCategories(): Promise<any> {
    console.log('getVideoCategories auth check:', {
      isAuthenticated: this.isAuthenticated,
      hasAccessToken: !!this.accessToken,
      tokenLength: this.accessToken?.length
    });

    if (!this.isAuthenticated || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    await this.ensureValidToken();

    const response = await fetch(
      'https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US',
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    await this.handleApiResponse(response);

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

    const response = await fetch(
      'https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet',
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    await this.handleApiResponse(response);

    if (!response.ok) {
      throw new Error(`Failed to fetch i18n languages: ${response.statusText}`);
    }

    return response.json();
  }

  async getVideos(maxResults: number = 200): Promise<VideoData[]> {
    console.log('getVideos auth check:', {
      isAuthenticated: this.isAuthenticated,
      hasAccessToken: !!this.accessToken,
      tokenLength: this.accessToken?.length
    });

    if (!this.isAuthenticated || !this.accessToken) {
      throw new Error('Not authenticated');
    }

    await this.ensureValidToken();

    const videos: VideoData[] = [];
    let nextPageToken: string | undefined;

    do {
      const searchParams = new URLSearchParams({
        part: 'snippet',
        forMine: 'true',
        type: 'video',
        maxResults: Math.min(50, maxResults - videos.length).toString(),
        order: 'date'
      });

      if (nextPageToken) {
        searchParams.append('pageToken', nextPageToken);
      }

      const searchResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      await this.handleApiResponse(searchResponse);

      if (!searchResponse.ok) {
        throw new Error(`Failed to fetch videos: ${searchResponse.status} ${searchResponse.statusText}`);
      }

      const searchData = await searchResponse.json();
      const videoIds = searchData.items?.map((item: any) => item.id.videoId).filter(Boolean) || [];

      if (videoIds.length === 0) break;

      const videosParams = new URLSearchParams({
        part: 'snippet,status,contentDetails,statistics',
        id: videoIds.join(',')
      });

      const videosResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?${videosParams.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      await this.handleApiResponse(videosResponse);

      if (!videosResponse.ok) {
        throw new Error(`Failed to fetch video details: ${videosResponse.status} ${videosResponse.statusText}`);
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

      nextPageToken = searchData.nextPageToken;

    } while (nextPageToken && videos.length < maxResults);

    return videos;
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
      if (updates.privacy_status !== undefined) {
        (requestBody.status as any).privacyStatus = updates.privacy_status;
      }

      const response = await fetch(
        'https://www.googleapis.com/youtube/v3/videos?part=snippet,status',
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        }
      );

      await this.handleApiResponse(response);

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

  async batchUpdateVideos(updates: Array<{ video_id: string } & Partial<VideoData>>): Promise<{ success: boolean; error?: string; results?: any }> {
    const results = {
      successful: [] as Array<{ video_id: string; title: string }>,
      failed: [] as Array<{ video_id: string; error: string }>
    };

    for (const update of updates) {
      const { video_id, ...videoUpdates } = update;
      const result = await this.updateVideo(video_id, videoUpdates);

      if (result.success) {
        results.successful.push({
          video_id,
          title: videoUpdates.title || 'Unknown'
        });
      } else {
        results.failed.push({
          video_id,
          error: result.error || 'Unknown error'
        });
      }
    }

    return {
      success: results.failed.length === 0,
      results,
      error: results.failed.length > 0 ? `${results.failed.length} updates failed` : undefined
    };
  }

  isLoggedIn(): boolean {
    return this.isAuthenticated && !!this.accessToken && this.isTokenValid();
  }

  hasCredentials(): boolean {
    return !!this.config.clientId;
  }

  getAuthStatus(): { isLoggedIn: boolean; hasCredentials: boolean; hasToken: boolean; tokenLength?: number; isTokenValid: boolean } {
    return {
      isLoggedIn: this.isLoggedIn(),
      hasCredentials: this.hasCredentials(),
      hasToken: !!this.accessToken,
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

      const tokenRequestBody = new URLSearchParams({
        code,
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code'
      });

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

      await this.handleApiResponse(tokenResponse);

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json().catch(() => ({}));
        const errorMessage = errorData.error_description || errorData.error || 'Token exchange failed';
        console.error('Token exchange error:', errorData);
        throw new Error(errorMessage);
      }

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        this.storeToken(tokenData.access_token, tokenData.expires_in || 3600);
        localStorage.removeItem('oauth_state');
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