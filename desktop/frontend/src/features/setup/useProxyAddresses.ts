import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/stores';
import { accessKeysApi, type ServerNetwork } from '@/services/api/accessKeys';
import { isDesktopApp } from '@/utils/desktop';

export interface ProxyAddresses {
  /** Base URL (no trailing slash) apps on the proxy host can use; a remote panel's own address. */
  local: string;
  /** Base URLs other devices on the local network can use; empty when LAN access is off. */
  lan: string[];
  lanEnabled: boolean;
  /**
   * The browser panel reached the proxy over the network (not localhost), so `local` is the
   * server's own address and the desktop-style LAN switch doesn't apply.
   */
  remote: boolean;
  /** The base URL to hand to other people and devices. */
  share: string;
  /** Others can reach `share`: it is a remote address or a LAN URL. */
  shareReachable: boolean;
  /** A host or port change is saved but waits for a service restart. */
  restartRequired: boolean;
  loaded: boolean;
}

const DEFAULT_PORT = 8317;

const trimBase = (value: string): string => value.trim().replace(/\/+$/, '');

/** True for localhost, 127.x.x.x and ::1 URLs, which only work on the server itself. */
export const isLoopbackUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)
    );
  } catch {
    return false;
  }
};

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
  const remote = !desktop && usableApiBase !== '' && !isLoopbackUrl(usableApiBase);
  const lan = lanEnabled
    ? (network?.lanUrls ?? []).map(trimBase).filter((url) => url !== '' && url !== local)
    : [];
  // A remote panel's own URL already works for everyone who can open it; LAN URLs of a remote
  // server are often private addresses the user can't reach.
  const share = remote ? local : (lan[0] ?? local);
  return {
    local,
    lan,
    lanEnabled,
    remote,
    share,
    shareReachable: remote || lan.length > 0,
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

  const desktop = isDesktopApp();
  return { ...resolveProxyAddresses(apiBase, network, desktop), desktop, refresh };
}
