/* ═══════════════════════════════════════════════════════════
   nav.js — Navigation bar initialization
   ═══════════════════════════════════════════════════════════ */

export function initNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  // Entrance animation
  setTimeout(() => {
    nav.classList.add('visible');
  }, 400);

  // Stub for future active-class toggling
  // Active class is handled by 11ty template, not JS
}
