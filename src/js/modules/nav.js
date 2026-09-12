/* Shared navigation disclosure and mobile drawer. */
let disposeNavigation = null;

export function destroyNav() {
  disposeNavigation?.();
}

export function initNav() {
  destroyNav();
  const nav = document.getElementById('nav');
  if (!nav) return;
  const toggle = document.getElementById('nav-toggle');
  const mobileMenu = document.getElementById('nav-mobile-menu');
  const backdrop = document.getElementById('nav-mobile-backdrop');
  const dropdown = nav.querySelector('.nav-worlds-dropdown--desktop');
  const trigger = dropdown?.querySelector('.nav-worlds-trigger');
  const worldsMenu = dropdown?.querySelector('.nav-worlds-menu');
  const controller = new AbortController();
  const { signal } = controller;
  const mobile = matchMedia('(max-width: 768px)');
  const hover = matchMedia('(hover: hover)');
  let menuOpen = false;
  let worldsOpen = false;
  let hoverOnly = false;
  let previousOverflow = '';
  let inertBefore = [];

  function setWorldsOpen(open, { fromHover = false } = {}) {
    if (!trigger || !worldsMenu) return;
    worldsOpen = open && !mobile.matches;
    hoverOnly = worldsOpen && fromHover;
    dropdown.classList.toggle('is-worlds-open', worldsOpen);
    trigger.setAttribute('aria-expanded', String(worldsOpen));
    worldsMenu.setAttribute('aria-hidden', String(!worldsOpen));
    worldsMenu.inert = !worldsOpen;
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (!menuOpen) return;
    menuOpen = false;
    mobileMenu.classList.remove('active');
    mobileMenu.inert = true;
    mobileMenu.setAttribute('aria-hidden', 'true');
    backdrop?.classList.remove('active');
    toggle.classList.remove('active');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = previousOverflow;
    for (const [node, wasInert] of inertBefore) node.inert = wasInert;
    inertBefore = [];
    if (restoreFocus && mobile.matches) toggle.focus({ preventScroll: true });
  }

  function openMenu() {
    if (menuOpen || !mobile.matches || !mobileMenu || !toggle) return;
    setWorldsOpen(false);
    menuOpen = true;
    previousOverflow = document.body.style.overflow;
    const allowed = [nav, mobileMenu, backdrop].filter(Boolean);
    inertBefore = [...document.body.children]
      .filter(node => !allowed.some(root => node === root || node.contains(root)))
      .filter(node => !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName))
      .map(node => [node, node.inert]);
    for (const [node] of inertBefore) node.inert = true;
    mobileMenu.inert = false;
    mobileMenu.setAttribute('aria-hidden', 'false');
    mobileMenu.classList.add('active');
    backdrop?.classList.add('active');
    toggle.classList.add('active');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    mobileMenu.querySelector('a[href]')?.focus({ preventScroll: true });
  }

  function isPlainKey(event) {
    return !event.defaultPrevented && !event.isComposing
      && !event.altKey && !event.ctrlKey && !event.metaKey;
  }

  toggle?.addEventListener('click', () => {
    if (menuOpen) closeMenu({ restoreFocus: true });
    else openMenu();
  }, { signal });
  backdrop?.addEventListener('click', () => closeMenu({ restoreFocus: true }), { signal });
  mobileMenu?.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (event.target.closest('a[href]')) closeMenu();
  }, { signal });

  trigger?.addEventListener('click', () => {
    setWorldsOpen(!worldsOpen || hoverOnly);
  }, { signal });
  trigger?.addEventListener('keydown', event => {
    if (!isPlainKey(event) || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    setWorldsOpen(true);
    const links = [...worldsMenu.querySelectorAll('a[href]')];
    (event.key === 'ArrowUp' ? links.at(-1) : links[0])?.focus();
  }, { signal });
  dropdown?.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse' && hover.matches && !worldsOpen) setWorldsOpen(true, { fromHover: true });
  }, { signal });
  dropdown?.addEventListener('pointerleave', () => {
    if (!dropdown.contains(document.activeElement)) setWorldsOpen(false);
  }, { signal });
  dropdown?.addEventListener('focusout', () => {
    queueMicrotask(() => {
      if (!signal.aborted && !dropdown.contains(document.activeElement)) setWorldsOpen(false);
    });
  }, { signal });
  document.addEventListener('click', event => {
    if (worldsOpen && !dropdown.contains(event.target)) setWorldsOpen(false);
  }, { signal });

  document.addEventListener('keydown', event => {
    if (!isPlainKey(event)) return;
    if (event.key === 'Escape' && (menuOpen || worldsOpen)) {
      event.preventDefault();
      if (menuOpen) closeMenu({ restoreFocus: true });
      else {
        const restoreFocus = dropdown.contains(document.activeElement);
        setWorldsOpen(false);
        if (restoreFocus) trigger.focus({ preventScroll: true });
      }
    } else if (event.key === 'Tab' && menuOpen) {
      const controls = [...nav.querySelectorAll('a[href], button'), ...mobileMenu.querySelectorAll('a[href], button')]
        .filter(node => !node.disabled && !node.closest('[inert]') && node.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      const active = document.activeElement;
      if (!controls.includes(active) || (!event.shiftKey && active === last) || (event.shiftKey && active === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  }, { signal });

  mobile.addEventListener('change', () => {
    const focusWasMobile = mobileMenu?.contains(document.activeElement) || document.activeElement === toggle;
    const focusWasDesktop = dropdown?.contains(document.activeElement);
    closeMenu();
    setWorldsOpen(false);
    if (focusWasMobile && !mobile.matches) trigger?.focus({ preventScroll: true });
    if (focusWasDesktop && mobile.matches) toggle?.focus({ preventScroll: true });
  }, { signal });
  window.addEventListener('pagehide', event => {
    closeMenu();
    setWorldsOpen(false);
    if (!event.persisted) destroy();
  }, { signal });

  function destroy() {
    closeMenu();
    setWorldsOpen(false);
    controller.abort();
    nav.classList.remove('nav-enhanced');
    if (worldsMenu) {
      worldsMenu.inert = false;
      worldsMenu.removeAttribute('aria-hidden');
    }
    if (disposeNavigation === destroy) disposeNavigation = null;
  }

  nav.classList.add('visible', 'nav-enhanced');
  setWorldsOpen(false);
  disposeNavigation = destroy;
  return destroy;
}
