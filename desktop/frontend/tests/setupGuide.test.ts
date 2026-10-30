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
import { SetupGuidePage } from '@/features/setup/SetupGuidePage';
import {
  API_KEY_PLACEHOLDER,
  buildEndpoints,
  buildLoginCommand,
  buildSnippet,
  LOGIN_COMMANDS,
  maskApiKey,
  MODEL_PLACEHOLDER,
  SETUP_CLIENT_IDS,
} from '@/features/setup/snippets';

describe('setup guide snippets', () => {
  test('derives protocol endpoints from the API base', () => {
    expect(buildEndpoints('http://127.0.0.1:8317/')).toEqual({
      openai: 'http://127.0.0.1:8317/v1',
      anthropic: 'http://127.0.0.1:8317',
      gemini: 'http://127.0.0.1:8317',
    });
  });

  test('masks keys without revealing the middle', () => {
    expect(maskApiKey('sk-abcdefghijklmnop1234')).toBe('sk-abc…1234');
    expect(maskApiKey('short')).toBe('•••••');
  });

  test('embeds the base URL, key, and model in every client snippet', () => {
    const input = { baseUrl: 'http://127.0.0.1:8317', apiKey: 'sk-local', model: 'gpt-x' };
    for (const client of SETUP_CLIENT_IDS) {
      const { code, context } = buildSnippet(client, input);
      expect(context).toBeTruthy();
      expect(code).toContain('http://127.0.0.1:8317');
      expect(code).toContain('sk-local');
      expect(code).toContain('gpt-x');
    }
    expect(buildSnippet('curl', input).code).toContain('/v1/chat/completions');
    expect(buildSnippet('codex', input).code).toContain('base_url = "http://127.0.0.1:8317/v1"');
    expect(buildSnippet('claudeCode', input).code).toContain(
      'ANTHROPIC_BASE_URL="http://127.0.0.1:8317"'
    );
  });

  test('falls back to placeholders when no key or model is available', () => {
    const { code } = buildSnippet('python', {
      baseUrl: 'http://localhost:8317',
      apiKey: '',
      model: '',
    });
    expect(code).toContain(API_KEY_PLACEHOLDER);
    expect(code).toContain(MODEL_PLACEHOLDER);
  });

  test('lists only login flags the backend defines', () => {
    const backendMain = (() => {
      try {
        return readFileSync('../CLIProxyAPI/cmd/server/main.go', 'utf8');
      } catch {
        return null;
      }
    })();
    for (const command of LOGIN_COMMANDS) {
      expect(buildLoginCommand(command.flag)).toBe(`./cli-proxy-api ${command.flag}`);
      if (backendMain) {
        expect(backendMain).toContain(`"${command.flag.replace(/^--/, '')}"`);
      }
    }
  });
});

describe('setup guide page', () => {
  const locales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru, ko, vi } as const;

  for (const [lng, translation] of Object.entries(locales)) {
    test(`renders without raw translation keys or sponsor links (${lng})`, async () => {
      const i18n = createInstance();
      await i18n.init({ lng, resources: { [lng]: { translation } } });
      const markup = renderToStaticMarkup(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(MemoryRouter, null, createElement(SetupGuidePage))
        )
      );
      expect(markup).toContain(i18n.t('setup_guide.title'));
      expect(markup).toContain('role="tablist"');
      expect(markup).not.toMatch(/setup_guide\./);
      expect(markup.toLowerCase()).not.toContain('apikey.fan');
      expect(markup).not.toContain('aff=');
    });
  }
});
