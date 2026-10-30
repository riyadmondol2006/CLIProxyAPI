import type { DesktopUpdateInfo } from '@/utils/desktop';

/** localStorage key: 'false' turns off scheduled checks; anything else (or nothing) is on. */
export const UPDATE_AUTO_CHECK_KEY = 'cpa.update.autoCheck';
/** localStorage key: the version the user chose to skip. */
export const UPDATE_SKIPPED_KEY = 'cpa.update.skipped';

/** The first scheduled check waits a little so it doesn't compete with startup. */
export const FIRST_CHECK_DELAY_MS = 15_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MAX_NOTES = 10;

/**
 * Why a check runs: `auto` is the schedule, `manual` is "Check now" (forced, and it
 * shows a found update even if skipped), `silent` only refreshes the Home section.
 */
export type UpdateCheckKind = 'auto' | 'manual' | 'silent';

/** Scheduled checks run only when enabled, and never once the app says it's a dev build. */
export const shouldAutoCheck = (autoCheck: boolean, last: DesktopUpdateInfo | null): boolean =>
  autoCheck && last?.devBuild !== true;

export interface UpdatePopupInput {
  info: DesktopUpdateInfo | null;
  kind: UpdateCheckKind;
  autoCheck: boolean;
  skipped: string;
}

/** Whether a finished check should open the update popup. */
export function shouldShowUpdatePopup({
  info,
  kind,
  autoCheck,
  skipped,
}: UpdatePopupInput): boolean {
  if (!info || info.devBuild || !info.available || !info.latest) return false;
  if (kind === 'manual') return true;
  if (kind === 'silent' || !autoCheck) return false;
  return info.latest !== skipped;
}

export const visibleNotes = (notes: string[]): { shown: string[]; more: boolean } => ({
  shown: notes.slice(0, MAX_NOTES),
  more: notes.length > MAX_NOTES,
});

/** Intl throws on a malformed locale; fall back to the runtime default instead. */
function withLocale<T>(locale: string, build: (locale: string | undefined) => T): T {
  try {
    return build(locale || undefined);
  } catch {
    return build(undefined);
  }
}

/** Megabytes with one decimal, in the given locale ("30.0"). '' when unknown. */
export const formatPackageSize = (bytes: number, locale: string): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return withLocale(locale, (lng) =>
    new Intl.NumberFormat(lng, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
      bytes / (1024 * 1024)
    )
  );
};

/** A calendar date ("Oct 30, 2026"), or '' for a missing or invalid timestamp. */
export const formatReleaseDate = (iso: string, locale: string): string => {
  const ms = Date.parse(iso);
  if (!iso || !Number.isFinite(ms)) return '';
  return withLocale(locale, (lng) =>
    new Intl.DateTimeFormat(lng, { dateStyle: 'medium' }).format(ms)
  );
};

export type CheckedAt = { justNow: true } | { justNow: false; text: string };

/**
 * When the last check ran: "just now" under a minute, relative within a day
 * ("5 minutes ago"), then an absolute date and time. Null when never checked.
 */
export function describeCheckedAt(iso: string, nowMs: number, locale: string): CheckedAt | null {
  const ms = Date.parse(iso);
  if (!iso || !Number.isFinite(ms)) return null;
  const elapsed = nowMs - ms;
  if (elapsed < 60_000) return { justNow: true };
  if (elapsed < 24 * 60 * 60_000) {
    const hours = Math.floor(elapsed / (60 * 60_000));
    const text = withLocale(locale, (lng) => {
      const format = new Intl.RelativeTimeFormat(lng, { numeric: 'always' });
      return hours >= 1
        ? format.format(-hours, 'hour')
        : format.format(-Math.floor(elapsed / 60_000), 'minute');
    });
    return { justNow: false, text };
  }
  const text = withLocale(locale, (lng) =>
    new Intl.DateTimeFormat(lng, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
  );
  return { justNow: false, text };
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const readItem = (key: string): string | null => {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writeItem = (key: string, value: string) => {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Storage full or blocked: the choice only lasts for this session.
  }
};

export const readAutoCheck = (): boolean => readItem(UPDATE_AUTO_CHECK_KEY) !== 'false';
export const writeAutoCheck = (enabled: boolean) =>
  writeItem(UPDATE_AUTO_CHECK_KEY, enabled ? 'true' : 'false');
export const readSkippedVersion = (): string => readItem(UPDATE_SKIPPED_KEY) ?? '';
export const writeSkippedVersion = (version: string) => writeItem(UPDATE_SKIPPED_KEY, version);
