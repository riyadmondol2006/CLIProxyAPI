import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
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
import { HomePage } from '@/features/home/HomePage';
import { needsServiceRestart } from '@/features/desktop/version';
import { isLanHost } from '@/features/accessKeys/logic';
import { normalizeServerNetwork } from '@/services/api/accessKeys';
import { normalizeApiBase } from '@/utils/connection';
import { isDesktopApp, normalizeDesktopStatus, openAuthUrlInBrowser } from '@/utils/desktop';
import {
  decorateDocHtml,
  docHeadings,
  docTitle,
  searchDocs,
  slugify,
  type DocEntry,
} from '@/features/docs/docsUtils';

describe('desktop integration helpers', () => {
  test('keeps the app origin and still defaults bare hosts to http', () => {
    expect(normalizeApiBase('wails://wails')).toBe('wails://wails');
    expect(normalizeApiBase('wails://wails/v8/management')).toBe('wails://wails');
    expect(normalizeApiBase('localhost:8317')).toBe('http://localhost:8317');
  });

  test('is not in desktop mode outside the app window', () => {
    expect(isDesktopApp()).toBe(false);
  });

  test('opens sign-in links in the browser only inside the app', () => {
    const opened: string[] = [];
    const globals = globalThis as unknown as { window?: unknown };
    const previous = globals.window;
    try {
      globals.window = { runtime: { BrowserOpenURL: (url: string) => opened.push(url) } };
      openAuthUrlInBrowser('https://claude.ai/oauth/authorize?x=1');
      expect(opened).toEqual([]);

      globals.window = {
        __CPA_DESKTOP__: true,
        runtime: { BrowserOpenURL: (url: string) => opened.push(url) },
      };
      openAuthUrlInBrowser('https://claude.ai/oauth/authorize?x=1');
      openAuthUrlInBrowser('javascript:alert(1)');
      openAuthUrlInBrowser(undefined);
      expect(opened).toEqual(['https://claude.ai/oauth/authorize?x=1']);
    } finally {
      globals.window = previous;
    }
  });

  test('asks for a restart only when real versions differ', () => {
    expect(needsServiceRestart('0.20261031.7', '0.20261030.3')).toBe(true);
    expect(needsServiceRestart('v8.2.0', '8.2.0')).toBe(false);
    expect(needsServiceRestart('dev', '0.20261030.3')).toBe(false);
    expect(needsServiceRestart('0.20261030.3', null)).toBe(false);
  });

  test('recognizes bind hosts that accept LAN connections', () => {
    for (const host of ['', '0.0.0.0', '::', '[::]', '192.168.1.5'])
      expect(isLanHost(host)).toBe(true);
    for (const host of ['127.0.0.1', 'localhost', '::1', '127.0.1.1'])
      expect(isLanHost(host)).toBe(false);
  });

  test('reads the pending host change from the network response', () => {
    const network = normalizeServerNetwork({
      host: '127.0.0.1',
      port: 8317,
      'lan-enabled': false,
      'lan-urls': [],
      'configured-host': '',
      'restart-required': true,
    });
    expect(network.lanEnabled).toBe(false);
    expect(network.configuredHost).toBe('');
    expect(network.restartRequired).toBe(true);
    // Older backends without the new fields: no restart is assumed.
    expect(normalizeServerNetwork({ host: '', 'lan-enabled': true }).restartRequired).toBe(false);
  });

  test('normalizes the app status response', () => {
    expect(
      normalizeDesktopStatus({
        'app-version': '1.2.3',
        'config-path': '/home/u/.config/cliproxyapi/config.yaml',
        listen: { host: '', port: 8317 },
        service: { available: true, installed: true, active: 'active', enabled: 'enabled' },
        'token-ready': true,
        reachable: true,
      })
    ).toEqual({
      appVersion: '1.2.3',
      configPath: '/home/u/.config/cliproxyapi/config.yaml',
      host: '',
      port: 8317,
      service: {
        available: true,
        installed: true,
        active: 'active',
        enabled: 'enabled',
        error: undefined,
      },
      tokenReady: true,
      reachable: true,
      autostart: false,
    });
    expect(normalizeDesktopStatus(null).service.available).toBe(false);
  });
});

describe('docs helpers', () => {
  const markdown = '# Title\n\n## First part\n\n```bash\n## not a heading\n```\n\n## Second & last';

  test('extracts the title and outline, ignoring code blocks', () => {
    expect(docTitle(markdown, 'fallback')).toBe('Title');
    expect(docTitle('no heading', 'fallback')).toBe('fallback');
    expect(docHeadings(markdown)).toEqual([
      { id: 'first-part', text: 'First part' },
      { id: 'second-last', text: 'Second & last' },
    ]);
    expect(slugify('2. Allow <code>LAN</code> access')).toBe('2-allow-lan-access');
  });

  test('adds heading ids and copy buttons to rendered HTML', () => {
    const html = decorateDocHtml('<h2>Allow LAN</h2><pre><code>x</code></pre>', 'Copy');
    expect(html).toContain('<h2 id="allow-lan">Allow LAN</h2>');
    expect(html).toContain('<div class="doc-code"><button type="button" class="doc-copy"');
    expect(html).toContain('</code></pre></div>');
  });

  test('ranks title matches before body matches', () => {
    const docs: DocEntry[] = [
      { id: 'a', group: 'guides', title: 'Accounts', markdown: 'firewall rules' },
      { id: 'b', group: 'guides', title: 'Firewall', markdown: '' },
      { id: 'c', group: 'guides', title: 'Other', markdown: '' },
    ];
    expect(searchDocs(docs, 'firewall').map((doc) => doc.id)).toEqual(['b', 'a']);
    expect(searchDocs(docs, '  ')).toHaveLength(3);
  });

  test('every bundled guide starts with a title', () => {
    const dir = new URL('../src/features/docs/content/', import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith('.md'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const name of files) {
      expect(readFileSync(new URL(name, dir), 'utf8')).toMatch(/^# \S/);
    }
  });
});

describe('home page', () => {
  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;

  for (const [lng, translation] of Object.entries(locales)) {
    test(`renders without raw translation keys (${lng})`, async () => {
      const i18n = createInstance();
      await i18n.init({ lng, resources: { [lng]: { translation } } });
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(MemoryRouter, null, createElement(HomePage))
        )
      );
      expect(markup).toContain(i18n.t('home.actions.signin'));
      expect(markup).not.toMatch(/(home|desktop|docs)\.[a-z_]+/);
    });
  }
});
