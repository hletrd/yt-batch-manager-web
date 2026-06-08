// Shared domain types. Previously VideoData/ThumbnailData were declared
// independently in app.ts and youtube-api.ts and had drifted (only app.ts
// carried processing_progress). Keep a single source of truth here.

export interface ThumbnailData {
  url: string;
  width: number;
  height: number;
}

export interface VideoData {
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
  contains_synthetic_media?: boolean;
  made_for_kids?: boolean;
  license?: string;
  embeddable?: boolean;
  public_stats_viewable?: boolean;
  recording_date?: string;
  duration?: string;
  width_pixels?: number;
  height_pixels?: number;
  upload_status?: string;
  processing_status?: string;
  processing_progress?: {
    parts_total?: number;
    parts_processed?: number;
    time_left_ms?: number;
  };
  statistics?: {
    view_count?: string;
    like_count?: string;
    dislike_count?: string;
    comment_count?: string;
  };
}
