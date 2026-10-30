import { useCallback, useEffect, useRef, useState } from 'react';
import { tokenUsageApi, type TokenUsage } from '@/services/api/tokenUsage';
import { getErrorMessage } from '@/utils/helpers';

export interface TokenUsageState {
  usage: TokenUsage | null;
  loading: boolean;
  /** Null when the last load worked; otherwise the server's message, possibly empty. */
  error: string | null;
  /** When the shown data was loaded (ms since the epoch). */
  updatedAt: number | null;
  reload: () => Promise<void>;
}

/**
 * Loads the last 90 days of token usage once; periods are sliced on the client. Only the latest
 * request may update the state, and nothing updates it after unmount. Mount it per connection
 * (keyed by the API base) so another connection never sees this one's data.
 */
export function useTokenUsage(enabled: boolean): TokenUsageState {
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const id = ++requestId.current;
    setLoading(true);
    try {
      const next = await tokenUsageApi.daily();
      if (id !== requestId.current) return;
      setUsage(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      if (id !== requestId.current) return;
      setError(getErrorMessage(err, ''));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const ids = requestId;
    return () => {
      // Drop any response still in flight.
      ids.current += 1;
    };
  }, []);

  return { usage, loading, error, updatedAt, reload };
}
