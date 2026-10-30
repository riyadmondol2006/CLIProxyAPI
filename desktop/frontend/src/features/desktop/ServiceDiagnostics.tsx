import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconAlertTriangle } from '@/components/ui/icons';
import { CopyButton } from '@/features/oauth/components/CopyButton';
import type { DesktopDiagnostics } from '@/utils/desktop';
import { describeHints, diagnosticsSummary, SERVICE_LOG_COMMAND } from './diagnosticsLogic';
import styles from './ServiceDiagnostics.module.scss';

export interface ServiceDiagnosticsViewProps {
  diagnostics: DesktopDiagnostics | null;
  loading: boolean;
  error: string;
  /** When the diagnostics were loaded (ms); decides whether times show a date. */
  now: number;
  onRefresh: () => void;
}

/** Why the service is down: a summary, likely causes with fixes, and the service log. */
export function ServiceDiagnosticsView({
  diagnostics,
  loading,
  error,
  now,
  onRefresh,
}: ServiceDiagnosticsViewProps) {
  const { t, i18n } = useTranslation();
  const summary = diagnostics
    ? diagnosticsSummary(diagnostics, now, i18n.language)
        .map((part) => t(`desktop.diagnostics.summary.${part.key}`, part.values))
        .join(' · ')
    : '';
  const headline =
    summary ||
    (error
      ? t('desktop.diagnostics.load_failed')
      : !diagnostics
        ? t('desktop.diagnostics.loading')
        : !diagnostics.available
          ? t('desktop.diagnostics.unavailable')
          : '');
  const hints = diagnostics ? describeHints(diagnostics) : [];
  const log = diagnostics?.log;
  const logText = log?.lines.join('\n') ?? '';

  return (
    <section
      className={styles.diagnostics}
      aria-label={t('desktop.diagnostics.title')}
      aria-busy={loading}
    >
      <div className={styles.diagHeader}>
        <p className={styles.diagSummary} aria-live="polite">
          {headline}
        </p>
        <Button variant="ghost" size="sm" onClick={onRefresh} loading={loading}>
          {t('desktop.diagnostics.refresh')}
        </Button>
      </div>

      {hints.length > 0 ? (
        <ul className={styles.hintList}>
          {hints.map((hint) => (
            <li key={hint.code} className={styles.hintItem}>
              <IconAlertTriangle size={16} className={styles.hintIcon} aria-hidden="true" />
              <div className={styles.hintBody}>
                <p className={styles.hintTitle}>{t(hint.titleKey, hint.values)}</p>
                <p className={styles.hintFix}>{t(hint.fixKey, hint.values)}</p>
                {hint.detail ? <code className={styles.hintDetail}>{hint.detail}</code> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {log?.available ? (
        <details className={styles.logPanel}>
          <summary className={styles.logToggle}>{t('desktop.diagnostics.log_title')}</summary>
          {log.lines.length > 0 ? (
            <div className={styles.logBody}>
              <div className={styles.logToolbar}>
                <span className={styles.diagMuted}>
                  {log.truncated
                    ? t('desktop.diagnostics.log_truncated')
                    : t('desktop.diagnostics.log_redacted')}
                </span>
                <CopyButton value={logText} label={t('desktop.diagnostics.copy_log')} showLabel />
              </div>
              <pre className={styles.logBox} tabIndex={0}>
                {logText}
              </pre>
            </div>
          ) : (
            <p className={styles.diagMuted}>{t('desktop.diagnostics.log_empty')}</p>
          )}
        </details>
      ) : diagnostics || error ? (
        <div className={styles.logFallback}>
          <p className={styles.diagMuted}>{t('desktop.diagnostics.log_command')}</p>
          <pre className={styles.command}>{SERVICE_LOG_COMMAND}</pre>
        </div>
      ) : null}
    </section>
  );
}
