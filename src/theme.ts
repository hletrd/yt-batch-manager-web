// Light/dark theme handling extracted from YouTubeBatchManager (A11).
// Persists the explicit choice under the same localStorage key ('theme') and
// keeps the header icon in sync; behavior identical to the former methods.

function updateThemeIcon(theme: string): void {
  const iconPath = document.getElementById('theme-icon-path');
  if (iconPath) {
    if (theme === 'dark') {
      iconPath.setAttribute('d', 'M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93');
    } else {
      iconPath.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
    }
  }
}

function setTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
  localStorage.setItem('theme', theme);
}

export function toggleTheme(): void {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

export function initializeTheme(): void {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  } else {
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    updateThemeIcon(systemPrefersDark ? 'dark' : 'light');
  }
}
