import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';
import ko from '@/i18n/locales/ko.json';
import vi from '@/i18n/locales/vi.json';
import { buildDataQuery, normalizeData, normalizeStatus } from '@/features/claudeUsage/api';
import {
  ClaudeUsagePage,
  ClaudeUsageView,
  type ClaudeUsageViewProps,
} from '@/features/claudeUsage/ClaudeUsagePage';
import {
  DEFAULT_RANGE,
  buildViewSearch,
  computeRange,
  durationParts,
  formatCost,
  formatTokens,
  niceMax,
  pageCount,
  pageSlice,
  parseLocalDay,
  parseModelList,
  parseRangeKey,
  projectName,
  shortModel,
  rangeIncludesToday,
  sortRows,
  toCsv,
  toggleModel,
} from '@/features/claudeUsage/logic';

/** Fixed local "now": Wednesday 2026-03-04, 15:30. */
const NOW = new Date(2026, 2, 4, 15, 30);

describe('claude usage ranges', () => {
  test('computes inclusive local from/to dates', () => {
    expect(computeRange('today', NOW)).toEqual({ from: '2026-03-04', to: '2026-03-04' });
    expect(computeRange('7d', NOW)).toEqual({ from: '2026-02-26', to: '2026-03-04' });
    expect(computeRange('30d', NOW)).toEqual({ from: '2026-02-03', to: '2026-03-04' });
    expect(computeRange('90d', NOW)).toEqual({ from: '2025-12-05', to: '2026-03-04' });
    expect(computeRange('all', NOW)).toEqual({});
  });

  test('handles this month and last month, including year and leap boundaries', () => {
    expect(computeRange('this_month', NOW)).toEqual({ from: '2026-03-01', to: '2026-03-04' });
    expect(computeRange('last_month', NOW)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    const january = new Date(2026, 0, 15, 9);
    expect(computeRange('last_month', january)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(computeRange('this_month', january)).toEqual({ from: '2026-01-01', to: '2026-01-15' });
    expect(computeRange('last_month', new Date(2028, 2, 31))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  test('uses the local day even late at night', () => {
    expect(computeRange('today', new Date(2026, 2, 4, 23, 59, 59))).toEqual({
      from: '2026-03-04',
      to: '2026-03-04',
    });
    expect(parseLocalDay('2026-03-04')?.getDate()).toBe(4);
    expect(parseLocalDay('nope')).toBeNull();
  });

  test('knows when a range can still grow', () => {
    expect(rangeIncludesToday(computeRange('30d', NOW), NOW)).toBe(true);
    expect(rangeIncludesToday(computeRange('all', NOW), NOW)).toBe(true);
    expect(rangeIncludesToday(computeRange('last_month', NOW), NOW)).toBe(false);
  });

  test('reads and writes the view in the URL query', () => {
    expect(parseRangeKey('7d')).toBe('7d');
    expect(parseRangeKey('bogus')).toBe(DEFAULT_RANGE);
    expect(parseRangeKey(null)).toBe('30d');
    expect(parseModelList(' a, b,,a ')).toEqual(['a', 'b']);
    expect(parseModelList(null)).toEqual([]);

    const next = buildViewSearch(new URLSearchParams('keep=1&range=7d'), {
      range: '90d',
      models: ['claude-opus-5-5', 'claude-haiku-5-5'],
    });
    expect(next.get('range')).toBe('90d');
    expect(next.get('models')).toBe('claude-opus-5-5,claude-haiku-5-5');
    expect(next.get('keep')).toBe('1');
    const reset = buildViewSearch(next, { range: '30d', models: [] });
    expect(reset.has('range')).toBe(false);
    expect(reset.has('models')).toBe(false);
  });

  test('toggles models and collapses a full selection back to all', () => {
    const all = ['a', 'b', 'c'];
    expect(toggleModel([], 'a', all)).toEqual(['a']);
    expect(toggleModel(['a'], 'a', all)).toEqual([]);
    expect(toggleModel(['a', 'b'], 'c', all)).toEqual([]);
    expect(toggleModel(['a'], 'b', all)).toEqual(['a', 'b']);
  });
});

describe('claude usage formatters', () => {
  test('formats tokens with K/M/B', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1.0K');
    expect(formatTokens(1234)).toBe('1.2K');
    expect(formatTokens(999_960)).toBe('1.00M');
    expect(formatTokens(3_456_789)).toBe('3.46M');
    expect(formatTokens(999_999_999)).toBe('1.00B');
    expect(formatTokens(1_234_567_890)).toBe('1.23B');
    expect(formatTokens(Number.NaN)).toBe('0');
  });

  test('formats costs in dollars', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0421)).toBe('$0.042');
    expect(formatCost(0.9999)).toBe('$1.00');
    expect(formatCost(1)).toBe('$1.00');
    expect(formatCost(12.345)).toBe('$12.35');
    expect(formatCost(1234.5)).toBe('$1,234.50');
    expect(formatCost(Number.POSITIVE_INFINITY)).toBe('$0.00');
  });

  test('splits durations and picks readable axis tops', () => {
    expect(durationParts(125)).toEqual({ hours: 2, minutes: 5 });
    expect(durationParts(-3)).toEqual({ hours: 0, minutes: 0 });
    expect(niceMax(0)).toBe(1);
    expect(niceMax(0, 4)).toBe(4);
    expect(niceMax(7)).toBe(8);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(230_000, 4)).toBe(240_000);
    expect(niceMax(18, 3)).toBe(18);
    expect(niceMax(24.9, 4)).toBe(32);
    expect(niceMax(0.07, 4)).toBe(0.08);
  });

  test('sorts, pages and names', () => {
    const rows = [{ n: 2 }, { n: 10 }, { n: 1 }];
    expect(sortRows(rows, (row) => row.n, 'desc').map((row) => row.n)).toEqual([10, 2, 1]);
    expect(sortRows(rows, (row) => String(row.n), 'asc').map((row) => row.n)).toEqual([1, 10, 2]);
    const many = Array.from({ length: 60 }, (_, index) => index);
    expect(pageCount(60, 25)).toBe(3);
    expect(pageCount(0, 25)).toBe(1);
    expect(pageSlice(many, 2, 25)).toEqual(many.slice(50));
    expect(pageSlice(many, 9, 25)).toEqual(many.slice(50));
    expect(projectName('/home/me/code/app')).toBe('app');
    expect(projectName('C:\\work\\api\\')).toBe('api');
    expect(shortModel('claude-opus-5-5')).toBe('opus-5-5');
    expect(shortModel('<synthetic>')).toBe('<synthetic>');
  });

  test('writes CSV that spreadsheets read as text', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x, y', 'say "hi"'],
          ['=SUM(A1)', 3],
        ]
      )
    ).toBe('a,b\r\n"x, y","say ""hi"""\r\n\'=SUM(A1),3\r\n');
  });
});

const RAW_DATA = {
  'generated-at': '2026-03-04T15:30:00Z',
  from: '2026-03-03',
  to: '2026-03-04',
  models: [
    { model: 'claude-opus-5-5', turns: 40, tokens: 900000, priced: true },
    { model: '<synthetic>', turns: 2, tokens: 0, priced: false },
  ],
  totals: {
    sessions: 3,
    turns: 42,
    input: 12000,
    output: 34000,
    'cache-read': 800000,
    'cache-write': 54000,
    'subagent-tokens': 120000,
    cost: 4.321,
  },
  daily: [
    {
      day: '2026-03-03',
      input: 5000,
      output: 14000,
      'cache-read': 300000,
      'cache-write': 20000,
      turns: 18,
      cost: 1.8,
    },
    {
      day: '2026-03-04',
      input: 7000,
      output: 20000,
      'cache-read': 500000,
      'cache-write': 34000,
      turns: 24,
      cost: 2.521,
    },
  ],
  hourly: [{ hour: 14, turns: 30, output: 20000, 'avg-turns': 15, 'avg-output': 10000 }],
  'by-model': [
    {
      model: 'claude-opus-5-5',
      turns: 40,
      input: 12000,
      output: 34000,
      'cache-read': 800000,
      'cache-write': 54000,
      cost: 4.321,
      priced: true,
    },
    { model: '<synthetic>', turns: 2, priced: false },
  ],
  projects: [
    {
      project: '/home/me/code/app',
      sessions: 3,
      turns: 42,
      input: 12000,
      output: 34000,
      cost: 4.321,
    },
  ],
  branches: [{ project: '/home/me/code/app', branch: 'main', sessions: 3, turns: 42, cost: 4.321 }],
  sessions: [
    {
      'session-id': 's1',
      project: '/home/me/code/app',
      branch: 'main',
      topic: '',
      first: '2026-03-04T13:00:00Z',
      last: '2026-03-04T14:05:00Z',
      'duration-min': 65,
      model: 'claude-opus-5-5',
      turns: 24,
      input: 7000,
      output: 20000,
      cost: 2.521,
    },
  ],
  'sessions-total': 3,
  subagents: [{ 'agent-type': 'Explore', dispatches: 2, turns: 6, cost: 0.4 }],
  dispatches: [
    {
      'agent-id': 'a1',
      'agent-type': 'Explore',
      model: 'claude-haiku-5-5',
      started: '2026-03-04T13:10:00Z',
      turns: 3,
      'tool-uses': 7,
      'duration-ms': 42000,
      status: 'completed',
      cost: 0.2,
    },
  ],
};

const RAW_STATUS = {
  scanning: false,
  'files-total': 12,
  'files-done': 12,
  'bytes-total': 2048,
  'bytes-done': 2048,
  'last-scan-at': '2026-03-04T15:29:00Z',
  'last-error': '',
  turns: 42,
  sessions: 3,
  sources: ['/home/me/.claude/projects'],
  'db-path': '/home/me/.local/share/cliproxyapi/claude-usage.db',
};

describe('claude usage normalizers', () => {
  test('reads the status response and tolerates missing fields', () => {
    const status = normalizeStatus(RAW_STATUS);
    expect(status.filesTotal).toBe(12);
    expect(status.lastScanAt).toBe('2026-03-04T15:29:00Z');
    expect(status.sources).toEqual(['/home/me/.claude/projects']);
    expect(normalizeStatus(null)).toEqual({
      scanning: false,
      filesTotal: 0,
      filesDone: 0,
      bytesTotal: 0,
      bytesDone: 0,
      lastScanAt: '',
      lastError: '',
      turns: 0,
      sessions: 0,
      sources: [],
      dbPath: '',
    });
    expect(normalizeStatus({ sources: ['ok', 3, ''], turns: 'x' })).toMatchObject({
      sources: ['ok'],
      turns: 0,
    });
  });

  test('reads the data response', () => {
    const data = normalizeData(RAW_DATA);
    expect(data.totals.cacheRead).toBe(800000);
    expect(data.totals.subagentTokens).toBe(120000);
    expect(data.models[1]).toEqual({ model: '<synthetic>', turns: 2, tokens: 0, priced: false });
    expect(data.byModel[1]).toMatchObject({ input: 0, cacheWrite: 0, cost: 0, priced: false });
    expect(data.projects[0].cacheRead).toBe(0);
    expect(data.sessions[0]).toMatchObject({ sessionId: 's1', durationMin: 65, cacheWrite: 0 });
    expect(data.sessionsTotal).toBe(3);
    expect(data.dispatches[0]).toMatchObject({ toolUses: 7, durationMs: 42000 });
    expect(data.hourly).toHaveLength(24);
    expect(data.hourly[14]).toEqual({
      hour: 14,
      turns: 30,
      output: 20000,
      avgTurns: 15,
      avgOutput: 10000,
    });
    expect(data.hourly[0].turns).toBe(0);
  });

  test('turns an empty or broken response into empty data', () => {
    for (const input of [null, undefined, 'x', [], { daily: 'nope', totals: null }]) {
      const data = normalizeData(input);
      expect(data.daily).toEqual([]);
      expect(data.sessions).toEqual([]);
      expect(data.totals.turns).toBe(0);
      expect(data.hourly).toHaveLength(24);
    }
    // Rows with a malformed day are dropped; priced defaults to true when absent.
    const data = normalizeData({
      daily: [{ day: '3/4' }, { day: '2026-03-04' }],
      models: [{ model: 'm' }],
    });
    expect(data.daily.map((row) => row.day)).toEqual(['2026-03-04']);
    expect(data.models[0].priced).toBe(true);
  });

  test('builds the data query', () => {
    expect(buildDataQuery({})).toBe('');
    expect(buildDataQuery({ from: '2026-03-01', to: '2026-03-04', models: ['a', 'b'] })).toBe(
      '?from=2026-03-01&to=2026-03-04&models=a%2Cb'
    );
    expect(buildDataQuery({ to: '2026-03-04', models: [] })).toBe('?to=2026-03-04');
  });

  test('the route is only rendered in the desktop app', () => {
    const routes = readFileSync(new URL('../src/router/MainRoutes.tsx', import.meta.url), 'utf8');
    expect(routes).toContain(
      'element: isDesktopApp() ? <ClaudeUsagePage /> : <Navigate to="/" replace />'
    );
    const layout = readFileSync(
      new URL('../src/components/layout/MainLayout.tsx', import.meta.url),
      'utf8'
    );
    expect(layout).toMatch(/isDesktopApp\(\)\s*\?\s*\[\s*\{\s*path: '\/claude-usage'/);
  });
});

describe('claude usage page', () => {
  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;
  const baseProps: ClaudeUsageViewProps = {
    status: normalizeStatus(RAW_STATUS),
    data: normalizeData(RAW_DATA),
    loading: false,
    error: '',
    showProgress: false,
    range: '7d',
    models: [],
    onRangeChange: () => undefined,
    onModelsChange: () => undefined,
    onRescan: () => undefined,
  };

  const render = async (lng: string, element: ReturnType<typeof createElement>) => {
    const i18n = createInstance();
    await i18n.init({
      lng,
      resources: { [lng]: { translation: locales[lng as keyof typeof locales] } },
      interpolation: { escapeValue: false },
    });
    const markup = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, element))
    );
    return { i18n, markup };
  };

  for (const lng of Object.keys(locales)) {
    test(`renders every section without raw translation keys (${lng})`, async () => {
      const { i18n, markup } = await render(lng, createElement(ClaudeUsageView, baseProps));
      expect(markup).toContain(i18n.t('claude_usage.title'));
      expect(markup).toContain(i18n.t('claude_usage.sessions.untitled'));
      expect(markup).toContain(i18n.t('claude_usage.dispatches.title'));
      expect(markup).toContain('$4.32');
      expect(markup).toContain('&lt;synthetic&gt;');
      expect(markup).toContain(i18n.t('claude_usage.na'));
      expect(markup).not.toMatch(/claude_usage\.[a-z_]+/);
    });

    test(`renders the first scan and empty states (${lng})`, async () => {
      const firstScan = await render(
        lng,
        createElement(ClaudeUsageView, {
          ...baseProps,
          status: normalizeStatus({
            scanning: true,
            'files-total': 40,
            'files-done': 10,
            'bytes-total': 4000,
            'bytes-done': 1000,
            sources: ['/x'],
          }),
          data: normalizeData({}),
          showProgress: true,
        })
      );
      expect(firstScan.markup).toContain(firstScan.i18n.t('claude_usage.scan.first_title'));
      expect(firstScan.markup).toContain('aria-valuenow="25"');

      const noSources = await render(
        lng,
        createElement(ClaudeUsageView, {
          ...baseProps,
          status: normalizeStatus({ 'last-scan-at': '2026-03-04T15:29:00Z' }),
          data: normalizeData({}),
        })
      );
      expect(noSources.markup).toContain('~/.claude/projects');

      const noData = await render(
        lng,
        createElement(ClaudeUsageView, { ...baseProps, data: normalizeData({}) })
      );
      expect(noData.markup).toContain(noData.i18n.t('claude_usage.empty.no_data_title'));

      for (const markup of [firstScan.markup, noSources.markup, noData.markup]) {
        expect(markup).not.toMatch(/claude_usage\.[a-z_]+/);
      }
    });
  }

  test('the routed page renders before any data arrives', async () => {
    const { i18n, markup } = await render('en', createElement(ClaudeUsagePage));
    expect(markup).toContain(i18n.t('claude_usage.title'));
    expect(markup).toContain(i18n.t('claude_usage.ranges.30d'));
    expect(markup).not.toMatch(/claude_usage\.[a-z_]+/);
  });

  test('every locale has the same claude_usage keys', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];
    const reference = keys(en.claude_usage).sort();
    for (const translation of Object.values(locales)) {
      expect(keys(translation.claude_usage).sort()).toEqual(reference);
      expect(translation.nav.claude_usage).toBeTruthy();
      expect(translation.nav_meta.claude_usage).toBeTruthy();
    }
    // Real translations, not English copies.
    for (const [lng, translation] of Object.entries(locales)) {
      if (lng === 'en') continue;
      expect(translation.claude_usage.lede).not.toBe(en.claude_usage.lede);
      expect(translation.claude_usage.scan.first_text).not.toBe(en.claude_usage.scan.first_text);
    }
  });
});
