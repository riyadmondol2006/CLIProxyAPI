import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { formatTokens } from '@/features/claudeUsage/logic';
import { KEY_USAGE_HISTORY_DAYS, type KeyUsageHistory } from '@/services/api/accessKeys';
import { HISTORY_ALL_KEYS, historyPoints, sumLastDays, type UsageTotal } from './logic';
import { UsageHistoryChart } from './UsageHistoryChart';
import styles from './AccessKeysPage.module.scss';

const TOTAL_WINDOWS = [
  { days: 1, label: 'access_keys.history.today' },
  { days: 7, label: 'access_keys.history.last_7_days' },
  { days: 30, label: 'access_keys.history.last_30_days' },
] as const;

interface UsageHistorySectionProps {
  /** History of the configured keys; null when the server could not provide it. */
  history: KeyUsageHistory | null;
  loading: boolean;
  /** Display label for a key: its name, or the masked key. */
  labelFor: (apiKey: string) => string;
}

export function UsageHistorySection({ history, loading, labelFor }: UsageHistorySectionProps) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState(HISTORY_ALL_KEYS);
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const entries = history?.keys ?? [];
  // A deleted key falls back to the summed view.
  const selected = entries.some((entry) => entry.apiKey === filter) ? filter : HISTORY_ALL_KEYS;
  const points = useMemo(
    () => (history ? historyPoints(history, selected) : []),
    [history, selected]
  );
  const days = history?.dates.length || KEY_USAGE_HISTORY_DAYS;
  const hasUsage = points.some((point) => point.tokens > 0 || point.requests > 0);

  const totalCells = (total: (days: number) => UsageTotal) =>
    TOTAL_WINDOWS.map((range) => {
      const value = total(range.days);
      return (
        <td key={range.days}>
          <span className={styles.totalTokens}>{formatTokens(value.tokens)}</span>
          <span className={styles.totalRequests}>
            {t('access_keys.history.requests_short', {
              value: numberFormat.format(value.requests),
            })}
          </span>
        </td>
      );
    });

  const renderBody = () => {
    if (loading) return <p className={styles.cardText}>{t('common.loading')}</p>;
    if (!history) return <p className={styles.cardText}>{t('access_keys.history.unavailable')}</p>;
    if (entries.length === 0) return null;
    const allPoints =
      selected === HISTORY_ALL_KEYS ? points : historyPoints(history, HISTORY_ALL_KEYS);
    return (
      <>
        {hasUsage ? (
          <UsageHistoryChart points={points} />
        ) : (
          <p className={styles.cardText}>{t('access_keys.history.empty', { days })}</p>
        )}
        <div className={styles.totalsScroll}>
          <table className={styles.totalsTable}>
            <caption className={styles.visuallyHidden}>
              {t('access_keys.history.totals_label')}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('access_keys.history.key')}</th>
                {TOTAL_WINDOWS.map((range) => (
                  <th key={range.days} scope="col">
                    {t(range.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const keyPoints = historyPoints(history, entry.apiKey);
                return (
                  <tr key={entry.apiKey}>
                    <th scope="row">{labelFor(entry.apiKey)}</th>
                    {totalCells((windowDays) => sumLastDays(keyPoints, windowDays))}
                  </tr>
                );
              })}
            </tbody>
            {entries.length > 1 ? (
              <tfoot>
                <tr>
                  <th scope="row">{t('access_keys.history.all_keys')}</th>
                  {totalCells((windowDays) => sumLastDays(allPoints, windowDays))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </>
    );
  };

  return (
    <section className={styles.card} aria-labelledby="access-history-title">
      <div className={styles.historyHead}>
        <div className={styles.headerText}>
          <h2 id="access-history-title" className={styles.cardTitle}>
            {t('access_keys.history.title')}
          </h2>
          <p className={styles.hint}>{t('access_keys.history.subtitle', { days })}</p>
        </div>
        {!loading && entries.length > 1 ? (
          <Select
            className={styles.historyFilter}
            size="sm"
            value={selected}
            options={[
              { value: HISTORY_ALL_KEYS, label: t('access_keys.history.all_keys') },
              ...entries.map((entry) => ({ value: entry.apiKey, label: labelFor(entry.apiKey) })),
            ]}
            onChange={setFilter}
            ariaLabel={t('access_keys.history.filter_label')}
          />
        ) : null}
      </div>
      {renderBody()}
    </section>
  );
}
