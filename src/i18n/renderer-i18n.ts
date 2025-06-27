interface TranslationData {
  [key: string]: any;
}

class RendererI18n {
  private translations: TranslationData = {};
  private currentLanguage: string = 'en';
  private availableLanguages: string[] = [];
  private isInitialized: boolean = false;

  constructor() {
    this.initializeAsync();
  }

  private async initializeAsync(): Promise<void> {
    await this.scanAvailableLanguages();
    this.currentLanguage = this.detectSystemLanguage();
    await this.loadLanguage(this.currentLanguage);
    this.isInitialized = true;
  }

  private async scanAvailableLanguages(): Promise<void> {
    try {
      this.availableLanguages = ['en', 'ko'];
      console.log('Available languages:', this.availableLanguages.join(', '));
    } catch (error) {
      console.error('Error getting languages.', error);
    }

    if (!this.availableLanguages.includes('en')) {
      console.warn('English language file (fallback) not found');
      this.availableLanguages.unshift('en');
    }
  }

  private detectSystemLanguage(): string {
    try {
      const browserLanguages = navigator.languages || [navigator.language];

      for (const locale of browserLanguages) {
        const languageCode = locale.split('-')[0].toLowerCase();

        if (this.availableLanguages.includes(languageCode)) {
          console.log('Detected browser language:', languageCode, '(from locale:', locale + ')');
          return languageCode;
        }
      }

      console.log('No matching browser language found. Available:', this.availableLanguages.join(', '), 'Using fallback: en');
      return 'en';
    } catch (error) {
      console.warn('Error detecting browser language:', error);
      return 'en';
    }
  }

  getAvailableLanguages(): string[] {
    return [...this.availableLanguages];
  }

  addAvailableLanguage(language: string): void {
    if (!this.availableLanguages.includes(language)) {
      this.availableLanguages.push(language);
      this.availableLanguages.sort();
    }
  }

  async refreshAvailableLanguages(): Promise<void> {
    await this.scanAvailableLanguages();
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  async waitForInitialization(): Promise<void> {
    while (!this.isInitialized) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  getCurrentLanguage(): string {
    return this.currentLanguage;
  }

  private async loadLanguage(language: string): Promise<void> {
    try {
      const response = await fetch(`./i18n/${language}.json`);
      if (response.ok) {
        this.translations = await response.json();
      } else {
        console.warn('Language file not found for', language, 'falling back to en');
        if (language !== 'en') {
          return this.loadLanguage('en');
        }
      }
    } catch (error) {
      console.error('Error loading language file for', language + ':', error);
      if (language !== 'en') {
        return this.loadLanguage('en');
      }
    }
  }

  t(key: string, params?: Record<string, any>): string {
    if (!this.isInitialized) {
      return key;
    }

    const keys = key.split('.');
    let value: any = this.translations;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        console.warn('Translation key not found:', key);
        return key;
      }
    }

    if (typeof value !== 'string') {
      console.warn('Translation value is not a string for key:', key);
      return key;
    }

    if (params) {
      return this.interpolate(value, params);
    }

    return value;
  }

  private interpolate(template: string, params: Record<string, any>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return params[key] !== undefined ? String(params[key]) : match;
    });
  }

  updatePageTexts(): void {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
      const key = element.getAttribute('data-i18n');
      if (key) {
        if (element.tagName === 'BUTTON' && element.querySelector('svg')) {
          const textSpan = element.querySelector('span[data-i18n]');
          if (textSpan) {
            textSpan.textContent = this.t(key);
          } else {
            const span = document.createElement('span');
            span.textContent = this.t(key);
            element.appendChild(span);
          }
        } else {
          element.textContent = this.t(key);
        }
      }
    });

    const elementsWithPlaceholder = document.querySelectorAll('[data-i18n-placeholder]');
    elementsWithPlaceholder.forEach(element => {
      const key = element.getAttribute('data-i18n-placeholder');
      if (key && element instanceof HTMLInputElement) {
        element.placeholder = this.t(key);
      }
    });

    const elementsWithTitle = document.querySelectorAll('[data-i18n-title]');
    elementsWithTitle.forEach(element => {
      const key = element.getAttribute('data-i18n-title');
      if (key && element instanceof HTMLElement) {
        element.title = this.t(key);
      }
    });
  }
}

export const rendererI18n = new RendererI18n();
export default rendererI18n;
