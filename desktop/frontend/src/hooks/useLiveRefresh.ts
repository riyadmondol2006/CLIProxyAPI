import { useEffect, useRef } from 'react';

/** How often pages that show usage refresh it while they are on screen. */
export const LIVE_REFRESH_MS = 5000;

/**
 * Calls `refresh` every `intervalMs` while the page is visible, and once as soon as it becomes
 * visible again. A refresh never starts while the previous one is still running, and a failed one
 * is left for the next tick, so callers should keep showing their last data.
 */
export function useLiveRefresh(
  refresh: () => Promise<unknown> | void,
  enabled: boolean,
  intervalMs: number = LIVE_REFRESH_MS
) {
  const savedRefresh = useRef(refresh);
  useEffect(() => {
    savedRefresh.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const tick = async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        await savedRefresh.current();
      } catch {
        // Keep the last data; the next tick tries again.
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void tick(), intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
