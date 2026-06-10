// User-feedback UI helpers extracted from YouTubeBatchManager (A11): the
// status toast, the full-page loading overlay, and the static auth /
// no-credentials notices. Pure DOM + i18n — no app state.

import rendererI18n from './i18n/renderer-i18n.js';

export function showStatus(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const statusEl = document.getElementById('status-message');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type} show`;

    // Real timer (kept, A28): the status toast auto-hides after 3s by design.
    setTimeout(() => {
      statusEl.classList.remove('show');
    }, 3000);
  }
}

export function showAuthenticationPrompt(): void {
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

// Shared "no credentials" notice (A26): previously duplicated verbatim in
// renderVideos and initializeApp. The template's indentation deliberately
// matches the original initializeApp block so the rendered innerHTML stays
// byte-identical with the pre-refactor output.
export function renderNoCredentials(container: HTMLElement): void {
  container.innerHTML = `
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

export function showLoadingOverlay(mainText?: string, subText?: string): void {
  const overlay = document.getElementById('loading-overlay');
  const mainTextEl = document.getElementById('loading-text');
  const subTextEl = document.getElementById('loading-subtext');

  if (overlay) {
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-busy', 'true');
    // Double rAF (A28): the first frame commits display:flex with the
    // overlay still transparent; adding .show on the next frame then
    // reliably triggers the CSS opacity transition (a same-frame add would
    // skip it). Replaces a 10ms setTimeout doing the same job by luck.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add('show');
      });
    });
  }

  if (mainTextEl && mainText) {
    mainTextEl.textContent = mainText;
  }

  if (subTextEl && subText) {
    subTextEl.textContent = subText;
  }
}

export function hideLoadingOverlay(): void {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-busy', 'false');
    // Real timer (kept, A28): waits out the overlay's 0.3s CSS transition
    // before removing it from layout; a transitionend listener can be
    // skipped entirely (reduced-motion, interrupted transition) and would
    // then leave the overlay blocking the page.
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 300);
  }
}
