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
import { isLoopbackUrl, resolveProxyAddresses } from '@/features/setup/useProxyAddresses';

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

  test('a browser panel on a remote server shares the address it was opened with', () => {
    const remote = resolveProxyAddresses('https://proxy.example.com/', network, false);
    expect(remote.remote).toBe(true);
    expect(remote.share).toBe('https://proxy.example.com');
    expect(remote.shareReachable).toBe(true);

    const byIp = resolveProxyAddresses('http://203.0.113.5:8317', null, false);
    expect(byIp.share).toBe('http://203.0.113.5:8317');
    expect(byIp.shareReachable).toBe(true);
  });

  test('a LAN URL equal to the panel address is not listed twice', () => {
    const addresses = resolveProxyAddresses('http://192.168.1.20:8317', network, false);
    expect(addresses.local).toBe('http://192.168.1.20:8317');
    expect(addresses.lan).toEqual([]);
    expect(addresses.share).toBe('http://192.168.1.20:8317');
  });

  test('a browser panel on localhost and the desktop app share the LAN URL', () => {
    for (const [apiBase, desktop] of [
      ['http://127.0.0.1:8317', false],
      ['http://localhost:8317', false],
      ['wails://wails', true],
      // The desktop app is never "remote", whatever its window address is.
      ['http://10.0.0.5:8317', true],
    ] as const) {
      const addresses = resolveProxyAddresses(apiBase, network, desktop);
      expect(addresses.remote).toBe(false);
      expect(addresses.share).toBe('http://192.168.1.20:8317');
      expect(addresses.shareReachable).toBe(true);
    }
    const lanOff = resolveProxyAddresses(
      'http://127.0.0.1:8317',
      { ...network, lanEnabled: false },
      false
    );
    expect(lanOff.share).toBe('http://127.0.0.1:8317');
    expect(lanOff.shareReachable).toBe(false);
  });

  test('loopback detection', () => {
    expect(isLoopbackUrl('http://localhost:8317')).toBe(true);
    expect(isLoopbackUrl('http://app.localhost')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.2:8317')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:8317')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.20:8317')).toBe(false);
    expect(isLoopbackUrl('https://proxy.example.com')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});

describe('web panel wording', () => {
  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;
  const WEB_KEYS = [
    'login.heading',
    'login.lede',
    'login.server_label',
    'login.custom_connection_toggle',
    'login.management_key_hint',
    'home.base_url_web',
    'home.tiles.server',
    'home.tiles.server_hint',
    'home.tiles.lan_off_hint_web',
    'home.actions.share_text_web',
    'home.lan_footnote_web',
    'setup_guide.lede_web',
    'setup_guide.this_server',
    'api_docs.lede_web',
    'api_docs.this_server',
    'access_keys.server_title',
    'access_keys.server_text',
    'access_keys.server_restart',
    'access_keys.lan_off_web',
    'access_keys.lan_no_address_web',
    'access_keys.lan_firewall_web',
    'access_keys.lan_off_text_web',
    'access_keys.lan_disable_confirm_message_web',
  ];
  const lookup = (tree: unknown, path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        tree
      );

  test('every locale has the web strings, and none of them mention this computer', () => {
    for (const [lng, translation] of Object.entries(locales)) {
      for (const key of WEB_KEYS) {
        const value = lookup(translation, key);
        expect(typeof value === 'string' && value.trim() !== '', `${lng} ${key}`).toBe(true);
      }
    }
    for (const key of WEB_KEYS) {
      expect(String(lookup(en, key)).toLowerCase()).not.toContain('this computer');
    }
    expect(lookup(en, 'access_keys.lan_off_text_web')).toContain('{{host}}');
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
