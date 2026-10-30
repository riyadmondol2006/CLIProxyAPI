import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopApi, type DesktopDiagnostics } from '@/utils/desktop';
import { getErrorMessage } from '@/utils/helpers';

/**
 * Loads the service diagnostics while `enabled`, again whenever `trigger` changes (the gate
 * state, or a finished start/restart), and on `refresh`. It does not poll: reading the
 * journal is too heavy for the status interval.
 */
export function useServiceDiagnostics(enabled: boolean, trigger: string) {
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostics | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Only the newest request may update state; older answers and answers after unmount are dropped.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    try {
      const next = await desktopApi.diagnostics();
      if (id !== latest.current) return;
      setDiagnostics(next);
      setLoadedAt(Date.now());
      setError('');
    } catch (err) {
      if (id === latest.current) setError(getErrorMessage(err, 'Diagnostics unavailable'));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, trigger, refresh]);

  useEffect(
    () => () => {
      latest.current += 1;
    },
    []
  );

  return { diagnostics, loadedAt, loading, error, refresh };
}
