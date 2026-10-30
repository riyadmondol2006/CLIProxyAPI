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
import { ApiReferencePage } from '@/features/apiDocs/ApiReferencePage';
import { ENDPOINT_GROUPS, buildCurl } from '@/features/apiDocs/endpoints';
import { resolveProxyAddresses } from '@/features/setup/useProxyAddresses';

const network = {
  host: '',
  port: 8317,
  scheme: 'http',
  lanEnabled: true,
  lanUrls: ['http://192.168.1.20:8317/'],
  configuredHost: '',
  restartRequired: false,
};

describe('proxy addresses', () => {
  test('the desktop app uses the bound port, never its own wails:// origin', () => {
    const addresses = resolveProxyAddresses('wails://wails', network, true);
    expect(addresses.local).toBe('http://127.0.0.1:8317');
    expect(addresses.lan).toEqual(['http://192.168.1.20:8317']);
  });

  test('the browser panel keeps the address it was opened with', () => {
    expect(resolveProxyAddresses('http://10.0.0.5:8317/', network, false).local).toBe(
      'http://10.0.0.5:8317'
    );
  });

  test('LAN URLs are hidden while LAN access is off, and defaults apply without data', () => {
    const off = resolveProxyAddresses('wails://wails', { ...network, lanEnabled: false }, true);
    expect(off.lan).toEqual([]);
    const unknown = resolveProxyAddresses('wails://wails', null, true);
    expect(unknown.local).toBe('http://127.0.0.1:8317');
    expect(unknown.loaded).toBe(false);
  });
});

describe('endpoint catalog', () => {
  test('ids are unique and every path starts with a slash', () => {
    const ids = ENDPOINT_GROUPS.flatMap((group) => group.endpoints.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of ENDPOINT_GROUPS) {
      for (const endpoint of group.endpoints) {
        expect(endpoint.path.startsWith('/')).toBe(true);
        for (const alias of endpoint.aliases ?? []) expect(alias.startsWith('/')).toBe(true);
      }
    }
  });

  test('curl examples use the chosen base, key header, and model', () => {
    const find = (id: string) =>
      ENDPOINT_GROUPS.flatMap((group) => group.endpoints).find((e) => e.id === id)!.example!;
    const input = { base: 'http://192.168.1.20:8317/', key: "sk-'x", model: 'claude-opus-5-5' };

    const chat = buildCurl(find('chat'), input);
    expect(chat).toContain("'http://192.168.1.20:8317/v1/chat/completions'");
    expect(chat).toContain("Authorization: Bearer sk-'\\''x");
    expect(chat).toContain('"model":"claude-opus-5-5"');

    const messages = buildCurl(find('messages'), input);
    expect(messages).toContain('x-api-key: sk-');
    expect(messages).toContain('anthropic-version: 2023-06-01');

    const gemini = buildCurl(find('stream-generate'), input);
    expect(gemini).toContain('curl -N');
    expect(gemini).toContain('/v1beta/models/claude-opus-5-5:streamGenerateContent?alt=sse');
    expect(gemini).toContain('x-goog-api-key: sk-');

    expect(buildCurl(find('healthz'), input)).toBe("curl 'http://192.168.1.20:8317/healthz'");
  });
});

describe('API reference page', () => {
  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;
  for (const [lng, translation] of Object.entries(locales)) {
    test(`renders without raw translation keys (${lng})`, async () => {
      const i18n = createInstance();
      await i18n.init({ lng, resources: { [lng]: { translation } } });
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(MemoryRouter, null, createElement(ApiReferencePage))
        )
      );
      expect(markup).toContain(i18n.t('api_docs.title'));
      expect(markup).toContain('/v1/chat/completions');
      expect(markup).toContain('http://127.0.0.1:8317');
      expect(markup).not.toMatch(/api_docs\./);
    });
  }
});
