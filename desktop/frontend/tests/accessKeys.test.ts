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
import { AccessKeysPage } from '@/features/accessKeys/AccessKeysPage';
import { UsageHistorySection } from '@/features/accessKeys/UsageHistorySection';
import {
  buildRows,
  generateApiKey,
  HISTORY_ALL_KEYS,
  historyForKeys,
  historyPoints,
  parseTokenLimit,
  removeLimit,
  sumLastDays,
  upsertLimit,
  usagePercent,
} from '@/features/accessKeys/logic';
import {
  accessKeysApi,
  normalizeKeyLimits,
  normalizeKeyUsage,
  normalizeKeyUsageHistory,
  normalizeServerNetwork,
  serializeKeyLimits,
  type KeyUsageHistory,
} from '@/services/api/accessKeys';
import { apiClient } from '@/services/api/client';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

const sampleHistory = (): KeyUsageHistory =>
  normalizeKeyUsageHistory({
    dates: ['2026-10-28', '2026-10-29', '2026-10-30'],
    keys: [
      {
        'api-key': 'k1',
        name: 'Laptop',
        tokens: [100, 0, 25],
        requests: [2, 0, 1],
        'total-tokens': 125,
        'total-requests': 3,
      },
      { 'api-key': 'k2', tokens: [0, 40, 5], requests: [0, 1, 1] },
      { 'api-key': 'stale', tokens: [9, 9, 9], requests: [1, 1, 1] },
    ],
  });

describe('access key logic', () => {
  test('generates sk- keys with 40 hex characters', () => {
    const key = generateApiKey((bytes) => {
      bytes.fill(0xab);
    });
    expect(key).toBe(`sk-${'ab'.repeat(20)}`);
    expect(generateApiKey()).toMatch(/^sk-[0-9a-f]{40}$/);
    expect(generateApiKey()).not.toBe(generateApiKey());
  });

  test('parses token limits, treating empty or invalid input as unlimited', () => {
    expect(parseTokenLimit('500,000')).toBe(500000);
    expect(parseTokenLimit(' 1 000 ')).toBe(1000);
    expect(parseTokenLimit('')).toBeUndefined();
    expect(parseTokenLimit('0')).toBeUndefined();
    expect(parseTokenLimit('-5')).toBeUndefined();
    expect(parseTokenLimit('1.5')).toBeUndefined();
  });

  test('upserts limits in place and drops entries with nothing set', () => {
    const limits = [
      { apiKey: 'a', name: 'A' },
      { apiKey: 'b', tokenLimit: 10, period: 'daily' as const },
    ];
    const updated = upsertLimit(limits, {
      apiKey: 'a',
      name: 'A2',
      tokenLimit: 5,
      period: 'weekly',
    });
    expect(updated.map((limit) => limit.apiKey)).toEqual(['a', 'b']);
    expect(updated[0]).toEqual({
      apiKey: 'a',
      name: 'A2',
      tokenLimit: 5,
      period: 'weekly',
      disabled: undefined,
    });
    expect(upsertLimit(limits, { apiKey: 'b', name: '  ' })).toEqual([limits[0]]);
    expect(upsertLimit([], { apiKey: 'c', disabled: true })).toEqual([
      { apiKey: 'c', name: undefined, tokenLimit: undefined, period: undefined, disabled: true },
    ]);
    expect(removeLimit(limits, 'a')).toEqual([limits[1]]);
  });

  test('builds rows in api-keys order and ignores usage from another period', () => {
    const rows = buildRows(
      ['k1', 'k2'],
      [{ apiKey: 'k1', name: 'Laptop', tokenLimit: 100, period: 'daily' }],
      [
        { apiKey: 'k1', period: 'daily', tokensUsed: 120, requests: 3 },
        { apiKey: 'k2', period: 'weekly', tokensUsed: 50, requests: 1 },
      ]
    );
    expect(rows.map((row) => row.apiKey)).toEqual(['k1', 'k2']);
    expect(rows[0]).toMatchObject({ name: 'Laptop', exceeded: true, tokensUsed: 120 });
    expect(rows[1]).toMatchObject({ period: 'weekly', tokensUsed: 50, exceeded: false });
    expect(usagePercent(120, 100)).toBe(100);
    expect(usagePercent(25, 100)).toBe(25);
    expect(usagePercent(25)).toBeNull();
  });
});

describe('access key API normalization', () => {
  test('round-trips key limits using backend field names', () => {
    const raw = [
      { 'api-key': 'k1', name: 'Laptop', 'token-limit': 1000, period: 'DAILY', disabled: true },
      { 'api-key': '', name: 'ignored' },
      'not-an-object',
    ];
    const limits = normalizeKeyLimits(raw);
    expect(limits).toEqual([
      { apiKey: 'k1', name: 'Laptop', tokenLimit: 1000, period: 'daily', disabled: true },
    ]);
    expect(serializeKeyLimits(limits)).toEqual([
      { 'api-key': 'k1', name: 'Laptop', 'token-limit': 1000, period: 'daily', disabled: true },
    ]);
  });

  test('normalizes usage and network responses', () => {
    expect(
      normalizeKeyUsage({
        keys: [{ 'api-key': 'k1', period: 'weekly', 'tokens-used': 42, requests: 2 }],
      })
    ).toEqual([
      {
        apiKey: 'k1',
        period: 'weekly',
        tokensUsed: 42,
        requests: 2,
        periodEnd: undefined,
        lastUsed: undefined,
      },
    ]);
    expect(normalizeKeyUsage(null)).toEqual([]);
    expect(
      normalizeServerNetwork({
        host: '',
        port: 8317,
        'lan-enabled': true,
        'lan-urls': ['http://192.168.1.5:8317'],
      })
    ).toEqual({
      host: '',
      port: 8317,
      scheme: 'http',
      lanEnabled: true,
      lanUrls: ['http://192.168.1.5:8317'],
      configuredHost: '',
      restartRequired: false,
    });
  });
});

describe('access keys page', () => {
  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;

  for (const [lng, translation] of Object.entries(locales)) {
    test(`renders without raw translation keys (${lng})`, async () => {
      const i18n = createInstance();
      await i18n.init({ lng, resources: { [lng]: { translation } } });
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(MemoryRouter, null, createElement(AccessKeysPage))
        )
      );
      expect(markup).toContain(i18n.t('access_keys.title'));
      expect(markup).not.toMatch(/access_keys\./);
    });
  }
});

describe('access key writes', () => {
  test('creating or deleting a key writes api-keys and key-limits in one PATCH', async () => {
    const patch = spyOn(apiClient, 'patch').mockResolvedValue({} as never);
    const put = spyOn(apiClient, 'put').mockResolvedValue({} as never);
    spies.push(patch, put);
    const limits = [{ apiKey: 'k1', name: 'Laptop', tokenLimit: 100, period: 'daily' as const }];

    await accessKeysApi.replaceKeysAndLimits(
      ['k1', 'k2'],
      upsertLimit(limits, { apiKey: 'k2', name: 'Phone', tokenLimit: 500, period: 'weekly' })
    );
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenLastCalledWith('/config/access', {
      'api-keys': ['k1', 'k2'],
      'key-limits': [
        { 'api-key': 'k1', name: 'Laptop', 'token-limit': 100, period: 'daily' },
        { 'api-key': 'k2', name: 'Phone', 'token-limit': 500, period: 'weekly' },
      ],
    });

    await accessKeysApi.replaceKeysAndLimits(['k2'], removeLimit(limits, 'k1'));
    expect(patch).toHaveBeenLastCalledWith('/config/access', {
      'api-keys': ['k2'],
      'key-limits': [],
    });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(put).not.toHaveBeenCalled();
  });

  test('the page creates and deletes keys without separate list writes', () => {
    const source = readFileSync(
      new URL('../src/features/accessKeys/AccessKeysPage.tsx', import.meta.url),
      'utf8'
    );
    expect(source).not.toContain('apiKeysApi.replace(');
    expect(source.match(/accessKeysApi\.replaceKeysAndLimits\(/g)).toHaveLength(2);
  });
});

describe('access key usage history', () => {
  test('requests the last 30 days and lines every series up with the dates', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({
      dates: ['2026-10-29', '2026-10-30'],
      keys: [{ 'api-key': 'k1', tokens: [5], requests: [1, 2, 3] }, { name: 'no key' }],
    } as never);
    spies.push(get);
    const history = await accessKeysApi.usageHistory();
    expect(get).toHaveBeenCalledWith('/access/key-usage/history', { params: { days: 30 } });
    expect(history).toEqual({
      dates: ['2026-10-29', '2026-10-30'],
      keys: [
        {
          apiKey: 'k1',
          name: undefined,
          tokens: [5, 0],
          requests: [1, 2],
          totalTokens: 0,
          totalRequests: 0,
        },
      ],
    });
    expect(normalizeKeyUsageHistory(null)).toEqual({ dates: [], keys: [] });
  });

  test('sums all keys or filters one, and totals the latest days', () => {
    const history = historyForKeys(sampleHistory(), ['k1', 'k2']);
    expect(history.keys.map((entry) => entry.apiKey)).toEqual(['k1', 'k2']);
    const all = historyPoints(history, HISTORY_ALL_KEYS);
    expect(all).toEqual([
      { day: '2026-10-28', tokens: 100, requests: 2 },
      { day: '2026-10-29', tokens: 40, requests: 1 },
      { day: '2026-10-30', tokens: 30, requests: 2 },
    ]);
    const k2 = historyPoints(history, 'k2');
    expect(k2.map((point) => point.tokens)).toEqual([0, 40, 5]);
    expect(sumLastDays(all, 1)).toEqual({ tokens: 30, requests: 2 });
    expect(sumLastDays(all, 7)).toEqual({ tokens: 170, requests: 5 });
    expect(sumLastDays(k2, 2)).toEqual({ tokens: 45, requests: 2 });
  });

  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;
  for (const [lng, translation] of Object.entries(locales)) {
    test(`renders the chart and totals without raw translation keys (${lng})`, async () => {
      const i18n = createInstance();
      await i18n.init({ lng, resources: { [lng]: { translation } } });
      const render = (history: KeyUsageHistory | null) =>
        renderToStaticMarkup(
          createElement(
            I18nextProvider,
            { i18n },
            createElement(UsageHistorySection, {
              history,
              loading: false,
              labelFor: (apiKey: string) => (apiKey === 'k1' ? 'Laptop' : apiKey),
            })
          )
        );
      const markup = render(historyForKeys(sampleHistory(), ['k1', 'k2']));
      expect(markup).toContain(i18n.t('access_keys.history.title'));
      expect(markup).toContain(i18n.t('access_keys.history.all_keys'));
      expect(markup).toContain('<svg');
      expect(markup).toContain('Laptop');
      expect(markup).not.toMatch(/access_keys\./);
      // Compare against the escaped text, since en strings contain apostrophes.
      const html = (text: string) => renderToStaticMarkup(createElement('i', null, text));
      expect(render(null)).toContain(html(i18n.t('access_keys.history.unavailable')).slice(3, -4));
      const idle = {
        ...sampleHistory(),
        keys: [{ ...sampleHistory().keys[1], tokens: [0, 0, 0], requests: [0, 0, 0] }],
      };
      expect(render(idle)).toContain(
        html(i18n.t('access_keys.history.empty', { days: 3 })).slice(3, -4)
      );
    });
  }
});
