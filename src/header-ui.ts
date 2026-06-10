// Header/chrome UI state extracted from YouTubeBatchManager (A11): the
// auth-dependent button enabling, the save-all button visibility/counter,
// the channel-header reset, and the mobile-menu/dropdown togglers. App state
// arrives as plain parameters; DOM ids/classes are unchanged.

import rendererI18n from './i18n/renderer-i18n.js';

export function updateAuthDependentButtons(isAuthenticated: boolean): void {
  const refreshBtn = document.getElementById('refresh-videos-btn') as HTMLButtonElement;
  const logoutBtn = document.getElementById('logout-btn') as HTMLAnchorElement;

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

export function updateSaveAllButton(changedCount: number, saveInProgress: boolean): void {
  const saveAllBtn = document.getElementById('save-all-btn') as HTMLButtonElement;
  const changesCount = document.getElementById('changes-count');

  if (saveAllBtn) {
    if (changedCount > 0) {
      saveAllBtn.style.display = 'inline-flex';
      saveAllBtn.disabled = saveInProgress;
    } else {
      saveAllBtn.style.display = 'none';
    }
  }

  if (changesCount) {
    changesCount.textContent = '(' + changedCount.toString() + ')';
  }
}

// Reset the channel header back to its pre-login placeholder (A26): shared
// by logout() and removeSavedCredentials().
export function resetChannelHeader(): void {
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

export function toggleMobileMenu(): void {
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

export function toggleDropdown(): void {
  const dropdown = document.querySelector('.dropdown');
  if (dropdown) {
    dropdown.classList.toggle('show');
  }
}

export function toggleFileDropdown(): void {
  const dropdown = document.querySelector('.dropdown:last-of-type');
  if (dropdown) {
    dropdown.classList.toggle('show');
  }
}

export function closeDropdowns(): void {
  const dropdowns = document.querySelectorAll('.dropdown');
  dropdowns.forEach(dropdown => {
    dropdown.classList.remove('show');
  });
}
