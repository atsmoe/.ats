/* ═══════════════════════════════════════════════════════════
   nav.js — Navigation bar + hamburger menu controller
   ═══════════════════════════════════════════════════════════ */

let menuOpen = false;
let isTouchDevice = false;

function openMenu() {
  menuOpen = true;
  const menu = document.getElementById('nav-mobile-menu');
  menu.classList.add('active');
  menu.removeAttribute('inert');
  menu.setAttribute('aria-hidden', 'false');
  document.getElementById('nav-mobile-backdrop').classList.add('active');
  document.getElementById('nav-toggle').classList.add('active');
  document.getElementById('nav-toggle').setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeMenu({ restoreFocus = false } = {}) {
  menuOpen = false;
  const menu = document.getElementById('nav-mobile-menu');
  menu.classList.remove('active');
  menu.setAttribute('inert', '');
  menu.setAttribute('aria-hidden', 'true');
  document.getElementById('nav-mobile-backdrop').classList.remove('active');
  const toggle = document.getElementById('nav-toggle');
  toggle.classList.remove('active');
  toggle.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  if (restoreFocus) toggle.focus();
}

export function initNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  // Entrance animation
  setTimeout(() => {
    nav.classList.add('visible');
  }, 400);

  // Touch device detection
  isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (isTouchDevice) {
    document.documentElement.classList.add('touch-device');
  }

  // Hamburger toggle
  const toggle = document.getElementById('nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menuOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    });
  }

  // Backdrop click → close
  const backdrop = document.getElementById('nav-mobile-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeMenu);
  }

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen) {
      closeMenu({ restoreFocus: true });
    }
  });

  // Close after navigation (link clicks in mobile menu)
  const mobileMenu = document.getElementById('nav-mobile-menu');
  if (mobileMenu) {
    mobileMenu.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        // Small delay so the link navigation fires first
        setTimeout(closeMenu, 100);
      }
    });
  }

  // Reset on resize above mobile breakpoint
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && menuOpen) {
      closeMenu();
    }
  });

  // Desktop world dropdown: click-toggle for touch devices
  if (isTouchDevice) {
    const desktopDropdown = document.querySelector('.nav-worlds-dropdown--desktop');
    if (desktopDropdown) {
      const trigger = desktopDropdown.querySelector('.nav-worlds-trigger');
      const menu = desktopDropdown.querySelector('.nav-worlds-menu');
      if (trigger && menu) {
        // Prevent hover from showing it on touch
        menu.style.pointerEvents = 'none';
        menu.style.opacity = '0';

        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const isOpen = menu.style.opacity === '1';
          if (isOpen) {
            menu.style.opacity = '0';
            menu.style.pointerEvents = 'none';
          } else {
            menu.style.opacity = '1';
            menu.style.pointerEvents = 'auto';
          }
        });

        // Close when clicking outside
        document.addEventListener('click', () => {
          menu.style.opacity = '0';
          menu.style.pointerEvents = 'none';
        });
      }
    }
  }
}
