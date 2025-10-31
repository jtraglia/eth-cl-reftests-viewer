/**
 * Dark mode functionality
 */

const DARK_MODE_KEY = 'eth-spec-tests-dark-mode';

/**
 * Initialize dark mode based on stored preference or system preference
 */
export function initDarkMode() {
  const toggle = document.getElementById('darkModeToggle');

  // Check for stored preference or system preference
  const storedPreference = localStorage.getItem(DARK_MODE_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const isDark = storedPreference === 'true' || (storedPreference === null && prefersDark);

  // Set initial state
  setDarkMode(isDark);
  toggle.checked = isDark;

  // Listen for toggle changes
  toggle.addEventListener('change', (e) => {
    setDarkMode(e.target.checked);
  });

  // Listen for system preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (localStorage.getItem(DARK_MODE_KEY) === null) {
      setDarkMode(e.matches);
      toggle.checked = e.matches;
    }
  });
}

/**
 * Set dark mode on or off
 */
function setDarkMode(enabled) {
  if (enabled) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  localStorage.setItem(DARK_MODE_KEY, enabled.toString());
}
