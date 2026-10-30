import type { DesktopDiagnostics } from '@/utils/desktop';

/** Shown when the app can't read the service log itself. */
export const SERVICE_LOG_COMMAND = 'journalctl --user -u cliproxyapi -n 50';

/** Gate states that load diagnostics: the service is down or never wrote its token. */
export const DIAGNOSTIC_STATES: readonly string[] = ['failed', 'stopped', 'no_token'];

/** One piece of the summary line: a key under `desktop.diagnostics.summary` and its values. */
export interface SummaryPart {
  key: string;
  values: Record<string, string | number>;
}

const SIGNALS: Record<number, string> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  4: 'SIGILL',
  6: 'SIGABRT',
  7: 'SIGBUS',
  8: 'SIGFPE',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  13: 'SIGPIPE',
  15: 'SIGTERM',
};

export const signalName = (signal: number): string => SIGNALS[signal] ?? String(signal);

/** Intl throws on a malformed locale; fall back to the runtime default instead. */
function withLocale<T>(locale: string, build: (locale: string | undefined) => T): T {
  try {
    return build(locale || undefined);
  } catch {
    return build(undefined);
  }
}

/** The time alone when it was today ("14:02"), otherwise date and time. '' when unknown. */
export function formatEventTime(iso: string, nowMs: number, locale: string): string {
  const ms = Date.parse(iso);
  if (!iso || !Number.isFinite(ms)) return '';
  const sameDay = new Date(ms).toDateString() === new Date(nowMs).toDateString();
  return withLocale(locale, (lng) =>
    new Intl.DateTimeFormat(
      lng,
      sameDay ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }
    ).format(ms)
  );
}

/**
 * The parts of the one-line summary, e.g. "Exited with status 1 at 14:02" and
 * "restarted 5 times". Empty when systemd couldn't be asked.
 */
export function diagnosticsSummary(
  diagnostics: DesktopDiagnostics,
  nowMs: number,
  locale: string
): SummaryPart[] {
  if (!diagnostics.available) return [];
  const { unit } = diagnostics;
  const time = formatEventTime(unit.changedAt, nowMs, locale);
  const event = (key: string, values: Record<string, string | number> = {}): SummaryPart =>
    time ? { key: `${key}_at`, values: { ...values, time } } : { key, values };

  const parts: SummaryPart[] = [];
  if (unit.activeState === 'active') parts.push(event('running'));
  else if (unit.exitCode === 'exited')
    parts.push(
      unit.exitStatus === 0 ? event('exited_ok') : event('exited', { status: unit.exitStatus })
    );
  else if (unit.exitCode === 'killed')
    parts.push(event('killed', { signal: signalName(unit.exitStatus) }));
  else if (unit.exitCode === 'dumped')
    parts.push(event('dumped', { signal: signalName(unit.exitStatus) }));
  // systemd forgets the exit details of a unit that stopped cleanly, so only an empty
  // journal shows that it really hasn't run.
  else if (unit.activeState === 'inactive' && diagnostics.log.lines.length === 0)
    parts.push({ key: 'not_run', values: {} });
  if (unit.restarts > 0) parts.push({ key: 'restarts', values: { count: unit.restarts } });
  return parts;
}

export const HINT_CODES = [
  'port_in_use',
  'address_unavailable',
  'config_invalid',
  'permission_denied',
  'token_not_written',
  'program_missing',
  'crash_loop',
] as const;

export type HintCode = (typeof HINT_CODES)[number];

/** A hint ready to render: translation keys, their values, and an optional raw detail. */
export interface HintView {
  code: HintCode;
  titleKey: string;
  fixKey: string;
  values: Record<string, string | number>;
  /** An error message or path shown in monospace under the fix; '' for none. */
  detail: string;
}

const isHintCode = (code: string): code is HintCode =>
  (HINT_CODES as readonly string[]).includes(code);

/** Hints the UI knows how to explain, in the backend's order; unknown codes are skipped. */
export function describeHints(diagnostics: DesktopDiagnostics): HintView[] {
  return diagnostics.hints.flatMap((hint): HintView[] => {
    if (!isHintCode(hint.code)) return [];
    const base = `desktop.diagnostics.hints.${hint.code}`;
    const view: HintView = {
      code: hint.code,
      titleKey: `${base}.title`,
      fixKey: `${base}.fix`,
      values: {},
      detail: hint.detail,
    };
    switch (hint.code) {
      case 'port_in_use': {
        const port = Number(hint.detail.match(/:(\d+)$/)?.[1]) || diagnostics.port;
        return [{ ...view, values: { port }, detail: '' }];
      }
      case 'address_unavailable': {
        const address = hint.detail || `${diagnostics.host || '0.0.0.0'}:${diagnostics.port}`;
        return [{ ...view, values: { address }, detail: '' }];
      }
      case 'config_invalid':
        return hint.configLine > 0
          ? [{ ...view, fixKey: `${base}.fix_line`, values: { line: hint.configLine } }]
          : [view];
      case 'crash_loop':
        return [{ ...view, detail: '' }];
      default:
        return [view];
    }
  });
}
