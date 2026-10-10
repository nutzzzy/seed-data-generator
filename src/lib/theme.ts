/** Light, dark, or follow the operating system. Stored per browser, separately from the workspace. */
export type Theme = 'light' | 'dark' | 'system';

// index.html reads the same key before the app loads, so the page never flashes the wrong theme.
export const THEME_KEY = 'local-table-generator:theme';

export function loadTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked: the choice still applies until the page is closed */
  }
}

/** "system" removes the attribute, so the prefers-color-scheme rules in styles.css decide. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
