import { useCallback, useEffect, useRef, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { getErrorMessage } from '@/utils/helpers';
import { claudeUsageApi, type ClaudeUsageData, type ClaudeUsageStatus } from './api';
import type { DayRange } from './logic';

export const STATUS_POLL_MS = 1500;
export const AUTO_REFRESH_MS = 60_000;

interface Options {
  range: DayRange;
  models: string[];
  /** Refresh in the background (the range includes today). */
  live: boolean;
}

export interface ClaudeUsageState {
  status: ClaudeUsageStatus | null;
  data: ClaudeUsageData | null;
  loading: boolean;
  error: string;
  /** A scan the user asked for (or the first one) is running and its progress is shown. */
  showProgress: boolean;
  rescan: () => Promise<void>;
}

/**
 * Loads Claude usage from the app backend. Opening the page starts an incremental scan
 * in the background; while any scan runs the status is polled, and the data is reloaded
 * when it finishes.
 */
export function useClaudeUsage({ range, models, live }: Options): ClaudeUsageState {
  const [status, setStatus] = useState<ClaudeUsageStatus | null>(null);
  const [data, setData] = useState<ClaudeUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showProgress, setShowProgress] = useState(false);
  const requestId = useRef(0);
  const wasScanning = useRef(false);
  const mounted = useRef(true);
  const modelsKey = models.join(',');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const next = await claudeUsageApi.data({
        from: range.from,
        to: range.to,
        models: modelsKey ? modelsKey.split(',') : [],
      });
      if (id !== requestId.current || !mounted.current) return;
      setData(next);
      setError('');
    } catch (err) {
      if (id !== requestId.current || !mounted.current) return;
      setError(getErrorMessage(err, ''));
    } finally {
      if (id === requestId.current && mounted.current) setLoading(false);
    }
  }, [range.from, range.to, modelsKey]);

  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  const applyStatus = useCallback((next: ClaudeUsageStatus) => {
    if (!mounted.current) return;
    setStatus(next);
    // Reload once a scan has finished.
    if (wasScanning.current && !next.scanning) {
      setShowProgress(false);
      void loadDataRef.current();
    }
    wasScanning.current = next.scanning;
  }, []);

  /** Starts an incremental scan; `visible` shows its progress on the page. */
  const scan = useCallback(
    async (visible: boolean) => {
      if (visible) setShowProgress(true);
      try {
        const next = await claudeUsageApi.scan();
        // Mark the scan as running so the finished status triggers a reload even when it
        // was too quick for the poll to see.
        wasScanning.current = true;
        applyStatus(next);
      } catch (err) {
        if (!mounted.current) return;
        setShowProgress(false);
        setError(getErrorMessage(err, ''));
      }
    },
    [applyStatus]
  );

  // Data follows the range and model filter.
  useEffect(() => {
    void loadData();
  }, [loadData]);

  // On open: read the status, then pick up any new log lines.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await claudeUsageApi.status();
        if (cancelled) return;
        applyStatus(current);
        if (current.scanning) {
          if (!current.lastScanAt) setShowProgress(true);
          return;
        }
        await scan(!current.lastScanAt);
      } catch (err) {
        if (!cancelled && mounted.current) setError(getErrorMessage(err, ''));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyStatus, scan]);

  // Poll while a scan runs.
  const scanning = status?.scanning === true;
  useEffect(() => {
    if (!scanning) return;
    let timer = 0;
    let stopped = false;
    const tick = async () => {
      try {
        const next = await claudeUsageApi.status();
        if (!stopped) applyStatus(next);
        if (!stopped && next.scanning) timer = window.setTimeout(tick, STATUS_POLL_MS);
      } catch {
        if (!stopped) timer = window.setTimeout(tick, STATUS_POLL_MS);
      }
    };
    timer = window.setTimeout(tick, STATUS_POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [scanning, applyStatus]);

  // Background refresh while the range includes today and the page is visible.
  useInterval(
    () => {
      if (document.visibilityState !== 'visible' || scanning) return;
      void scan(false);
    },
    live ? AUTO_REFRESH_MS : null
  );

  const rescan = useCallback(async () => {
    if (scanning) return;
    await scan(true);
  }, [scan, scanning]);

  return { status, data, loading, error, showProgress, rescan };
}
