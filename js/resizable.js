/**
 * Sidebar resize functionality
 */

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 1200;
const DEFAULT_SIDEBAR_WIDTH = 700;
const SIDEBAR_WIDTH_KEY = 'eth-spec-tests-sidebar-width';

/**
 * Initialize sidebar resizing
 */
export function initResizable() {
  const sidebar = document.getElementById('sidebar');
  const resizeHandle = document.getElementById('resizeHandle');

  // Restore saved width or use default
  const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (savedWidth) {
    sidebar.style.width = savedWidth + 'px';
  }

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  // Mouse down on resize handle
  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;

    // Prevent text selection while dragging
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    e.preventDefault();
  });

  // Mouse move
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const delta = e.clientX - startX;
    let newWidth = startWidth + delta;

    // Clamp width
    newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));

    sidebar.style.width = newWidth + 'px';
  });

  // Mouse up
  document.addEventListener('mouseup', () => {
    if (!isResizing) return;

    isResizing = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    // Save width
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebar.offsetWidth);
  });

  // Double-click to reset to default width
  resizeHandle.addEventListener('dblclick', () => {
    sidebar.style.width = DEFAULT_SIDEBAR_WIDTH + 'px';
    localStorage.setItem(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH);
  });
}
