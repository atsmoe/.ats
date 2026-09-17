import { worldRecordHref } from './world-routing.js';

// One control serves the current chronicle record or a fixed ending card.
export function initRecordShare({ actions, worldId, getRecord, signal }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'record-share-button';
  button.textContent = '复制记录链接';
  const feedback = document.createElement('div');
  feedback.className = 'record-share-feedback';
  feedback.hidden = true;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const address = document.createElement('input');
  address.type = 'text';
  address.readOnly = true;
  address.hidden = true;
  address.setAttribute('aria-label', '记录链接，可手动复制');
  feedback.append(status, address);
  actions.append(button);
  actions.after(feedback);
  let currentId;
  let generation = 0;
  let pending = false;

  function refresh() {
    const record = getRecord();
    if (record?.id !== currentId) {
      currentId = record?.id;
      generation++;
      pending = false;
      feedback.hidden = true;
      address.hidden = true;
      address.value = '';
      status.textContent = '';
    }
    button.disabled = !record;
    button.setAttribute('aria-busy', String(pending));
    button.setAttribute('aria-label', record ? `复制记录链接：${record.title}` : '复制记录链接');
  }

  button.addEventListener('click', async () => {
    const record = getRecord();
    if (!record || pending) return;
    const url = new URL(worldRecordHref({ worldId, eventId: record.id }), location.href).href;
    const token = ++generation;
    pending = true;
    feedback.hidden = false;
    address.hidden = true;
    status.textContent = '正在复制链接…';
    refresh();
    try {
      await navigator.clipboard.writeText(url);
      if (signal.aborted || token !== generation) return;
      status.textContent = '记录链接已复制。';
    } catch {
      if (signal.aborted || token !== generation) return;
      status.textContent = '无法自动复制，请选择下方链接手动复制。';
      address.value = url;
      address.hidden = false;
      // A delayed permission result must not take focus from another control.
      if (document.activeElement === button) { address.focus(); address.select(); }
    } finally {
      if (!signal.aborted && token === generation) { pending = false; refresh(); }
    }
  }, { signal });
  address.addEventListener('click', () => address.select(), { signal });
  address.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    feedback.hidden = true;
    address.hidden = true;
    button.focus();
  }, { signal });
  refresh();
  return { refresh };
}
