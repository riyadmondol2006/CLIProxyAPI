import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import ko from '@/i18n/locales/ko.json';
import vi from '@/i18n/locales/vi.json';
import {
  DesktopRequestError,
  desktopApi,
  normalizeUpdateInfo,
  type DesktopUpdateInfo,
} from '@/utils/desktop';
import {
  describeCheckedAt,
  formatPackageSize,
  formatReleaseDate,
  shouldAutoCheck,
  shouldShowUpdatePopup,
  UPDATE_AUTO_CHECK_KEY,
  UPDATE_SKIPPED_KEY,
  visibleNotes,
} from '@/features/desktop/updateLogic';
import { useUpdates, type UpdateInstallState } from '@/features/desktop/useUpdates';
import { UpdatePopupView, type UpdatePopupViewProps } from '@/features/desktop/UpdatePopup';
import { UpdatesSectionView, type UpdatesSectionViewProps } from '@/features/home/UpdatesSection';

const SAMPLE = {
  current: '0.20261030.8',
  latest: '0.20261030.9',
  available: true,
  'dev-build': false,
  'checked-at': '2026-10-30T11:55:00Z',
  error: '',
  notes: ['feat(desktop): add an update popup', 'fix(desktop): keep the window size'],
  'release-url': 'https://github.com/router-for-me/CLIProxyAPI/releases/tag/latest-build',
  published: '2026-10-30T09:00:00Z',
  package: {
    name: 'cliproxyapi-0.20261030.9-1.x86_64.rpm',
    format: 'rpm',
    arch: 'amd64',
    size: 31469905,
  },
  'can-install': true,
  'install-hint': 'sudo dnf install ./cliproxyapi-0.20261030.9-1.x86_64.rpm',
};

const info = (overrides: Partial<DesktopUpdateInfo> = {}): DesktopUpdateInfo => ({
  ...normalizeUpdateInfo(SAMPLE),
  ...overrides,
});

type FetchCall = { url: string; method: string };

function stubFetch(handler: (url: string) => { status: number; body?: unknown }) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    const { status, body } = handler(url);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

function stubLocalStorage() {
  const items = new Map<string, string>();
  const globals = globalThis as unknown as { localStorage?: unknown };
  const previous = globals.localStorage;
  globals.localStorage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
  return { items, restore: () => (globals.localStorage = previous) };
}

describe('update info normalizer', () => {
  test('reads the backend contract', () => {
    expect(normalizeUpdateInfo(SAMPLE)).toEqual({
      current: '0.20261030.8',
      latest: '0.20261030.9',
      available: true,
      devBuild: false,
      checkedAt: '2026-10-30T11:55:00Z',
      error: '',
      notes: ['feat(desktop): add an update popup', 'fix(desktop): keep the window size'],
      releaseUrl: 'https://github.com/router-for-me/CLIProxyAPI/releases/tag/latest-build',
      published: '2026-10-30T09:00:00Z',
      package: {
        name: 'cliproxyapi-0.20261030.9-1.x86_64.rpm',
        format: 'rpm',
        arch: 'amd64',
        size: 31469905,
      },
      canInstall: true,
      installHint: 'sudo dnf install ./cliproxyapi-0.20261030.9-1.x86_64.rpm',
    });
  });

  test('tolerates missing and malformed fields', () => {
    expect(normalizeUpdateInfo(null)).toEqual({
      current: '',
      latest: '',
      available: false,
      devBuild: false,
      checkedAt: '',
      error: '',
      notes: [],
      releaseUrl: '',
      published: '',
      package: null,
      canInstall: false,
      installHint: '',
    });
    const odd = normalizeUpdateInfo({
      current: 8,
      available: 'yes',
      'dev-build': true,
      error: ' offline ',
      notes: ['  first ', '', 3, null, 'second'],
      package: { name: 'x.deb', size: -5 },
      'can-install': 1,
    });
    expect(odd.current).toBe('');
    expect(odd.available).toBe(false);
    expect(odd.devBuild).toBe(true);
    expect(odd.error).toBe('offline');
    expect(odd.notes).toEqual(['first', 'second']);
    expect(odd.package).toEqual({ name: 'x.deb', format: '', arch: '', size: 0 });
    expect(odd.canInstall).toBe(false);
    expect(normalizeUpdateInfo({ package: 'x', notes: 'y' })).toMatchObject({
      package: null,
      notes: [],
    });
  });
});

describe('update API', () => {
  test('checks with and without the cache', async () => {
    const fetchStub = stubFetch(() => ({ status: 200, body: SAMPLE }));
    try {
      expect((await desktopApi.checkUpdate()).latest).toBe('0.20261030.9');
      await desktopApi.checkUpdate(true);
      expect(fetchStub.calls).toEqual([
        { url: '/app/update', method: 'GET' },
        { url: '/app/update?force=1', method: 'GET' },
      ]);
    } finally {
      fetchStub.restore();
    }
  });

  test('maps install responses', async () => {
    let next: { status: number; body?: unknown } = {
      status: 200,
      body: { status: 'installed', version: '0.20261030.9' },
    };
    const fetchStub = stubFetch(() => next);
    try {
      expect(await desktopApi.installUpdate()).toEqual({
        status: 'installed',
        version: '0.20261030.9',
      });
      next = { status: 403, body: { error: 'cancelled' } };
      expect(await desktopApi.installUpdate()).toEqual({ status: 'cancelled' });
      next = { status: 409, body: { error: 'an update is already being installed' } };
      const error = await desktopApi.installUpdate().catch((err: unknown) => err);
      expect(error).toBeInstanceOf(DesktopRequestError);
      expect((error as DesktopRequestError).status).toBe(409);
      expect((error as Error).message).toBe('an update is already being installed');
      expect(fetchStub.calls.every((call) => call.method === 'POST')).toBe(true);
      expect(fetchStub.calls[0].url).toBe('/app/update/install');
    } finally {
      fetchStub.restore();
    }
  });

  test('relaunch accepts an empty 202 and reports 503', async () => {
    let status = 202;
    const fetchStub = stubFetch(() =>
      status === 202 ? { status } : { status, body: { error: 'relaunch is not supported' } }
    );
    try {
      await desktopApi.relaunch();
      status = 503;
      await expect(desktopApi.relaunch()).rejects.toThrow('relaunch is not supported');
      expect(fetchStub.calls[0]).toEqual({ url: '/app/update/relaunch', method: 'POST' });
    } finally {
      fetchStub.restore();
    }
  });
});

describe('when to check and when to show', () => {
  test('scheduled checks need auto-check and stop for dev builds', () => {
    expect(shouldAutoCheck(true, null)).toBe(true);
    expect(shouldAutoCheck(true, info())).toBe(true);
    expect(shouldAutoCheck(false, null)).toBe(false);
    expect(shouldAutoCheck(true, info({ devBuild: true }))).toBe(false);
  });

  test('shows a found update unless skipped, off, silent, or a dev build', () => {
    const base = { info: info(), kind: 'auto' as const, autoCheck: true, skipped: '' };
    expect(shouldShowUpdatePopup(base)).toBe(true);
    expect(shouldShowUpdatePopup({ ...base, info: null })).toBe(false);
    expect(shouldShowUpdatePopup({ ...base, info: info({ available: false }) })).toBe(false);
    expect(shouldShowUpdatePopup({ ...base, info: info({ latest: '' }) })).toBe(false);
    expect(shouldShowUpdatePopup({ ...base, info: info({ devBuild: true }) })).toBe(false);
    expect(shouldShowUpdatePopup({ ...base, skipped: '0.20261030.9' })).toBe(false);
    // A skipped version only hides that version.
    expect(shouldShowUpdatePopup({ ...base, skipped: '0.20261030.7' })).toBe(true);
    expect(shouldShowUpdatePopup({ ...base, autoCheck: false })).toBe(false);
    expect(shouldShowUpdatePopup({ ...base, kind: 'silent' })).toBe(false);
  });

  test('a manual check shows the update even when skipped or auto-check is off', () => {
    const manual = { info: info(), kind: 'manual' as const, autoCheck: false };
    expect(shouldShowUpdatePopup({ ...manual, skipped: '0.20261030.9' })).toBe(true);
    expect(shouldShowUpdatePopup({ ...manual, skipped: '' })).toBe(true);
    expect(shouldShowUpdatePopup({ ...manual, skipped: '', info: info({ devBuild: true }) })).toBe(
      false
    );
  });
});

describe('update formatting', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');

  test('formats size, date, and notes', () => {
    expect(formatPackageSize(31469905, 'en')).toBe('30.0');
    expect(formatPackageSize(31469905, 'ru')).toBe('30,0');
    expect(formatPackageSize(0, 'en')).toBe('');
    expect(formatReleaseDate('2026-10-30T12:00:00Z', 'en')).toContain('2026');
    expect(formatReleaseDate('', 'en')).toBe('');
    expect(formatReleaseDate('not a date', 'en')).toBe('');
    const many = Array.from({ length: 14 }, (_, index) => `change ${index}`);
    expect(visibleNotes(many).shown).toHaveLength(10);
    expect(visibleNotes(many).more).toBe(true);
    expect(visibleNotes(many.slice(0, 10)).more).toBe(false);
  });

  test('describes when the last check ran', () => {
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(describeCheckedAt('', now, 'en')).toBeNull();
    expect(describeCheckedAt(ago(20_000), now, 'en')).toEqual({ justNow: true });
    expect(describeCheckedAt(ago(5 * 60_000), now, 'en')).toEqual({
      justNow: false,
      text: '5 minutes ago',
    });
    expect(describeCheckedAt(ago(3 * 3600_000 + 60_000), now, 'en')).toEqual({
      justNow: false,
      text: '3 hours ago',
    });
    const old = describeCheckedAt(ago(3 * 86400_000), now, 'en');
    expect(old?.justNow).toBe(false);
    expect(old && !old.justNow ? old.text : '').toContain('2026');
  });
});

describe('shared update state', () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  let storage: ReturnType<typeof stubLocalStorage>;
  let installStatus = 200;
  let response: unknown = SAMPLE;

  beforeEach(() => {
    storage = stubLocalStorage();
    installStatus = 200;
    response = SAMPLE;
    fetchStub = stubFetch((url) => {
      if (url.startsWith('/app/update/install')) {
        return installStatus === 200
          ? { status: 200, body: { status: 'installed', version: '0.20261030.9' } }
          : {
              status: installStatus,
              body: { error: installStatus === 403 ? 'cancelled' : 'boom' },
            };
      }
      return { status: 200, body: response };
    });
    useUpdates.setState({
      info: null,
      checking: false,
      checkError: null,
      visible: false,
      install: { phase: 'idle' },
      relaunching: false,
      relaunchError: null,
      autoCheck: true,
    });
  });

  afterEach(() => {
    fetchStub.restore();
    storage.restore();
  });

  test('scheduled checks open the popup; skipping hides that version', async () => {
    await useUpdates.getState().check('silent');
    expect(useUpdates.getState().info?.latest).toBe('0.20261030.9');
    expect(useUpdates.getState().visible).toBe(false);

    await useUpdates.getState().check('auto');
    expect(useUpdates.getState().visible).toBe(true);

    useUpdates.getState().skip();
    expect(storage.items.get(UPDATE_SKIPPED_KEY)).toBe('0.20261030.9');
    expect(useUpdates.getState().visible).toBe(false);

    await useUpdates.getState().check('auto');
    expect(useUpdates.getState().visible).toBe(false);

    await useUpdates.getState().check('manual');
    expect(useUpdates.getState().visible).toBe(true);
    expect(fetchStub.calls.at(-1)?.url).toBe('/app/update?force=1');
  });

  test('install outcomes', async () => {
    await useUpdates.getState().check('auto');
    installStatus = 403;
    await useUpdates.getState().installUpdate();
    expect(useUpdates.getState().install).toEqual({ phase: 'cancelled' });
    useUpdates.getState().close();
    expect(useUpdates.getState().install).toEqual({ phase: 'idle' });

    installStatus = 500;
    await useUpdates.getState().installUpdate();
    expect(useUpdates.getState().install).toEqual({ phase: 'error', message: 'boom' });

    installStatus = 200;
    await useUpdates.getState().installUpdate();
    expect(useUpdates.getState().install).toEqual({
      phase: 'installed',
      version: '0.20261030.9',
    });
    useUpdates.getState().close();
    expect(useUpdates.getState().install.phase).toBe('installed');
  });

  test('the auto-check setting persists and a failed request is reported', async () => {
    useUpdates.getState().setAutoCheck(false);
    expect(storage.items.get(UPDATE_AUTO_CHECK_KEY)).toBe('false');
    await useUpdates.getState().check('auto');
    expect(useUpdates.getState().visible).toBe(false);

    fetchStub.restore();
    fetchStub = stubFetch(() => ({ status: 502, body: { error: 'app backend unavailable' } }));
    await useUpdates.getState().check('manual');
    expect(useUpdates.getState().checkError).toBe('app backend unavailable');
    expect(useUpdates.getState().checking).toBe(false);
  });
});

const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;

async function i18nFor(lng: string, translation: object) {
  const i18n = createInstance();
  await i18n.init({
    lng,
    resources: { [lng]: { translation } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

const noop = () => undefined;

const popupProps = (overrides: Partial<UpdatePopupViewProps> = {}): UpdatePopupViewProps => ({
  open: true,
  info: info(),
  install: { phase: 'idle' },
  relaunching: false,
  relaunchError: null,
  onInstall: noop,
  onLater: noop,
  onSkip: noop,
  onRelaunch: noop,
  onOpenRelease: noop,
  ...overrides,
});

const sectionProps = (
  overrides: Partial<UpdatesSectionViewProps> = {}
): UpdatesSectionViewProps => ({
  info: info(),
  appVersion: '0.20261030.8',
  checking: false,
  checkError: null,
  install: { phase: 'idle' },
  relaunching: false,
  autoCheck: true,
  now: Date.parse('2026-10-30T12:00:00Z'),
  onCheck: noop,
  onOpen: noop,
  onRelaunch: noop,
  onAutoCheckChange: noop,
  ...overrides,
});

const RAW_KEY = /updates\.[a-z_]+/;

/** Static markup escapes quotes and apostrophes; undo that so translations compare as text. */
const decode = (markup: string) =>
  markup
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

describe('update popup rendering', () => {
  for (const [lng, translation] of Object.entries(locales)) {
    test(`renders every state without raw keys (${lng})`, async () => {
      const i18n = await i18nFor(lng, translation);
      const render = (props: UpdatePopupViewProps) =>
        decode(
          renderToStaticMarkup(
            createElement(I18nextProvider, { i18n }, createElement(UpdatePopupView, props))
          )
        );

      const normal = render(popupProps());
      expect(normal).toContain(i18n.t('updates.title'));
      expect(normal).toContain('0.20261030.8');
      expect(normal).toContain('0.20261030.9');
      expect(normal).toContain('feat(desktop): add an update popup');
      expect(normal).toContain(i18n.t('updates.install'));
      expect(normal).toContain(i18n.t('updates.later'));
      expect(normal).toContain(i18n.t('updates.skip'));
      expect(normal).toContain(i18n.t('updates.release_notes'));
      expect(normal).toContain(i18n.t('updates.size', { size: formatPackageSize(31469905, lng) }));
      expect(normal).not.toContain(i18n.t('updates.manual_title'));

      const states: UpdateInstallState[] = [
        { phase: 'installing' },
        { phase: 'installed', version: '0.20261030.9' },
        { phase: 'cancelled' },
        { phase: 'error', message: 'checksum mismatch' },
        { phase: 'error', message: '' },
      ];
      const markups = states.map((install) => render(popupProps({ install })));
      expect(markups[0]).toContain(i18n.t('updates.installing'));
      expect(markups[1]).toContain(i18n.t('updates.installed', { version: '0.20261030.9' }));
      expect(markups[1]).toContain(i18n.t('updates.restart'));
      expect(markups[1]).not.toContain(`>${i18n.t('updates.install')}<`);
      expect(markups[2]).toContain(i18n.t('updates.cancelled'));
      expect(markups[2]).not.toContain(i18n.t('updates.manual_title'));
      expect(markups[3]).toContain('checksum mismatch');
      expect(markups[3]).toContain(i18n.t('updates.manual_title'));
      expect(markups[3]).toContain(SAMPLE['install-hint']);
      expect(markups[3]).toContain(i18n.t('updates.download'));
      expect(markups[4]).toContain(i18n.t('updates.unknown_error'));

      const manual = render(popupProps({ info: info({ canInstall: false }) }));
      expect(manual).toContain(i18n.t('updates.manual_title'));
      expect(manual).toContain(i18n.t('updates.copy_command'));
      expect(manual).not.toContain(`>${i18n.t('updates.install')}<`);

      const noHint = render(popupProps({ info: info({ canInstall: false, installHint: '' }) }));
      expect(noHint).toContain(i18n.t('updates.manual_text_no_hint'));

      const failedRestart = render(
        popupProps({
          install: { phase: 'installed', version: '0.20261030.9' },
          relaunchError: 'relaunch is not supported',
        })
      );
      expect(failedRestart).toContain('relaunch is not supported');

      for (const markup of [normal, ...markups, manual, noHint, failedRestart]) {
        expect(markup).not.toMatch(RAW_KEY);
      }
    });
  }

  test('lists at most ten notes', async () => {
    const i18n = await i18nFor('en', en);
    const notes = Array.from({ length: 12 }, (_, index) => `change number ${index + 1}`);
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(UpdatePopupView, popupProps({ info: info({ notes }) }))
      )
    );
    expect(markup.match(/<li>/g)).toHaveLength(10);
    expect(markup).toContain('change number 10');
    expect(markup).not.toContain('change number 11');
    expect(markup).toContain(i18n.t('updates.more_notes'));
  });
});

describe('home updates section rendering', () => {
  for (const [lng, translation] of Object.entries(locales)) {
    test(`renders every status without raw keys (${lng})`, async () => {
      const i18n = await i18nFor(lng, translation);
      const render = (props: UpdatesSectionViewProps) =>
        decode(
          renderToStaticMarkup(
            createElement(I18nextProvider, { i18n }, createElement(UpdatesSectionView, props))
          )
        );

      const available = render(sectionProps());
      expect(available).toContain(i18n.t('updates.home.title'));
      expect(available).toContain(i18n.t('updates.home.version', { version: '0.20261030.8' }));
      expect(available).toContain(i18n.t('updates.home.available', { version: '0.20261030.9' }));
      expect(available).toContain(i18n.t('updates.home.view'));
      expect(available).toContain(i18n.t('updates.home.check_now'));
      expect(available).toContain(i18n.t('updates.home.auto'));

      const upToDate = render(sectionProps({ info: info({ available: false }) }));
      expect(upToDate).toContain(i18n.t('updates.home.up_to_date'));
      expect(upToDate).not.toContain(i18n.t('updates.home.view'));
      expect(upToDate).toContain(
        i18n.t('updates.home.last_checked', {
          time: new Intl.RelativeTimeFormat(lng, { numeric: 'always' }).format(-5, 'minute'),
        })
      );

      const justNow = render(
        sectionProps({ info: info({ available: false, checkedAt: '2026-10-30T11:59:40Z' }) })
      );
      expect(justNow).toContain(i18n.t('updates.home.checked_just_now'));

      const dev = render(sectionProps({ info: info({ devBuild: true, available: false }) }));
      expect(dev).toContain(i18n.t('updates.home.dev_build'));
      expect(dev).not.toContain(i18n.t('updates.home.check_now'));

      const offline = render(sectionProps({ info: info({ available: false, error: 'offline' }) }));
      expect(offline).toContain(i18n.t('updates.home.check_failed', { error: 'offline' }));

      const failedRequest = render(sectionProps({ info: null, checkError: '' }));
      expect(failedRequest).toContain(
        i18n.t('updates.home.check_failed', { error: i18n.t('updates.unknown_error') })
      );

      const notChecked = render(sectionProps({ info: null, autoCheck: false }));
      expect(notChecked).toContain(i18n.t('updates.home.not_checked'));
      expect(notChecked).toContain(i18n.t('updates.home.version', { version: '0.20261030.8' }));

      const checking = render(sectionProps({ info: null, checking: true }));
      expect(checking).toContain(i18n.t('updates.home.checking'));

      const installed = render(
        sectionProps({ install: { phase: 'installed', version: '0.20261030.9' } })
      );
      expect(installed).toContain(
        i18n.t('updates.home.restart_pending', { version: '0.20261030.9' })
      );
      expect(installed).toContain(i18n.t('updates.restart'));

      for (const markup of [
        available,
        upToDate,
        justNow,
        dev,
        offline,
        failedRequest,
        notChecked,
        checking,
        installed,
      ]) {
        expect(markup).not.toMatch(RAW_KEY);
      }
    });
  }
});

describe('update UI wiring', () => {
  const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

  test('the popup is mounted in the layout for the desktop app only', () => {
    expect(read('components/layout/MainLayout.tsx')).toContain(
      '{isDesktopApp() ? <UpdatePopup /> : null}'
    );
  });

  test('Home shows the Updates section right after Startup, in the desktop app only', () => {
    const home = read('features/home/HomePage.tsx');
    const startup = home.indexOf('id="home-startup"');
    const updates = home.indexOf('{desktop ? <UpdatesSection');
    const tiles = home.indexOf('Overview tiles');
    expect(startup).toBeGreaterThan(0);
    expect(updates).toBeGreaterThan(startup);
    expect(updates).toBeLessThan(tiles);
  });

  test('every locale has the same update keys', () => {
    const leaves = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, child]) =>
            leaves(child, prefix ? `${prefix}.${key}` : key)
          )
        : [prefix];
    const expected = leaves(en.updates).sort();
    expect(expected.length).toBeGreaterThan(30);
    for (const translation of Object.values(locales)) {
      expect(leaves(translation.updates).sort()).toEqual(expected);
    }
  });
});
