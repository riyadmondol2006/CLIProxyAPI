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
  /** The app opens at login. */
  autostart: boolean;
}

export type DesktopServiceAction = 'start' | 'stop' | 'restart';

/** What systemd knows about the service's last run. */
export interface DesktopUnitState {
  activeState: string;
  subState: string;
  result: string;
  /** How the main process ended: 'exited', 'killed', 'dumped', or '' when it hasn't run. */
  exitCode: string;
  /** Exit status for 'exited'; the signal number for 'killed' and 'dumped'. */
  exitStatus: number;
  restarts: number;
  /** RFC 3339, or '' when unknown. */
  changedAt: string;
}

export interface DesktopDiagnosticHint {
  /** port_in_use, address_unavailable, config_invalid, permission_denied, ... */
  code: string;
  /** The matching message, address, or path (already redacted by the app). */
  detail: string;
  /** Config file line the error points at; 0 when unknown. */
  configLine: number;
}

/** Why the proxy service is down, from GET /app/diagnostics. */
export interface DesktopDiagnostics {
  /** False when systemd can't be asked (no systemd, containers, the dev server). */
  available: boolean;
  error: string;
  unit: DesktopUnitState;
  log: {
    available: boolean;
    error: string;
    /** Redacted journal lines, oldest first. */
    lines: string[];
    truncated: boolean;
  };
  hints: DesktopDiagnosticHint[];
  host: string;
  port: number;
  reachable: boolean;
}

export interface DesktopUpdatePackage {
  name: string;
  format: string;
  arch: string;
  /** Bytes; 0 when unknown. */
  size: number;
}

export interface DesktopUpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  devBuild: boolean;
  /** RFC 3339, or '' when never checked. */
  checkedAt: string;
  /** Set when the check failed (for example offline); the other fields may be stale. */
  error: string;
  notes: string[];
  releaseUrl: string;
  /** RFC 3339, or ''. */
  published: string;
  package: DesktopUpdatePackage | null;
  canInstall: boolean;
  installHint: string;
}

export type DesktopInstallResult =
  { status: 'installed'; version: string } | { status: 'cancelled' };

/** An app backend request that got an error response; `status` is the HTTP status. */
export class DesktopRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DesktopRequestError';
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const normalizeUpdateInfo = (input: unknown): DesktopUpdateInfo => {
  const record = isRecord(input) ? input : {};
  const pkg = isRecord(record.package) ? record.package : null;
  const size = pkg ? Number(pkg.size) : 0;
  return {
    current: readString(record.current),
    latest: readString(record.latest),
    available: record.available === true,
    devBuild: record['dev-build'] === true,
    checkedAt: readString(record['checked-at']),
    error: readString(record.error),
    notes: Array.isArray(record.notes)
      ? record.notes.map(readString).filter((note) => note !== '')
      : [],
    releaseUrl: readString(record['release-url']),
    published: readString(record.published),
    package: pkg
      ? {
          name: readString(pkg.name),
          format: readString(pkg.format),
          arch: readString(pkg.arch),
          size: Number.isFinite(size) && size > 0 ? size : 0,
        }
      : null,
    canInstall: record['can-install'] === true,
    installHint: readString(record['install-hint']),
  };
};

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
    autostart: record.autostart === true,
  };
};

const readCount = (value: unknown): number => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

export const normalizeDiagnostics = (input: unknown): DesktopDiagnostics => {
  const record = isRecord(input) ? input : {};
  const unit = isRecord(record.unit) ? record.unit : {};
  const log = isRecord(record.log) ? record.log : {};
  const listen = isRecord(record.listen) ? record.listen : {};
  const hints = Array.isArray(record.hints) ? record.hints : [];
  return {
    available: record.available === true,
    error: readString(record.error),
    unit: {
      activeState: readString(unit['active-state']),
      subState: readString(unit['sub-state']),
      result: readString(unit.result),
      exitCode: readString(unit['exit-code']),
      exitStatus: readCount(unit['exit-status']),
      restarts: readCount(unit.restarts),
      changedAt: readString(unit['changed-at']),
    },
    log: {
      available: log.available === true,
      error: readString(log.error),
      // Lines keep their leading spaces: continuation lines are indented.
      lines: Array.isArray(log.lines)
        ? log.lines.filter((line): line is string => typeof line === 'string')
        : [],
      truncated: log.truncated === true,
    },
    hints: hints.filter(isRecord).flatMap((hint) => {
      const code = readString(hint.code);
      return code
        ? [{ code, detail: readString(hint.detail), configLine: readCount(hint['config-line']) }]
        : [];
    }),
    host: readString(listen.host),
    port: readCount(listen.port),
    reachable: record.reachable === true,
  };
};

async function requestJSON(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' ? body.error : '';
    throw new DesktopRequestError(
      message || `Request failed (${response.status})`,
      response.status
    );
  }
  return body;
}

export const desktopApi = {
  async status(): Promise<DesktopStatus> {
    return normalizeDesktopStatus(await requestJSON('/app/status'));
  },

  /** Asks the app to save a file; resolves to the saved path, or '' when cancelled. */
  async save(filename: string, blob: Blob): Promise<string> {
    const body = await requestJSON(`/app/save?name=${encodeURIComponent(filename)}`, {
      method: 'POST',
      body: blob,
    });
    return isRecord(body) && typeof body.path === 'string' ? body.path : '';
  },

  /** Changes what runs at login; omitted fields stay as they are. */
  async setStartup(changes: {
    serviceAtLogin?: boolean;
    appAtLogin?: boolean;
  }): Promise<DesktopStatus> {
    const body: Record<string, boolean> = {};
    if (changes.serviceAtLogin !== undefined) body['service-at-login'] = changes.serviceAtLogin;
    if (changes.appAtLogin !== undefined) body['app-at-login'] = changes.appAtLogin;
    return normalizeDesktopStatus(
      await requestJSON('/app/startup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
  },

  async service(action: DesktopServiceAction): Promise<DesktopStatus> {
    return normalizeDesktopStatus(await requestJSON(`/app/service/${action}`, { method: 'POST' }));
  },

  /** Explains why the service is down: unit state, likely causes, and the redacted log tail. */
  async diagnostics(): Promise<DesktopDiagnostics> {
    return normalizeDiagnostics(await requestJSON('/app/diagnostics'));
  },

  /** Asks the app for the latest release; `force` skips the app's one-hour cache. */
  async checkUpdate(force = false): Promise<DesktopUpdateInfo> {
    return normalizeUpdateInfo(await requestJSON(force ? '/app/update?force=1' : '/app/update'));
  },

  /**
   * Downloads, verifies, and installs the update. The system shows its own password
   * prompt, so this can take minutes. Cancelling that prompt resolves to `cancelled`;
   * other failures throw a DesktopRequestError.
   */
  async installUpdate(): Promise<DesktopInstallResult> {
    try {
      const body = await requestJSON('/app/update/install', { method: 'POST' });
      return { status: 'installed', version: isRecord(body) ? readString(body.version) : '' };
    } catch (err) {
      if (err instanceof DesktopRequestError && err.status === 403) return { status: 'cancelled' };
      throw err;
    }
  },

  /** Quits the app and opens it again; resolves once the app has accepted. */
  async relaunch(): Promise<void> {
    await requestJSON('/app/update/relaunch', { method: 'POST' });
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
