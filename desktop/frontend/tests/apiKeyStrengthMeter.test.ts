import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { ApiKeyStrengthMeter } from '@/features/config/components/blocks/ApiKeyStrengthMeter';
import { SEGMENT_STAGGER_MS, segmentFillDelayMs } from '@/features/config/components/blocks/shared';
import { generateSecureApiKey } from '@/utils/apiKey';
import { LANGUAGE_ORDER } from '@/utils/constants';

const LOCALES = LANGUAGE_ORDER;

describe('ApiKeyStrengthMeter', () => {
  test('exposes the tier through the progressbar', () => {
    const markup = renderToStaticMarkup(
      createElement(ApiKeyStrengthMeter, { value: generateSecureApiKey() })
    );

    expect(markup).toContain('aria-valuenow="4"');
    expect(markup).toContain('aria-valuemax="4"');
    expect(markup).toContain(
      `aria-valuetext="${i18n.t('config_management.visual.api_keys.strength.strong')}"`
    );
    expect(markup.match(/data-filled="true"/g)).toHaveLength(4);
  });

  test('empty input lights nothing and shows a placeholder label', () => {
    const markup = renderToStaticMarkup(createElement(ApiKeyStrengthMeter, { value: '' }));

    expect(markup).toContain('aria-valuenow="0"');
    expect(markup).not.toContain('data-filled="true"');
    expect(markup).toContain('—');
  });

  test('segments cascade only over the newly lit ones', () => {
    const delays = (segments: number, previous: number) =>
      [0, 1, 2, 3].map((index) => segmentFillDelayMs(index, segments, previous));

    // 0 → 4 (click "Generate"): the four segments start in sequence
    expect(delays(4, 0)).toEqual([
      0,
      SEGMENT_STAGGER_MS,
      SEGMENT_STAGGER_MS * 2,
      SEGMENT_STAGGER_MS * 3,
    ]);
    // 2 → 3 (type one character): the new segment lights up immediately, not queued by its index
    expect(delays(3, 2)).toEqual([0, 0, 0, 0]);
    // 1 → 3: only the two new segments queue
    expect(delays(3, 1)).toEqual([0, 0, SEGMENT_STAGGER_MS, 0]);
    // 4 → 2 (delete characters): turning off happens immediately
    expect(delays(2, 4)).toEqual([0, 0, 0, 0]);
  });

  test('every tier label is translated in all supported locales', async () => {
    const original = i18n.language;

    for (const locale of LOCALES) {
      await i18n.changeLanguage(locale);
      for (const key of ['label', 'empty', 'weak', 'fair', 'good', 'strong']) {
        const path = `config_management.visual.api_keys.strength.${key}`;
        expect(i18n.exists(path)).toBe(true);
        expect(i18n.t(path)).not.toBe(path);
      }
    }

    await i18n.changeLanguage(original);
  });
});
