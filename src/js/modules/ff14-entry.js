import { BackgroundManager } from './background-manager.js';
import { initNav } from './nav.js';
import { ANIM } from './anim-tokens.js';
import {
  ff14SelectionUrl,
  legacyFf14Destination,
  resolveFf14Selection,
} from './ff14-routing.js';

let interactionController = null;

function dismissPortalOverlay() {
  const overlay = document.getElementById('portal-arrival');
  if (!overlay) return;
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.transition = `opacity ${ANIM.duration.normal}ms ${ANIM.easing.out}`;
}

function listen(node, type, handler) {
  node.addEventListener(type, handler, { signal: interactionController.signal });
}

function pushSelection(parameter, value) {
  const nextUrl = ff14SelectionUrl(location.href, parameter, value);
  if (nextUrl === `${location.pathname}${location.search}${location.hash}`) return;
  history.pushState(
    { ff14Selection: { parameter, value } },
    '',
    nextUrl,
  );
}

function initSelectableLens({
  parameter,
  buttonSelector,
  panelSelector,
  buttonDataKey,
  panelDataKey,
}) {
  const buttons = [...document.querySelectorAll(buttonSelector)];
  const panels = [...document.querySelectorAll(panelSelector)];
  if (buttons.length === 0 || panels.length === 0) return;

  const allowedIds = buttons.map(button => button.dataset[buttonDataKey]);

  function select(selection, { updateUrl = true, focus = false } = {}) {
    const targetIndex = allowedIds.indexOf(selection);
    if (targetIndex < 0) return;

    for (const button of buttons) {
      const active = button.dataset[buttonDataKey] === selection;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset[panelDataKey] !== selection;
    }

    if (updateUrl) pushSelection(parameter, selection);
    if (focus) buttons[targetIndex].focus();
  }

  for (const [index, button] of buttons.entries()) {
    listen(button, 'click', () => select(button.dataset[buttonDataKey]));
    listen(button, 'keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = buttons.length - 1;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (index - 1 + buttons.length) % buttons.length;
      } else {
        nextIndex = (index + 1) % buttons.length;
      }
      select(allowedIds[nextIndex], { focus: true });
    });
  }

  const initial = resolveFf14Selection(
    location.search,
    location.hash,
    parameter,
    allowedIds,
  );
  select(initial, { updateUrl: false });

  listen(window, 'popstate', () => {
    const selection = resolveFf14Selection(
      location.search,
      location.hash,
      parameter,
      allowedIds,
    );
    select(selection, { updateUrl: false, focus: false });
  });
}

function initAetherParallax() {
  const portal = document.querySelector('.ff-portal');
  if (!portal || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  listen(portal, 'pointermove', event => {
    const xRatio = Math.min(1, Math.max(0, event.clientX / window.innerWidth));
    const yRatio = Math.min(1, Math.max(0, event.clientY / window.innerHeight));
    portal.style.setProperty('--ff-pointer-x', `${(xRatio * 100).toFixed(2)}%`);
    portal.style.setProperty('--ff-pointer-y', `${(yRatio * 100).toFixed(2)}%`);
    portal.style.setProperty('--ff-shift-x', `${((xRatio - 0.5) * 24).toFixed(2)}px`);
    portal.style.setProperty('--ff-shift-y', `${((yRatio - 0.5) * 16).toFixed(2)}px`);
  });
}

export function destroyFf14Entry() {
  interactionController?.abort();
  interactionController = null;
}

export function initFf14Entry() {
  destroyFf14Entry();
  interactionController = new AbortController();

  const pageType = document.body.dataset.page;
  const legacyDestination = pageType === 'ff14-home'
    ? legacyFf14Destination(location.search, location.hash)
    : null;
  if (legacyDestination) {
    location.replace(`./${legacyDestination}`);
    return;
  }

  BackgroundManager.init('bg-canvas', 'bg-video', 'bg-image');
  BackgroundManager.switchTo('ff14');
  initNav();
  dismissPortalOverlay();

  if (pageType === 'ff14-home') initAetherParallax();
  if (pageType === 'ff14-reflections') {
    initSelectableLens({
      parameter: 'reflection',
      buttonSelector: '[data-reflection-id]',
      panelSelector: '[data-reflection-panel]',
      buttonDataKey: 'reflectionId',
      panelDataKey: 'reflectionPanel',
    });
  }
  if (pageType === 'ff14-journeys') {
    initSelectableLens({
      parameter: 'journey',
      buttonSelector: '[data-journey-id]',
      panelSelector: '[data-journey-panel]',
      buttonDataKey: 'journeyId',
      panelDataKey: 'journeyPanel',
    });
  }
}
