// Static fallback catalogs extracted from YouTubeBatchManager (A11). Used
// until (or instead of, when unauthenticated) the videoCategories.list /
// i18nLanguages.list API data loads.

export const FALLBACK_VIDEO_CATEGORIES: Record<string, { id: string; title: string }> = {
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

export const FALLBACK_I18N_LANGUAGES: Record<string, { id: string; name: string }> = {
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
