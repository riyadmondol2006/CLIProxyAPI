import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFilesApi } from '@/services/api';
import { useAuthStore, useConfigStore, useModelsStore } from '@/stores';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { getProviderKeyCounts } from '@/features/dashboard/hooks/useDashboardOverview';

/**
 * Live status for the Setup Guide: client keys, connected upstream credentials, and models.
 * `null` counts mean "not loaded yet" so the UI never claims a step is missing prematurely.
 */
export function useSetupGuide() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModels = useModelsStore((state) => state.fetchModels);

  const connected = connectionStatus === 'connected';
  const resolveApiKeys = useApiKeysForModels();

  const [apiKeys, setApiKeys] = useState<string[] | null>(null);
  const [authFileCount, setAuthFileCount] = useState<number | null>(null);

  const loadAuthFiles = useCallback(async () => {
    if (!connected) return;
    try {
      const response = await authFilesApi.list();
      setAuthFileCount(response.files.length);
    } catch {
      setAuthFileCount(null);
    }
  }, [connected]);

  const loadKeysAndModels = useCallback(
    async (force = false) => {
      if (!connected || !apiBase) return;
      try {
        const keys = await resolveApiKeys({ force });
        setApiKeys(keys);
        await fetchModels(apiBase, keys[0], force);
      } catch {
        // Missing models are reported by the checklist; nothing else depends on this call.
      }
    },
    [connected, apiBase, resolveApiKeys, fetchModels]
  );

  useEffect(() => {
    if (!connected) return;
    void fetchConfig().catch(() => undefined);
    void loadAuthFiles();
    void loadKeysAndModels();
  }, [connected, fetchConfig, loadAuthFiles, loadKeysAndModels]);

  const refresh = useCallback(async () => {
    if (!connected) return;
    await Promise.allSettled([fetchConfig(true), loadAuthFiles(), loadKeysAndModels(true)]);
  }, [connected, fetchConfig, loadAuthFiles, loadKeysAndModels]);

  const providerKeyCount = useMemo(() => {
    if (!config) return null;
    return Object.values(getProviderKeyCounts(config)).reduce((sum, count) => sum + count, 0);
  }, [config]);

  const clientKeys = useMemo(() => apiKeys ?? config?.apiKeys ?? [], [apiKeys, config?.apiKeys]);

  return {
    connected,
    apiBase,
    clientKeys,
    clientKeysLoaded: apiKeys !== null || Boolean(config),
    authFileCount,
    providerKeyCount,
    models,
    modelsLoading,
    refresh,
  };
}
