import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DailyBarChart } from '@/features/claudeUsage/components/DailyBarChart';
import { formatTokens } from '@/features/claudeUsage/logic';
import type { HistoryPoint } from './logic';

/** Daily token bars for client keys, drawn like the Claude usage daily chart. */
export function UsageHistoryChart({ points }: { points: HistoryPoint[] }) {
  const { t, i18n } = useTranslation();
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const total = points.reduce((sum, item) => sum + item.tokens, 0);

  return (
    <DailyBarChart
      days={points.map((item) => item.day)}
      series={[
        {
          key: 'tokens',
          label: t('access_keys.history.tokens'),
          values: points.map((item) => item.tokens),
        },
      ]}
      summary={t('access_keys.history.chart_summary', {
        days: points.length,
        tokens: formatTokens(total),
      })}
      keysHint={t('access_keys.history.chart_keys')}
      extraRows={(index) => [
        [t('access_keys.history.requests'), numberFormat.format(points[index]?.requests ?? 0)],
      ]}
    />
  );
}
