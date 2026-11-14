/**
 * Calls `tick` every `ms` while the tab is visible. A hidden tab does not poll;
 * when it becomes visible again `tick` runs immediately and the timer restarts.
 * Returns a stop function.
 */
export function startVisiblePolling(tick: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const start = () => {
    if (timer === null) timer = setInterval(tick, ms);
  };
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const onVisibility = () => {
    if (isVisible()) {
      stop();
      tick();
      start();
    } else {
      stop();
    }
  };

  if (isVisible()) start();
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
