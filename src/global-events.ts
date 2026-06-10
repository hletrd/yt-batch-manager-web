// Document/window-level event wiring extracted from
// YouTubeBatchManager.setupEventListeners (A11): the rAF-throttled passive
// scroll handler, the delegated tag-remove clicks, dropdown / mobile-menu
// dismissal, the Escape key, and the responsive menu reset on resize. The two
// app reactions (infinite-scroll loading and tag removal) are injected.

export interface GlobalEventDeps {
  onScroll(): Promise<void>;
  removeTag(videoId: string, tag: string): void;
}

export function setupGlobalEventListeners(deps: GlobalEventDeps): void {
  // Coalesce scroll events to at most one handler run per animation frame and
  // register the listener as passive so it never blocks scrolling. handleScroll
  // reads layout properties, so firing it on every raw scroll event caused jank.
  let scrollRafScheduled = false;
  window.addEventListener('scroll', () => {
    if (scrollRafScheduled) return;
    scrollRafScheduled = true;
    requestAnimationFrame(() => {
      scrollRafScheduled = false;
      void deps.onScroll();
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
        deps.removeTag(videoId, tag);
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
