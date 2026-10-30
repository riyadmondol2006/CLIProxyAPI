import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/stores';
import { accessKeysApi, type ServerNetwork } from '@/services/api/accessKeys';
import { isDesktopApp } from '@/utils/desktop';

export interface ProxyAddresses {
  /** Base URL (no trailing slash) for apps on this computer, e.g. http://127.0.0.1:8317. */
  local: string;
  /** Base URLs other devices on the local network can use; empty when LAN access is off. */
  lan: string[];
  lanEnabled: boolean;
  /** A host or port change is saved but waits for a service restart. */
  restartRequired: boolean;
  loaded: boolean;
}

const DEFAULT_PORT = 8317;

const trimBase = (value: string): string => value.trim().replace(/\/+$/, '');

/**
 * Works out the proxy's addresses from where the server is actually listening.
 * Inside the desktop app the UI runs on the app's own origin, so the address the window
 * uses is not one other apps can use; build it from the bound port instead.
 */
export const resolveProxyAddresses = (
  apiBase: string,
  network: ServerNetwork | null,
  desktop: boolean
): ProxyAddresses => {
  const scheme = network?.scheme || 'http';
  const port = network?.port || DEFAULT_PORT;
  const usableApiBase = /^https?:\/\//i.test(apiBase) ? trimBase(apiBase) : '';
  const local = desktop || !usableApiBase ? `${scheme}://127.0.0.1:${port}` : usableApiBase;
  const lanEnabled = Boolean(network?.lanEnabled);
  return {
    local,
    lan: lanEnabled ? (network?.lanUrls ?? []).map(trimBase).filter(Boolean) : [],
    lanEnabled,
    restartRequired: Boolean(network?.restartRequired),
    loaded: network !== null,
  };
};

/** Loads the proxy's local and LAN base URLs; refresh() re-reads them. */
export function useProxyAddresses() {
  const apiBase = useAuthStore((state) => state.apiBase);
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [network, setNetwork] = useState<ServerNetwork | null>(null);

  const refresh = useCallback(async () => {
    if (!connected) return;
    try {
      setNetwork(await accessKeysApi.network());
    } catch {
      // Older backends have no /server/network; fall back to the default address.
    }
  }, [connected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...resolveProxyAddresses(apiBase, network, isDesktopApp()), refresh };
}
