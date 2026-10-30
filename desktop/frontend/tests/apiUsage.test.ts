import { afterEach, describe, expect, spyOn, test } from 'bun:test';
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
import {
  ApiUsagePage,
  ApiUsageView,
  type ApiUsageViewProps,
} from '@/features/apiUsage/ApiUsagePage';
import {
  OTHER_SERIES,
  buildSeries,
  buildUsageView,
  countDimensions,
  groupRows,
  hasUsage,
  shareOf,
  sliceDays,
  slicePeriod,
  sumTotals,
  type GroupLabels,
} from '@/features/apiUsage/logic';
import { maskApiKey } from '@/features/setup/snippets';
import { apiClient } from '@/services/api/client';
import { normalizeTokenUsage, tokenUsageApi, type TokenUsage } from '@/services/api/tokenUsage';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

const LABELS: GroupLabels = {
  unknownProvider: 'Unknown provider',
  unknownModel: 'Unknown model',
  unknownAccount: 'Unknown account',
  removedKeys: 'Deleted keys',
  otherClients: 'Other clients',
  other: 'Other',
};

const KEY_2 = 'sk-abcdef1234567890wxyz';

const raw = (overrides: Record<string, unknown>) => ({
  provider: 'codex',
  'auth-id': '',
  'auth-index': '',
  account: '',
  model: 'gpt-5',
  'client-kind': 'other',
  'client-key': '',
  'client-name': '',
  tokens: [0, 0, 0],
  'input-tokens': [0, 0, 0],
  'output-tokens': [0, 0, 0],
  requests: [0, 0, 0],
  failed: [0, 0, 0],
  ...overrides,
});

/** Three days; today (2026-10-30) is last. */
const sample = (): TokenUsage =>
  normalizeTokenUsage({
    dates: ['2026-10-28', '2026-10-29', '2026-10-30'],
    rows: [
      raw({
        'auth-id': 'codex-sam.json',
        'auth-index': 'a1',
        account: 'sam@example.com',
        model: 'gpt-5-codex',
        'client-kind': 'key',
        'client-key': 'sk-laptopkey0000000001',
        'client-name': 'Laptop (Sam)',
        tokens: [1000, 0, 500],
        'input-tokens': [800, 0, 400],
        'output-tokens': [200, 0, 100],
        requests: [2, 0, 1],
        failed: [1, 0, 0],
      }),
      raw({
        'auth-id': 'codex-sam.json',
        'auth-index': 'a1',
        account: 'sam@example.com',
        'client-kind': 'key',
        'client-key': KEY_2,
        tokens: [0, 300, 0],
        'input-tokens': [0, 200, 0],
        'output-tokens': [0, 100, 0],
        requests: [0, 1, 0],
      }),
      raw({
        provider: 'claude',
        'auth-id': 'claude-me.json',
        'auth-index': 'c1',
        model: 'claude-opus-5-5',
        'client-kind': 'removed',
        tokens: [0, 0, 2000],
        'input-tokens': [0, 0, 1500],
        'output-tokens': [0, 0, 500],
        requests: [0, 0, 3],
        failed: [0, 0, 1],
      }),
      raw({
        provider: 'gemini',
        tokens: [200, 0, 0],
        'input-tokens': [150, 0, 0],
        'output-tokens': [50, 0, 0],
        requests: [1, 0, 0],
      }),
      // No activity at all: never shown as a group.
      raw({ provider: 'kimi', model: 'kimi-k2' }),
    ],
  });

describe('token usage API', () => {
  test('requests 90 days from /usage/tokens', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({
      dates: ['2026-10-30'],
      rows: [raw({ tokens: [7] })],
    } as never);
    spies.push(get);
    const usage = await tokenUsageApi.daily();
    expect(get).toHaveBeenCalledWith('/usage/tokens', { params: { days: 90 } });
    expect(usage.dates).toEqual(['2026-10-30']);
    expect(usage.rows[0].tokens).toEqual([7]);
  });

  test('lines every series up with the dates and coerces numbers', () => {
    const usage = normalizeTokenUsage({
      dates: ['2026-10-29', '2026-10-30'],
      rows: [
        {
          provider: ' codex ',
          model: 'gpt-5',
          'auth-index': 'a1',
          'client-kind': 'key',
          'client-key': 'sk-1',
          tokens: [5],
          'input-tokens': ['12', 'x', 99],
          'output-tokens': [-4, null],
          requests: [1, 2, 3],
          failed: 'nope',
        },
      ],
    });
    expect(usage.rows).toEqual([
      {
        provider: 'codex',
        authId: '',
        authIndex: 'a1',
        account: '',
        model: 'gpt-5',
        clientKind: 'key',
        clientKey: 'sk-1',
        clientName: '',
        tokens: [5, 0],
        inputTokens: [12, 0],
        outputTokens: [0, 0],
        requests: [1, 2],
        failed: [0, 0],
      },
    ]);
  });

  test('drops malformed rows and normalizes client kinds', () => {
    const usage = normalizeTokenUsage({
      dates: ['2026-10-30'],
      rows: [
        null,
        'row',
        [1, 2],
        { model: 'gpt-5', tokens: [1] },
        { provider: 'codex', tokens: [1] },
        { provider: 'codex', model: 'a', 'client-kind': 'mystery' },
        { provider: 'codex', model: 'b', 'client-kind': 'KEY' },
        { provider: 'codex', model: 'c', 'client-kind': 'key', 'client-name': 'Phone' },
        { provider: 'codex', model: 'd', 'client-kind': 'removed' },
      ],
    });
    expect(usage.rows.map((row) => [row.model, row.clientKind])).toEqual([
      ['a', 'other'],
      // A key row without a key or a name can't be told apart from other clients.
      ['b', 'other'],
      ['c', 'key'],
      ['d', 'removed'],
    ]);
    for (const input of [null, undefined, 'x', [], { dates: 'nope', rows: {} }]) {
      expect(normalizeTokenUsage(input)).toEqual({ dates: [], rows: [] });
    }
  });
});

describe('api usage periods', () => {
  test('today is the last date and longer periods take the last N dates', () => {
    const usage = sample();
    const today = slicePeriod(usage, 'today');
    expect(today.dates).toEqual(['2026-10-30']);
    expect(today.rows[0].tokens).toEqual([500]);
    expect(today.rows[0].failed).toEqual([0]);
    expect(sliceDays(usage, 2).dates).toEqual(['2026-10-29', '2026-10-30']);
    expect(sliceDays(usage, 2).rows[1].requests).toEqual([1, 0]);
    // Fewer dates than the period: everything is kept.
    expect(slicePeriod(usage, '7d')).toEqual(usage);
    expect(sliceDays(usage, 0).dates).toEqual([]);
  });

  test('totals and activity follow the period', () => {
    const usage = sample();
    expect(sumTotals(usage.rows)).toEqual({
      tokens: 4000,
      input: 3050,
      output: 950,
      requests: 8,
      failed: 2,
    });
    expect(sumTotals(slicePeriod(usage, 'today').rows)).toEqual({
      tokens: 2500,
      input: 1900,
      output: 600,
      requests: 4,
      failed: 1,
    });
    expect(hasUsage(usage)).toBe(true);
    expect(hasUsage(sliceDays(usage, 0))).toBe(false);
    expect(hasUsage(normalizeTokenUsage({ dates: ['2026-10-30'], rows: [raw({})] }))).toBe(false);
  });
});

describe('api usage grouping', () => {
  test('groups by provider, largest first, with shares of all tokens', () => {
    const groups = groupRows(sample(), 'provider', LABELS);
    expect(groups.map((group) => [group.id, group.label, group.totals.tokens])).toEqual([
      ['provider:claude', 'Claude', 2000],
      ['provider:codex', 'Codex', 1800],
      ['provider:gemini', 'Gemini', 200],
    ]);
    expect(groups.map((group) => group.share)).toEqual([0.5, 0.45, 0.05]);
    expect(groups[1].totals).toEqual({
      tokens: 1800,
      input: 1400,
      output: 400,
      requests: 4,
      failed: 1,
    });
    expect(groups[1].daily).toEqual([1000, 300, 500]);
    // kimi had no activity.
    expect(groups.some((group) => group.id === 'provider:kimi')).toBe(false);
  });

  test('groups accounts by auth index and keeps the provider', () => {
    const groups = groupRows(sample(), 'account', LABELS);
    expect(
      groups.map((group) => [group.id, group.label, group.placeholder, group.providers])
    ).toEqual([
      ['account:c1', 'claude-me.json', false, ['claude']],
      ['account:a1', 'sam@example.com', false, ['codex']],
      ['account-unknown:gemini', 'Unknown account', true, ['gemini']],
    ]);
    // auth-id, then account, identify the credential when the index is missing.
    const fallback = normalizeTokenUsage({
      dates: ['2026-10-30'],
      rows: [
        raw({ 'auth-id': 'one.json', tokens: [1] }),
        raw({ account: 'me@example.com', tokens: [2] }),
      ],
    });
    expect(groupRows(fallback, 'account', LABELS).map((group) => group.id)).toEqual([
      'account:me@example.com',
      'account:one.json',
    ]);
  });

  test('groups models across providers', () => {
    // The second Codex row and the Gemini row both used gpt-5.
    const groups = groupRows(sample(), 'model', LABELS);
    expect(groups.map((group) => [group.label, group.providers, group.totals.tokens])).toEqual([
      ['claude-opus-5-5', ['claude'], 2000],
      ['gpt-5-codex', ['codex'], 1500],
      ['gpt-5', ['codex', 'gemini'], 500],
    ]);
    const unknown = normalizeTokenUsage({
      dates: ['2026-10-30'],
      rows: [raw({ provider: 'unknown', model: 'unknown', tokens: [1] })],
    });
    expect(groupRows(unknown, 'model', LABELS)[0]).toMatchObject({
      label: 'Unknown model',
      placeholder: true,
    });
    expect(groupRows(unknown, 'provider', LABELS)[0]).toMatchObject({
      label: 'Unknown provider',
      placeholder: true,
    });
  });

  test('groups access keys by name or masked key, with deleted and other clients apart', () => {
    const groups = groupRows(sample(), 'key', LABELS);
    expect(groups.map((group) => [group.id, group.label, group.detail, group.placeholder])).toEqual(
      [
        ['client:removed', 'Deleted keys', undefined, true],
        ['key:sk-laptopkey0000000001', 'Laptop (Sam)', maskApiKey('sk-laptopkey0000000001'), false],
        ['key:' + KEY_2, maskApiKey(KEY_2), undefined, false],
        ['client:other', 'Other clients', undefined, true],
      ]
    );
    expect(maskApiKey(KEY_2)).toBe('sk-abc…wxyz');
    expect(groups.map((group) => group.label).join(' ')).not.toContain(KEY_2);
  });

  test('share is zero when nothing used tokens', () => {
    expect(shareOf(5, 0)).toBe(0);
    expect(shareOf(5, 10)).toBe(0.5);
    expect(shareOf(20, 10)).toBe(1);
    const failedOnly = normalizeTokenUsage({
      dates: ['2026-10-30'],
      rows: [raw({ requests: [3], failed: [3] })],
    });
    const groups = groupRows(failedOnly, 'provider', LABELS);
    expect(groups).toHaveLength(1);
    expect(groups[0].share).toBe(0);
    expect(buildSeries(groups, failedOnly.dates, 'Other')).toEqual([]);
  });

  test('the top five groups get their own series and the rest are summed as Other', () => {
    const models = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
    const usage = normalizeTokenUsage({
      dates: ['2026-10-29', '2026-10-30'],
      rows: models.map((model, index) =>
        raw({ model, tokens: [100 * (7 - index), 10 * (7 - index)], requests: [1, 1] })
      ),
    });
    const view = buildUsageView(usage, '30d', 'model', LABELS);
    expect(view.groups.map((group) => group.tone)).toEqual([0, 1, 2, 3, 4, 'other', 'other']);
    expect(view.series.map((item) => [item.key, item.tone])).toEqual([
      ['model:m1', 0],
      ['model:m2', 1],
      ['model:m3', 2],
      ['model:m4', 3],
      ['model:m5', 4],
      [OTHER_SERIES, 'other'],
    ]);
    // m6 + m7 per day.
    expect(view.series[5]).toMatchObject({ label: 'Other', values: [200 + 100, 20 + 10] });
    expect(view.dailyRequests).toEqual([7, 7]);
    const sum = view.series.reduce((total, item) => total + item.values[0], 0);
    expect(sum).toBe(view.groups.reduce((total, group) => total + group.daily[0], 0));

    // Five or fewer groups: no Other series.
    const few = buildUsageView(sample(), '30d', 'provider', LABELS);
    expect(few.series.map((item) => item.key)).toEqual([
      'provider:claude',
      'provider:codex',
      'provider:gemini',
    ]);
  });

  test('counts providers, accounts, and models for the header', () => {
    expect(countDimensions(sample(), LABELS)).toEqual({ providers: 3, accounts: 3, models: 3 });
    expect(countDimensions(slicePeriod(sample(), 'today'), LABELS)).toEqual({
      providers: 2,
      accounts: 2,
      models: 2,
    });
  });
});

describe('api usage page', () => {
  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;
  const baseProps: ApiUsageViewProps = {
    usage: sample(),
    loading: false,
    error: null,
    updatedAt: Date.UTC(2026, 9, 30, 12, 0),
    period: '30d',
    groupBy: 'account',
    onPeriodChange: () => undefined,
    onGroupByChange: () => undefined,
    onRetry: () => undefined,
    claudeUsageAvailable: true,
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
    // Compare against escaped text, since some strings contain apostrophes or quotes.
    const html = (text: string) =>
      renderToStaticMarkup(createElement('i', null, text)).slice(3, -4);
    return { i18n, markup, html };
  };

  for (const lng of Object.keys(locales)) {
    test(`renders tiles, chart, and table without raw translation keys (${lng})`, async () => {
      const { i18n, markup, html } = await render(lng, createElement(ApiUsageView, baseProps));
      expect(markup).toContain(html(i18n.t('api_usage.title')));
      expect(markup).toContain(html(i18n.t('api_usage.lede')));
      expect(markup).toContain(html(i18n.t('api_usage.tiles.tokens')));
      expect(markup).toContain(html(i18n.t('api_usage.table.account')));
      expect(markup).toContain(html(i18n.t('api_usage.groups.key')));
      expect(markup).toContain(html(i18n.t('api_usage.labels.unknown_account')));
      expect(markup).toContain('<svg');
      expect(markup).toContain('sam@example.com');
      // Provider badges on account rows.
      expect(markup).toContain('>Codex<');
      expect(markup).toContain('4.0K');
      expect(markup).not.toMatch(/api_usage\.[a-z_]+/);
    });

    test(`renders the loading, error, and empty states (${lng})`, async () => {
      const loading = await render(
        lng,
        createElement(ApiUsageView, { ...baseProps, usage: null, loading: true, updatedAt: null })
      );
      expect(loading.markup).toContain('aria-busy="true"');

      const failed = await render(
        lng,
        createElement(ApiUsageView, { ...baseProps, usage: null, error: 'boom' })
      );
      expect(failed.markup).toContain(failed.html(failed.i18n.t('api_usage.error.title')));
      expect(failed.markup).toContain(failed.html(failed.i18n.t('api_usage.error.retry')));
      expect(failed.markup).toContain('boom');

      const empty = await render(
        lng,
        createElement(ApiUsageView, {
          ...baseProps,
          usage: normalizeTokenUsage({ dates: ['2026-10-30'], rows: [] }),
        })
      );
      expect(empty.markup).toContain(empty.html(empty.i18n.t('api_usage.empty.title')));
      expect(empty.markup).toContain(empty.html(empty.i18n.t('api_usage.empty.claude_hint')));
      expect(empty.markup).toContain('href="/claude-usage"');

      const web = await render(
        lng,
        createElement(ApiUsageView, {
          ...baseProps,
          usage: normalizeTokenUsage({ dates: ['2026-10-30'], rows: [] }),
          claudeUsageAvailable: false,
        })
      );
      expect(web.markup).not.toContain('href="/claude-usage"');
      expect(web.markup).not.toContain(web.html(web.i18n.t('api_usage.empty.claude_hint')));

      // Usage on earlier days only: today is empty but 90 days is offered.
      const quietToday = normalizeTokenUsage({
        dates: ['2026-10-29', '2026-10-30'],
        rows: [raw({ tokens: [5, 0], requests: [1, 0] })],
      });
      const period = await render(
        lng,
        createElement(ApiUsageView, { ...baseProps, usage: quietToday, period: 'today' })
      );
      expect(period.markup).toContain(period.html(period.i18n.t('api_usage.empty.period_title')));
      expect(period.markup).toContain(period.html(period.i18n.t('api_usage.empty.show_90d')));

      for (const { markup } of [loading, failed, empty, web, period]) {
        expect(markup).not.toMatch(/api_usage\.[a-z_]+/);
      }
    });
  }

  test('a single day still draws a chart with one bar', async () => {
    const { markup } = await render(
      'en',
      createElement(ApiUsageView, { ...baseProps, period: 'today', groupBy: 'provider' })
    );
    expect(markup).toContain('<svg');
    expect(markup).toContain('Oct 30');
    expect(markup.match(/<g( class="[^"]*")?><path/g)?.length ?? 0).toBe(1);
  });

  test('the routed page renders before any data arrives', async () => {
    const { i18n, markup } = await render('en', createElement(ApiUsagePage));
    expect(markup).toContain(i18n.t('api_usage.title'));
    expect(markup).toContain(i18n.t('api_usage.periods.30d'));
    expect(markup).toContain(i18n.t('api_usage.groups.provider'));
    expect(markup).not.toMatch(/api_usage\.[a-z_]+/);
  });

  test('every locale has the same api_usage keys, with real translations', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];
    const reference = keys(en.api_usage).sort();
    for (const translation of Object.values(locales)) {
      expect(keys(translation.api_usage).sort()).toEqual(reference);
      expect(translation.nav.api_usage).toBeTruthy();
      expect(translation.nav_meta.api_usage).toBeTruthy();
    }
    for (const [lng, translation] of Object.entries(locales)) {
      if (lng === 'en') continue;
      expect(translation.api_usage.lede).not.toBe(en.api_usage.lede);
      expect(translation.api_usage.empty.text).not.toBe(en.api_usage.empty.text);
    }
  });

  test('the route, sidebar entry, and guide are wired up for desktop and web', () => {
    const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(source('../src/router/MainRoutes.tsx')).toContain(
      "{ path: '/api-usage', element: <ApiUsagePage /> }"
    );
    // Right after Activity, outside the desktop-only block.
    expect(source('../src/components/layout/MainLayout.tsx')).toMatch(
      /icon: sidebarIcons\.dashboard,\s*\},\s*\{\s*path: '\/api-usage',\s*labelKey: 'nav\.api_usage'/
    );
    const catalog = source('../src/features/docs/docsCatalog.ts');
    expect(catalog).toContain("import apiUsage from './content/api-usage.md?raw';");
    expect(catalog).toContain("guide('api-usage', apiUsage)");
    expect(source('../src/features/docs/content/api-usage.md')).toMatch(/^# API usage\n/);
  });
});
