import { describe, expect, test } from 'bun:test';
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
import {
  buildRows,
  generateApiKey,
  parseTokenLimit,
  removeLimit,
  upsertLimit,
  usagePercent,
} from '@/features/accessKeys/logic';
import {
  normalizeKeyLimits,
  normalizeKeyUsage,
  normalizeServerNetwork,
  serializeKeyLimits,
} from '@/services/api/accessKeys';

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
