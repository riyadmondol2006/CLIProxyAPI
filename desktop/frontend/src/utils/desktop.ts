/**
 * Desktop app integration. Inside the app window the UI runs on the `wails://wails`
 * origin; the app backend (desktop/internal/app) answers `/app/*` and forwards every
 * other request to the local proxy service with a localhost-only token.
 */

declare global {
  interface Window {
    /** Set by the desktop dev server so a browser behaves like the app window. */
    __CPA_DESKTOP__?: boolean;
    /** Wails runtime, injected into the app window. */
    runtime?: { BrowserOpenURL?: (url: string) => void };
  }
}

/** Placeholder key: the app backend replaces it with the real local token. */
export const DESKTOP_MANAGEMENT_KEY = 'desktop-app';

export const isDesktopApp = (): boolean =>
  typeof window !== 'undefined' &&
  (window.location?.protocol === 'wails:' || window.__CPA_DESKTOP__ === true);

export interface DesktopServiceStatus {
  available: boolean;
  installed: boolean;
  active: string;
  enabled: string;
  error?: string;
}

export interface DesktopStatus {
  appVersion: string;
  configPath: string;
  host: string;
  port: number;
  service: DesktopServiceStatus;
  tokenReady: boolean;
  reachable: boolean;
}

export type DesktopServiceAction = 'start' | 'stop' | 'restart';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const normalizeDesktopStatus = (input: unknown): DesktopStatus => {
  const record = isRecord(input) ? input : {};
  const listen = isRecord(record.listen) ? record.listen : {};
  const service = isRecord(record.service) ? record.service : {};
  return {
    appVersion: String(record['app-version'] ?? ''),
    configPath: String(record['config-path'] ?? ''),
    host: String(listen.host ?? ''),
    port: Number(listen.port) || 0,
    service: {
      available: service.available === true,
      installed: service.installed === true,
      active: String(service.active ?? ''),
      enabled: String(service.enabled ?? ''),
      error: typeof service.error === 'string' && service.error ? service.error : undefined,
    },
    tokenReady: record['token-ready'] === true,
    reachable: record.reachable === true,
  };
};

async function requestJSON(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : '';
    throw new Error(message || `Request failed (${response.status})`);
  }
  return body;
}

export const desktopApi = {
  async status(): Promise<DesktopStatus> {
    return normalizeDesktopStatus(await requestJSON('/app/status'));
  },

  async service(action: DesktopServiceAction): Promise<DesktopStatus> {
    return normalizeDesktopStatus(await requestJSON(`/app/service/${action}`, { method: 'POST' }));
  },
};

/** Opens a link in the user's browser instead of inside the app window. */
export async function openExternal(url: string): Promise<void> {
  if (window.runtime?.BrowserOpenURL) {
    window.runtime.BrowserOpenURL(url);
    return;
  }
  await requestJSON('/app/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

/**
 * Opens a sign-in link in the browser as soon as it arrives. Only the desktop app does
 * this: a browser tab would block a pop-up that isn't triggered by a click, so the web
 * panel keeps the "open" button. The dialog still shows the link for copying.
 */
export function openAuthUrlInBrowser(url: string | undefined): void {
  if (!url || !isDesktopApp()) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    void openExternal(parsed.toString()).catch(() => undefined);
  } catch {
    // Not a URL: leave it to the dialog's open button.
  }
}

const isExternalHref = (href: string): boolean => {
  try {
    const url = new URL(href, window.location.href);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin !== window.location.origin
    );
  } catch {
    return false;
  }
};

/**
 * Sends external links and window.open calls to the system browser. OAuth sign-in
 * pages and docs links would otherwise replace the app UI inside the window.
 */
export function installExternalLinkHandler(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (!isExternalHref(anchor.href)) return;
    event.preventDefault();
    void openExternal(anchor.href);
  };
  const originalOpen = window.open;
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url === undefined ? '' : String(url);
    if (href && isExternalHref(href)) {
      void openExternal(new URL(href, window.location.href).toString());
      return null;
    }
    return originalOpen.call(window, url, target, features);
  }) as typeof window.open;
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    window.open = originalOpen;
  };
}
