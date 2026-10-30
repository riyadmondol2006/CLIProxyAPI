import { parseTimestamp } from './timestamp';

/**
 * Formatting utilities
 * Migrated from src/utils/string.js in the original project
 */

/**
 * Mask the middle of an API key, keeping only the first and last two characters
 */
export function maskApiKey(key: string): string {
  const trimmed = String(key || '').trim();
  if (!trimmed) {
    return '';
  }

  const MASKED_LENGTH = 10;
  const visibleChars = trimmed.length < 4 ? 1 : 2;
  const start = trimmed.slice(0, visibleChars);
  const end = trimmed.slice(-visibleChars);
  const maskedLength = Math.max(MASKED_LENGTH - visibleChars * 2, 1);
  const masked = '*'.repeat(maskedLength);

  return `${start}${masked}${end}`;
}

/**
 * Format a file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

const COMPACT_SUFFIXES = ['', 'K', 'M', 'B', 'T'] as const;

/**
 * Compress large counts into a compact form (1284 → 1.3K) for stat cards and chart labels
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';

  const sign = value < 0 ? '-' : '';
  let scaled = Math.abs(value);
  let tier = 0;

  while (scaled >= 1000 && tier < COMPACT_SUFFIXES.length - 1) {
    scaled /= 1000;
    tier += 1;
  }

  // Keep one decimal within three significant digits; Number() also strips redundant
  // tails like "1.0K"
  let rendered = tier === 0 ? Math.round(scaled) : Number(scaled.toFixed(scaled < 100 ? 1 : 0));

  // If rounding carries up to 1000 (e.g. 999,999 → 1000K), step up one more tier
  if (rendered >= 1000 && tier < COMPACT_SUFFIXES.length - 1) {
    rendered = 1;
    tier += 1;
  }

  return `${sign}${rendered}${COMPACT_SUFFIXES[tier]}`;
}

/**
 * Format a percentage, dropping a meaningless ".0" tail
 */
export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';

  const rendered = value.toFixed(fractionDigits);
  return `${rendered.replace(/\.0+$/, '')}%`;
}

/**
 * Format a Unix timestamp (seconds/milliseconds/microseconds/nanoseconds) as a local time string
 */
export function formatUnixTimestamp(value: unknown, locale?: string): string {
  if (value === null || value === undefined || value === '') return '';

  const asNumber = typeof value === 'number' ? value : Number(value);
  const date = (() => {
    if (!Number.isFinite(asNumber) || Number.isNaN(asNumber)) {
      return parseTimestamp(value) ?? new Date(String(value));
    }

    const abs = Math.abs(asNumber);

    // Seconds: usually 10 digits (~1e9)
    if (abs < 1e11) return new Date(asNumber * 1000);

    // Milliseconds: usually 13 digits (~1e12)
    if (abs < 1e14) return new Date(asNumber);

    // Microseconds: usually 16 digits (~1e15)
    if (abs < 1e17) return new Date(Math.round(asNumber / 1000));

    // Nanoseconds: usually 19 digits (~1e18)
    return new Date(Math.round(asNumber / 1e6));
  })();

  if (Number.isNaN(date.getTime())) return '';
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
}

export function parseDateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const date =
    typeof value === 'number'
      ? new Date(value < 1e12 ? value * 1000 : value)
      : (parseTimestamp(value) ?? new Date(String(value)));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateValue(value: unknown, locale?: string): string {
  const date = parseDateValue(value);
  if (!date) return '';
  return locale ? date.toLocaleDateString(locale) : date.toLocaleDateString();
}

export function formatDateTimeValue(value: unknown, locale?: string): string {
  const date = parseDateValue(value);
  if (!date) return '';
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
}
