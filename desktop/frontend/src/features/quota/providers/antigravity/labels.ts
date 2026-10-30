/**
 * Antigravity quota label → i18n key resolution (pure functions, easy to test).
 *
 * The upstream displayName changes across versions (e.g. "Five Hour Limit Remaining"), so we
 * first match on the normalized text, and only fall back to the structured `window` field when
 * that doesn't match.
 */

const GROUP_LABEL_KEYS = new Map<string, string>([
  ['gemini models', 'group_gemini_models'],
  ['claude and gpt models', 'group_claude_gpt_models'],
]);

const BUCKET_LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['five-hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);

const BUCKET_WINDOW_KEYS = new Map<string, string>([
  ['5h', 'five_hour_limit'],
  ['five-hour', 'five_hour_limit'],
  ['five_hour', 'five_hour_limit'],
  ['daily', 'daily_limit'],
  ['day', 'daily_limit'],
  ['weekly', 'weekly_limit'],
  ['week', 'weekly_limit'],
  ['monthly', 'monthly_limit'],
  ['month', 'monthly_limit'],
]);

/**
 * Models not listed in the upstream group description that actually share the group's quota;
 * they are appended to the end of the "this group includes" list.
 */
const GROUP_EXTRA_MODELS = new Map<string, readonly string[]>([
  ['group_gemini_models', ['Gemini Argon']],
]);

const GROUP_MODELS_PATTERN = /^models within this group:\s*(.+)$/i;

const normalizeText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Strip the common upstream "Remaining" suffix, e.g. "Weekly Limit Remaining" → "weekly limit".
 */
const stripRemainingSuffix = (value: string): string =>
  value.replace(/\s*(?:-|:)?\s*remaining$/, '').trim();

export function resolveAntigravityGroupLabelKey(label: string): string | null {
  return GROUP_LABEL_KEYS.get(normalizeText(label)) ?? null;
}

/**
 * Parses the model list from a group description and appends the group's extra models
 * (case-insensitive dedup). Returns null when the description isn't in the
 * "Models within this group: ..." format, so the caller shows the original text.
 */
export function resolveAntigravityGroupModels(
  label: string,
  description: string | undefined
): string[] | null {
  const match = description?.trim().match(GROUP_MODELS_PATTERN);
  if (!match) return null;

  const models = match[1]
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const groupKey = resolveAntigravityGroupLabelKey(label);
  const extras = groupKey ? (GROUP_EXTRA_MODELS.get(groupKey) ?? []) : [];
  const seen = new Set(models.map(normalizeText));
  extras.forEach((model) => {
    if (seen.has(normalizeText(model))) return;
    seen.add(normalizeText(model));
    models.push(model);
  });
  return models;
}

export function resolveAntigravityBucketLabelKey(
  label: string,
  window: string | undefined
): string | null {
  const normalized = normalizeText(label);
  const byLabel =
    BUCKET_LABEL_KEYS.get(normalized) ?? BUCKET_LABEL_KEYS.get(stripRemainingSuffix(normalized));
  if (byLabel) return byLabel;
  if (!window) return null;
  return BUCKET_WINDOW_KEYS.get(normalizeText(window)) ?? null;
}

interface AntigravityBucketLike {
  label: string;
  window?: string;
  remainingFraction: number;
}

/**
 * Whether a full bucket shows "quota available". When the same group's weekly limit is used up,
 * the 5-hour limit is unusable even if full (upstream marks it disabled while remainingFraction
 * is still 1), so "quota available" is not shown in that case.
 */
export function shouldShowAntigravityQuotaAvailable(
  bucket: AntigravityBucketLike,
  groupBuckets: readonly AntigravityBucketLike[]
): boolean {
  if (bucket.remainingFraction !== 1) return false;
  if (resolveAntigravityBucketLabelKey(bucket.label, bucket.window) !== 'five_hour_limit') {
    return true;
  }
  return !groupBuckets.some(
    (item) =>
      resolveAntigravityBucketLabelKey(item.label, item.window) === 'weekly_limit' &&
      item.remainingFraction <= 0
  );
}
