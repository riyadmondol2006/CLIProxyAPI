import { TRAFFIC_BUCKET_MINUTES } from './types';

/** Provider display names. All are proper nouns, so they don't go through i18n. */
const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  'gemini-interactions': 'Interactions API',
  aistudio: 'AI Studio',
  codex: 'Codex',
  claude: 'Claude',
  devin: 'Devin',
  meta: 'Muse (Meta)',
  xai: 'xAI',
  vertex: 'Vertex AI',
  openai: 'OpenAI Compatible',
  'openai-compatibility': 'OpenAI Compatible',
  qwen: 'Qwen',
  kimi: 'Kimi',
  iflow: 'iFlow',
  antigravity: 'Antigravity',
};

const OPENAI_COMPAT_PREFIX = 'openai-compatible-';

/**
 * Resolves a provider's display name; unknown ids fall back to a capitalized first letter, and
 * `unknown` is left to the caller to localize.
 */
export function providerLabel(id: string, unknownLabel: string): string {
  if (id === 'unknown' || !id) return unknownLabel;
  // OpenAI-compatible providers are ids like "openai-compatible-<name from the config>".
  const compatName = id.startsWith(OPENAI_COMPAT_PREFIX)
    ? id.slice(OPENAI_COMPAT_PREFIX.length)
    : '';
  if (compatName) return `${compatName} (OpenAI Compatible)`;
  return PROVIDER_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export interface WindowParts {
  hours: number;
  minutes: number;
}

/** Split window minutes into hours/minutes for i18n interpolation */
export function splitWindowMinutes(totalMinutes: number): WindowParts {
  const safe = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

/** Bucket count → covered minutes */
export function bucketsToMinutes(bucketCount: number): number {
  return bucketCount * TRAFFIC_BUCKET_MINUTES;
}

export type MeterTone = 'good' | 'warning' | 'critical' | 'idle';

/** Success rate → severity. The value is always visible; color is only a supporting channel. */
export function toneForSuccessRate(rate: number | null): MeterTone {
  if (rate === null) return 'idle';
  if (rate >= 95) return 'good';
  if (rate >= 80) return 'warning';
  return 'critical';
}

/**
 * Tick step ladder. Finer than 1/2/5, so a peak of 112 doesn't get bumped up to 200 and waste half
 * the chart.
 */
const STEP_LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

/** Round a value up to a readable tick (ladder step × 10^n) */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = STEP_LADDER.find((candidate) => normalized <= candidate) ?? 10;
  return step * magnitude;
}

/**
 * Y-axis max: first round the tick interval, then multiply by the number of intervals.
 * That way every grid line lands on an integer, and the max won't sit far above the peak.
 */
export function axisMax(peak: number, intervals: number): number {
  if (peak <= 0 || intervals <= 0) return Math.max(1, intervals);
  const step = Math.max(1, Math.ceil(niceCeil(peak / intervals)));
  return step * intervals;
}
