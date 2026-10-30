import type { TokenCounts } from './api';

/* ---------- Ranges ---------- */

export const RANGE_KEYS = ['today', '7d', '30d', '90d', 'this_month', 'last_month', 'all'] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export const DEFAULT_RANGE: RangeKey = '30d';

export interface DayRange {
  /** Inclusive local start date (YYYY-MM-DD); absent means unbounded. */
  from?: string;
  /** Inclusive local end date (YYYY-MM-DD); absent means unbounded. */
  to?: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Formats a Date as a local calendar day, YYYY-MM-DD. */
export const toLocalDay = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Parses YYYY-MM-DD as local midnight (not UTC, which `new Date(str)` would use). */
export const parseLocalDay = (day: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysBack = (now: Date, days: number) =>
  toLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));

/** Computes the inclusive local from/to dates for a range, relative to `now`. */
export function computeRange(range: RangeKey, now: Date = new Date()): DayRange {
  const today = toLocalDay(now);
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: daysBack(now, 6), to: today };
    case '30d':
      return { from: daysBack(now, 29), to: today };
    case '90d':
      return { from: daysBack(now, 89), to: today };
    case 'this_month':
      return { from: toLocalDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'last_month':
      return {
        from: toLocalDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        // Day 0 of this month is the last day of the previous one.
        to: toLocalDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'all':
    default:
      return {};
  }
}

/** True when the range ends today or later (so new usage can still show up in it). */
export const rangeIncludesToday = (range: DayRange, now: Date = new Date()): boolean =>
  !range.to || range.to >= toLocalDay(now);

export const parseRangeKey = (value: string | null | undefined): RangeKey =>
  (RANGE_KEYS as readonly string[]).includes(value ?? '') ? (value as RangeKey) : DEFAULT_RANGE;

/** Reads the comma-separated model filter from the URL; empty means all models. */
export const parseModelList = (value: string | null | undefined): string[] => {
  const seen = new Set<string>();
  for (const part of (value ?? '').split(',')) {
    const model = part.trim();
    if (model) seen.add(model);
  }
  return [...seen];
};

/** Returns the next URL query for a view, leaving defaults out so the URL stays short. */
export function buildViewSearch(
  current: URLSearchParams,
  view: { range: RangeKey; models: string[] }
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (view.range === DEFAULT_RANGE) next.delete('range');
  else next.set('range', view.range);
  if (view.models.length === 0) next.delete('models');
  else next.set('models', view.models.join(','));
  return next;
}

/** Adds or removes one model; selecting every model collapses back to "all". */
export function toggleModel(selected: string[], model: string, available: string[]): string[] {
  const next = selected.includes(model)
    ? selected.filter((item) => item !== model)
    : [...selected, model];
  if (available.length > 0 && available.every((item) => next.includes(item))) return [];
  return next;
}

/* ---------- Number formatting ---------- */

/** Token counts: 999, 1.2K, 3.45M, 1.20B. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs < 1000) return `${sign}${Math.round(abs)}`;
  const k = Number((abs / 1e3).toFixed(1));
  if (k < 1000) return `${sign}${k.toFixed(1)}K`;
  const m = Number((abs / 1e6).toFixed(2));
  if (m < 1000) return `${sign}${m.toFixed(2)}M`;
  return `${sign}${(abs / 1e9).toFixed(2)}B`;
}

const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** US dollars: $x.xx from $1, $x.xxx below it, $0.00 for nothing. */
export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0.00';
  const abs = Math.abs(value);
  if (Number(abs.toFixed(3)) >= 1) return usd2.format(value);
  return `${value < 0 ? '-' : ''}$${abs.toFixed(3)}`;
}

/** Splits minutes into whole hours and minutes for display. */
export function durationParts(minutes: number): { hours: number; minutes: number } {
  const total = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export const totalTokens = (row: TokenCounts): number =>
  row.input + row.output + row.cacheRead + row.cacheWrite;

const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Rounds a maximum up to a readable axis top that splits into `ticks` round steps
 * (e.g. 230K over 4 ticks → 240K: 60K, 120K, 180K, 240K).
 */
export function niceMax(value: number, ticks = 1): number {
  if (!Number.isFinite(value) || value <= 0) return ticks;
  const raw = value / ticks;
  const exponent = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE_STEPS.find((item) => raw <= item * exponent + 1e-9) ?? 10) * exponent;
  return Number((step * ticks).toPrecision(12));
}

/** Fraction of a bar for a value; never NaN. */
export const share = (value: number, max: number): number =>
  max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

/* ---------- Tables ---------- */

export type SortDirection = 'asc' | 'desc';

export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => string | number,
  direction: SortDirection
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
    return String(left).localeCompare(String(right)) * factor;
  });
}

export const pageCount = (total: number, size: number): number =>
  Math.max(1, Math.ceil(total / Math.max(1, size)));

export function pageSlice<T>(rows: readonly T[], page: number, size: number): T[] {
  const last = pageCount(rows.length, size) - 1;
  const index = Math.max(0, Math.min(page, last));
  return rows.slice(index * size, index * size + size);
}

/* ---------- CSV ---------- */

const csvCell = (value: string | number): string => {
  // Text that a spreadsheet would read as a formula (session topics are free text) gets a
  // leading apostrophe so it stays text.
  const text =
    typeof value === 'number'
      ? Number.isFinite(value)
        ? String(value)
        : ''
      : /^[=+@\t\r]/.test(value)
        ? `'${value}`
        : value;
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** RFC 4180 CSV with CRLF line endings. */
export const toCsv = (header: string[], rows: Array<Array<string | number>>): string =>
  [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Rounds dollars for export without float noise. */
export const csvCost = (value: number): number => Math.round(value * 1e6) / 1e6;

/** Last path segment of a project directory, for compact labels. */
export const projectName = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

/** Drops the "claude-" prefix for narrow table cells; the full id stays in the tooltip. */
export const shortModel = (model: string): string => model.replace(/^claude-/, '');
