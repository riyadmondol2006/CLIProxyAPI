import { describe, expect, test } from 'bun:test';
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
import { desktopApi, normalizeDiagnostics, type DesktopDiagnostics } from '@/utils/desktop';
import {
  describeHints,
  diagnosticsSummary,
  formatEventTime,
  SERVICE_LOG_COMMAND,
  signalName,
} from '@/features/desktop/diagnosticsLogic';
import {
  ServiceDiagnosticsView,
  type ServiceDiagnosticsViewProps,
} from '@/features/desktop/ServiceDiagnostics';

const SAMPLE = {
  available: true,
  unit: {
    'active-state': 'failed',
    'sub-state': 'failed',
    result: 'exit-code',
    'exit-code': 'exited',
    'exit-status': 1,
    restarts: 5,
    'changed-at': '2026-10-29T08:02:11Z',
  },
  log: {
    available: true,
    lines: [
      '2026-10-29T14:02:10+06:00 host systemd[1404]: Started cliproxyapi.service - CLIProxyAPI AI gateway.',
      '2026-10-29T14:02:11+06:00 host cli-proxy-api[5120]:   line 5: cannot unmarshal',
    ],
    truncated: false,
  },
  hints: [
    { code: 'port_in_use', detail: '127.0.0.1:8317' },
    {
      code: 'config_invalid',
      detail: 'yaml: line 12: did not find expected key',
      'config-line': 12,
    },
  ],
  listen: { host: '127.0.0.1', port: 8317 },
  reachable: false,
};

const diagnostics = (overrides: Partial<DesktopDiagnostics> = {}): DesktopDiagnostics => ({
  ...normalizeDiagnostics(SAMPLE),
  ...overrides,
});

const unit = (overrides: Partial<DesktopDiagnostics['unit']>) =>
  diagnostics({ unit: { ...normalizeDiagnostics(SAMPLE).unit, ...overrides } });

describe('diagnostics normalizer', () => {
  test('reads the backend contract', () => {
    expect(normalizeDiagnostics(SAMPLE)).toEqual({
      available: true,
      error: '',
      unit: {
        activeState: 'failed',
        subState: 'failed',
        result: 'exit-code',
        exitCode: 'exited',
        exitStatus: 1,
        restarts: 5,
        changedAt: '2026-10-29T08:02:11Z',
      },
      log: { available: true, error: '', lines: SAMPLE.log.lines, truncated: false },
      hints: [
        { code: 'port_in_use', detail: '127.0.0.1:8317', configLine: 0 },
        {
          code: 'config_invalid',
          detail: 'yaml: line 12: did not find expected key',
          configLine: 12,
        },
      ],
      host: '127.0.0.1',
      port: 8317,
      reachable: false,
    });
  });

  test('tolerates missing and malformed fields', () => {
    const empty = normalizeDiagnostics(null);
    expect(empty.available).toBe(false);
    expect(empty.unit).toEqual({
      activeState: '',
      subState: '',
      result: '',
      exitCode: '',
      exitStatus: 0,
      restarts: 0,
      changedAt: '',
    });
    expect(empty.log).toEqual({ available: false, error: '', lines: [], truncated: false });
    expect(empty.hints).toEqual([]);

    const odd = normalizeDiagnostics({
      available: 'yes',
      error: ' systemctl show: Failed to connect to bus ',
      unit: { restarts: -2, 'exit-status': 'x' },
      log: { available: true, lines: ['  indented', 3, null], truncated: 'no' },
      hints: [{ code: '' }, 'port_in_use', { code: 'crash_loop', 'config-line': -1 }],
      listen: 'nope',
    });
    expect(odd.available).toBe(false);
    expect(odd.error).toBe('systemctl show: Failed to connect to bus');
    expect(odd.unit.restarts).toBe(0);
    expect(odd.unit.exitStatus).toBe(0);
    // Continuation lines keep their indentation.
    expect(odd.log.lines).toEqual(['  indented']);
    expect(odd.log.truncated).toBe(false);
    expect(odd.hints).toEqual([{ code: 'crash_loop', detail: '', configLine: 0 }]);
    expect(odd.port).toBe(0);
  });

  test('asks the app backend', async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify(SAMPLE), { status: 200 });
    }) as typeof fetch;
    try {
      expect((await desktopApi.diagnostics()).unit.restarts).toBe(5);
      expect(urls).toEqual(['/app/diagnostics']);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('diagnostics summary', () => {
  const changedMs = Date.parse('2026-10-29T08:02:11Z');
  const shortTime = new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(changedMs);

  test('describes an exit with its time and restarts', () => {
    expect(diagnosticsSummary(diagnostics(), changedMs, 'en')).toEqual([
      { key: 'exited_at', values: { status: 1, time: shortTime } },
      { key: 'restarts', values: { count: 5 } },
    ]);
  });

  test('covers signals, clean exits, running, and never-run services', () => {
    const at = (key: string, values: Record<string, string | number> = {}) => ({
      key,
      values: { ...values, time: shortTime },
    });
    const summary = (overrides: Partial<DesktopDiagnostics['unit']>) =>
      diagnosticsSummary(unit({ restarts: 0, ...overrides }), changedMs, 'en');
    expect(summary({ exitCode: 'killed', exitStatus: 9 })).toEqual([
      at('killed_at', { signal: 'SIGKILL' }),
    ]);
    expect(summary({ exitCode: 'dumped', exitStatus: 11 })).toEqual([
      at('dumped_at', { signal: 'SIGSEGV' }),
    ]);
    expect(summary({ exitStatus: 0, activeState: 'inactive' })).toEqual([at('exited_ok_at')]);
    expect(summary({ activeState: 'active', exitCode: '' })).toEqual([at('running_at')]);
    const stoppedClean = unit({
      activeState: 'inactive',
      exitCode: '',
      changedAt: '',
      restarts: 0,
    });
    expect(
      diagnosticsSummary(
        { ...stoppedClean, log: { ...stoppedClean.log, lines: [] } },
        changedMs,
        'en'
      )
    ).toEqual([{ key: 'not_run', values: {} }]);
    // systemd drops the exit details of a cleanly stopped unit; the journal still shows the run.
    expect(diagnosticsSummary(stoppedClean, changedMs, 'en')).toEqual([]);
    expect(summary({ changedAt: '' })).toEqual([{ key: 'exited', values: { status: 1 } }]);
    expect(diagnosticsSummary(diagnostics({ available: false }), changedMs, 'en')).toEqual([]);
    expect(signalName(31)).toBe('31');
  });

  test('adds the date when the event was on another day', () => {
    const later = changedMs + 3 * 24 * 60 * 60 * 1000;
    expect(formatEventTime('2026-10-29T08:02:11Z', later, 'en')).toContain('2026');
    expect(formatEventTime('2026-10-29T08:02:11Z', changedMs, 'en')).toBe(shortTime);
    expect(formatEventTime('', changedMs, 'en')).toBe('');
    expect(formatEventTime('soon', changedMs, 'en')).toBe('');
    // A malformed locale falls back instead of throwing.
    expect(formatEventTime('2026-10-29T08:02:11Z', changedMs, 'not a locale!')).not.toBe('');
  });
});

describe('diagnostics hints', () => {
  test('maps codes to translation keys and values', () => {
    expect(describeHints(diagnostics())).toEqual([
      {
        code: 'port_in_use',
        titleKey: 'desktop.diagnostics.hints.port_in_use.title',
        fixKey: 'desktop.diagnostics.hints.port_in_use.fix',
        values: { port: 8317 },
        detail: '',
      },
      {
        code: 'config_invalid',
        titleKey: 'desktop.diagnostics.hints.config_invalid.title',
        fixKey: 'desktop.diagnostics.hints.config_invalid.fix_line',
        values: { line: 12 },
        detail: 'yaml: line 12: did not find expected key',
      },
    ]);
  });

  test('fills in values and skips codes it does not know', () => {
    const views = describeHints(
      diagnostics({
        port: 9000,
        hints: [
          { code: 'port_in_use', detail: '[::]:8400', configLine: 0 },
          { code: 'address_unavailable', detail: '', configLine: 0 },
          { code: 'config_invalid', detail: 'unknown v8 configuration section foo', configLine: 0 },
          { code: 'brand_new_code', detail: 'x', configLine: 0 },
          { code: 'crash_loop', detail: 'ignored', configLine: 0 },
          { code: 'permission_denied', detail: '/home/u/.config/cliproxyapi', configLine: 0 },
        ],
      })
    );
    expect(views.map((view) => view.code)).toEqual([
      'port_in_use',
      'address_unavailable',
      'config_invalid',
      'crash_loop',
      'permission_denied',
    ]);
    expect(views[0].values).toEqual({ port: 8400 });
    expect(views[1].values).toEqual({ address: '127.0.0.1:9000' });
    expect(views[2].fixKey).toBe('desktop.diagnostics.hints.config_invalid.fix');
    expect(views[3].detail).toBe('');
    expect(views[4].detail).toBe('/home/u/.config/cliproxyapi');
    expect(
      describeHints(diagnostics({ hints: [{ code: 'port_in_use', detail: '', configLine: 0 }] }))[0]
        .values
    ).toEqual({ port: 8317 });
  });
});

describe('diagnostics view', () => {
  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;
  const props = (
    overrides: Partial<ServiceDiagnosticsViewProps> = {}
  ): ServiceDiagnosticsViewProps => ({
    diagnostics: diagnostics(),
    loading: false,
    error: '',
    now: Date.parse('2026-10-29T08:02:11Z'),
    onRefresh: () => undefined,
    ...overrides,
  });

  async function render(lng: string, translation: object, viewProps: ServiceDiagnosticsViewProps) {
    const i18n = createInstance();
    await i18n.init({
      lng,
      resources: { [lng]: { translation } },
      interpolation: { escapeValue: false },
    });
    const markup = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(ServiceDiagnosticsView, viewProps))
    );
    return { i18n, markup };
  }

  for (const [lng, translation] of Object.entries(locales)) {
    test(`renders summary, hints, and log without raw keys (${lng})`, async () => {
      const { i18n, markup } = await render(lng, translation, props());
      expect(markup).toContain(
        i18n.t('desktop.diagnostics.hints.port_in_use.title', { port: 8317 })
      );
      expect(markup).toContain(i18n.t('desktop.diagnostics.summary.restarts', { count: 5 }));
      expect(markup).toContain(i18n.t('desktop.diagnostics.copy_log'));
      expect(markup).toContain('cannot unmarshal');
      expect(markup).not.toMatch(/desktop\.diagnostics\.[a-z_.]+/);
    });
  }

  test('reads naturally in English', async () => {
    const { markup } = await render('en', en, props());
    expect(markup).toContain('Exited with status 1 at ');
    expect(markup).toContain(' · restarted 5 times');
    expect(markup).toContain('Open the config file, fix line 12 (see below)');
    expect(markup).toContain('<details');
  });

  test('falls back to the terminal command when the log is unavailable', async () => {
    const noLog = diagnostics({
      available: false,
      hints: [],
      log: { available: false, error: 'journalctl: not found', lines: [], truncated: false },
    });
    const { markup } = await render('en', en, props({ diagnostics: noLog }));
    expect(markup).toContain('Service details aren&#x27;t available on this system.');
    expect(markup).toContain(SERVICE_LOG_COMMAND);
    expect(markup).not.toContain('<details');

    const failed = await render(
      'en',
      en,
      props({ diagnostics: null, error: 'Request failed (404)' })
    );
    expect(failed.markup).toContain('Couldn&#x27;t load the service details.');
    expect(failed.markup).toContain(SERVICE_LOG_COMMAND);

    const loading = await render('en', en, props({ diagnostics: null, loading: true }));
    expect(loading.markup).toContain('Checking what happened…');
    expect(loading.markup).not.toContain(SERVICE_LOG_COMMAND);
  });
});
