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
import { normalizeApiBase } from '@/utils/connection';
import { isDesktopApp, normalizeDesktopStatus } from '@/utils/desktop';
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
