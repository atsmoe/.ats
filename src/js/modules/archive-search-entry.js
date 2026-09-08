import { initNav } from './nav.js';
import { initArchiveSearch } from './archive-search.js';

function init() {
  initNav();
  const root = document.getElementById('archive-search');
  if (!root) return;
  const destroy = initArchiveSearch(root);
  window.addEventListener('pagehide', event => {
    if (!event.persisted) destroy();
  });
}

init();
