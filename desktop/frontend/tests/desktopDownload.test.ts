import { afterEach, describe, expect, test } from 'bun:test';
import { downloadBlob } from '@/utils/download';
import { useNotificationStore } from '@/stores/useNotificationStore';

const globals = globalThis as unknown as { window?: unknown; fetch: typeof fetch };
const originalWindow = globals.window;
const originalFetch = globals.fetch;

afterEach(() => {
  globals.window = originalWindow;
  globals.fetch = originalFetch;
});

describe('downloads in the desktop app', () => {
  test('are saved by the app and reported with their path', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globals.window = { __CPA_DESKTOP__: true, setTimeout, clearTimeout };
    globals.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body });
      return new Response(JSON.stringify({ path: '/home/u/Downloads/a b.json', cancelled: false }));
    }) as typeof fetch;

    downloadBlob({ filename: 'a b.json', blob: new Blob(['{}']) });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/app/save?name=a%20b.json');
    expect(calls[0].body).toBeInstanceOf(Blob);
    const messages = useNotificationStore.getState().notifications.map((n) => n.message);
    expect(messages.some((message) => message.includes('/home/u/Downloads/a b.json'))).toBe(true);
  });
});
