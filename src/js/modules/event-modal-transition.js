const TRANSITION_CLASSES = [
  'is-modal-switching-next',
  'is-modal-switching-previous',
  'is-modal-switching-a',
  'is-modal-switching-b',
];

export function createEventModalTransition(root, {
  duration,
  easing,
  prefersReducedMotion = () => (
    typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ),
} = {}) {
  let nextPhase = 'a';

  function cancel() {
    root?.classList?.remove(...TRANSITION_CLASSES);
  }

  function play(direction) {
    cancel();
    if (!root?.classList || !root?.style || ![-1, 1].includes(direction)) return false;
    if (!Number.isFinite(duration) || typeof easing !== 'string' || easing.length === 0) return false;
    if (prefersReducedMotion()) return false;

    const directionClass = direction > 0
      ? 'is-modal-switching-next'
      : 'is-modal-switching-previous';
    const phaseClass = `is-modal-switching-${nextPhase}`;
    nextPhase = nextPhase === 'a' ? 'b' : 'a';

    root.style.setProperty('--event-modal-switch-duration', `${duration}ms`);
    root.style.setProperty('--event-modal-switch-easing', easing);
    root.style.setProperty('--event-modal-switch-direction', String(direction));
    root.classList.add(directionClass, phaseClass);
    return true;
  }

  return { play, cancel };
}
