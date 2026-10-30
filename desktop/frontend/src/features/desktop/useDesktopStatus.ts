import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopApi, type DesktopServiceAction, type DesktopStatus } from '@/utils/desktop';
import { getErrorMessage } from '@/utils/helpers';

/** Polls the app backend for the proxy service state and exposes service actions. */
export function useDesktopStatus(intervalMs: number, enabled = true) {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<DesktopServiceAction | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await desktopApi.status();
      if (!mounted.current) return null;
      setStatus(next);
      setError('');
      return next;
    } catch (err) {
      if (mounted.current) setError(getErrorMessage(err, 'Status unavailable'));
      return null;
    }
  }, []);

  const run = useCallback(async (action: DesktopServiceAction) => {
    setPending(action);
    try {
      const next = await desktopApi.service(action);
      if (mounted.current) {
        setStatus(next);
        setError('');
      }
      return true;
    } catch (err) {
      if (mounted.current) setError(getErrorMessage(err, 'Service action failed'));
      return false;
    } finally {
      if (mounted.current) setPending(null);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return undefined;
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, refresh]);

  return { status, error, pending, refresh, run };
}
