/**
 * API key strength estimation.
 *
 * Model: charset entropy × predictability discount → four tiers. Pure functions; the UI only
 * consumes tier/segments, so tweaks to the scoring rules don't ripple into components.
 */

export type ApiKeyStrengthTier = 'weak' | 'fair' | 'good' | 'strong';

export interface ApiKeyStrength {
  tier: ApiKeyStrengthTier;
  /** Number of lit segments (0–4); 0 means empty input */
  segments: number;
  /** Estimated entropy, rounded down to whole bits */
  bits: number;
}

/** Tiers from weakest to strongest; the index equals lit segments - 1 */
const TIER_ORDER: readonly ApiKeyStrengthTier[] = ['weak', 'fair', 'good', 'strong'];

export const API_KEY_STRENGTH_SEGMENTS = TIER_ORDER.length;

// Charset sizes: aligned with the visible ASCII characters allowed by isValidApiKeyCharset
// (0x21–0x7E, 94 in total)
const CHARSET_CLASSES: readonly { pattern: RegExp; size: number }[] = [
  { pattern: /[a-z]/, size: 26 },
  { pattern: /[A-Z]/, size: 26 },
  { pattern: /[0-9]/, size: 10 },
  { pattern: /[^a-zA-Z0-9]/, size: 32 },
];

/** Password fragments guessable at a glance; a match heavily discounts the score */
const GUESSABLE_TOKENS: readonly string[] = [
  'password',
  'passwd',
  '123456',
  'qwerty',
  'admin',
  'secret',
  'apikey',
  'api-key',
  'letmein',
  'changeme',
  'iloveyou',
  'default',
  'test',
  'demo',
];

// Repeated and sequential characters add almost no guessing cost, so they count toward the
// effective length only at a residual weight
const REPEAT_WEIGHT = 0.25;
const SEQUENCE_WEIGHT = 0.35;
const GUESSABLE_FACTOR = 0.4;

// Entropy thresholds (bits). A 48-char random base62 key ≈ 285 bits; 32 hex chars = 128 bits.
const BITS_FOR_FAIR = 40;
const BITS_FOR_GOOD = 64;
const BITS_FOR_STRONG = 96;

// Length caps: no amount of entropy protects a short string from offline brute force, so keys
// shorter than a threshold are locked to the matching tier
const LENGTH_CAPS: readonly { below: number; tier: ApiKeyStrengthTier }[] = [
  { below: 8, tier: 'weak' },
  { below: 16, tier: 'fair' },
  { below: 24, tier: 'good' },
];

/** With too few distinct characters, the entropy from length is fake (e.g. 32 'a's) */
const MIN_UNIQUE_FOR_FAIR = 5;

/**
 * Effective length: characters that repeat the previous one, or continue an ascending/descending
 * run, count only at a residual weight.
 * Random strings barely trigger the discount, while patterned strings get compressed heavily.
 */
function effectiveLength(key: string): number {
  let total = 0;
  let sequenceRun = 1;

  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    const previous = index > 0 ? key.charCodeAt(index - 1) : Number.NaN;

    if (code === previous) {
      total += REPEAT_WEIGHT;
      sequenceRun = 1;
      continue;
    }

    const delta = code - previous;
    if (delta === 1 || delta === -1) {
      sequenceRun += 1;
      // The first two characters still count as new information; only from the third on is the
      // sequence predictable
      total += sequenceRun >= 3 ? SEQUENCE_WEIGHT : 1;
      continue;
    }

    sequenceRun = 1;
    total += 1;
  }

  return total;
}

/**
 * Smallest period length: `deadbeefdeadbeef` → 8, `abcabca` → 3; returns the original length if
 * there's no period.
 * Solved with (s + s).indexOf(s, 1), which also detects an incomplete trailing period.
 */
function smallestPeriod(key: string): number {
  const period = `${key}${key}`.indexOf(key, 1);
  return period > 0 && period < key.length ? period : key.length;
}

function charsetSize(key: string): number {
  return CHARSET_CLASSES.reduce(
    (size, charClass) => (charClass.pattern.test(key) ? size + charClass.size : size),
    0
  );
}

function tierForBits(bits: number): ApiKeyStrengthTier {
  if (bits >= BITS_FOR_STRONG) return 'strong';
  if (bits >= BITS_FOR_GOOD) return 'good';
  if (bits >= BITS_FOR_FAIR) return 'fair';
  return 'weak';
}

function capTier(tier: ApiKeyStrengthTier, cap: ApiKeyStrengthTier): ApiKeyStrengthTier {
  return TIER_ORDER.indexOf(tier) <= TIER_ORDER.indexOf(cap) ? tier : cap;
}

/**
 * Estimates the strength of a user-chosen API key. For reference only; not part of save
 * validation.
 */
export function evaluateApiKeyStrength(rawKey: string): ApiKeyStrength {
  const key = rawKey.trim();
  if (!key) return { tier: 'weak', segments: 0, bits: 0 };

  const pool = charsetSize(key);
  const lowerCased = key.toLowerCase();
  const guessable = GUESSABLE_TOKENS.some((token) => lowerCased.includes(token));
  // A periodic string costs only one period to guess; the repeated part counts at a residual
  // weight
  const period = smallestPeriod(key);
  const length = effectiveLength(key.slice(0, period)) + (key.length - period) * REPEAT_WEIGHT;
  const bits = Math.floor(length * Math.log2(pool) * (guessable ? GUESSABLE_FACTOR : 1));

  let tier = tierForBits(bits);
  for (const { below, tier: cap } of LENGTH_CAPS) {
    if (key.length < below) tier = capTier(tier, cap);
  }
  if (new Set(key).size < MIN_UNIQUE_FOR_FAIR) tier = capTier(tier, 'weak');

  return { tier, segments: TIER_ORDER.indexOf(tier) + 1, bits };
}
