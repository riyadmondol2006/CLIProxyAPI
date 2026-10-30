import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { DailyBarChart } from '@/features/claudeUsage/components/DailyBarChart';
import { DataTable, type Column } from '@/features/claudeUsage/components/DataTable';
import chartStyles from '@/features/claudeUsage/components/charts.module.scss';
import { formatTokens } from '@/features/claudeUsage/logic';
import { providerLabel } from '@/features/dashboard/utils';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import type { TokenUsage } from '@/services/api/tokenUsage';
import { useAuthStore } from '@/stores';
import { isDesktopApp } from '@/utils/desktop';
import {
  DEFAULT_GROUP_BY,
  DEFAULT_PERIOD,
  GROUP_BYS,
  OTHER_SERIES,
  TOP_GROUPS,
  USAGE_PERIODS,
  buildUsageView,
  countDimensions,
  hasUsage,
  slicePeriod,
  type GroupBy,
  type GroupLabels,
  type UsageGroup,
  type UsagePeriod,
} from './logic';
import { useTokenUsage } from './useTokenUsage';
import styles from './ApiUsagePage.module.scss';

const PAGE_SIZE = 25;

/** Route entry: one data loader per connection, so a new connection starts empty. */
export function ApiUsagePage() {
  const apiBase = useAuthStore((state) => state.apiBase);
  return <ApiUsageScreen key={apiBase} />;
}

function ApiUsageScreen() {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const { usage, loading, error, updatedAt, reload } = useTokenUsage(connected);
  useHeaderRefresh(reload, connected);
  const [period, setPeriod] = useState<UsagePeriod>(DEFAULT_PERIOD);
  const [groupBy, setGroupBy] = useState<GroupBy>(DEFAULT_GROUP_BY);

  return (
    <ApiUsageView
      usage={usage}
      loading={loading}
      error={error}
      updatedAt={updatedAt}
      period={period}
      groupBy={groupBy}
      onPeriodChange={setPeriod}
      onGroupByChange={setGroupBy}
      onRetry={() => void reload()}
      claudeUsageAvailable={isDesktopApp()}
    />
  );
}

export interface ApiUsageViewProps {
  usage: TokenUsage | null;
  loading: boolean;
  /** Null when the last load worked; otherwise the server's message, possibly empty. */
  error: string | null;
  updatedAt: number | null;
  period: UsagePeriod;
  groupBy: GroupBy;
  onPeriodChange: (period: UsagePeriod) => void;
  onGroupByChange: (groupBy: GroupBy) => void;
  onRetry: () => void;
  /** The Claude usage page exists only in the desktop app. */
  claudeUsageAvailable: boolean;
}

/** The page itself, driven entirely by props so it can be rendered in tests. */
export function ApiUsageView({
  usage,
  loading,
  error,
  updatedAt,
  period,
  groupBy,
  onPeriodChange,
  onGroupByChange,
  onRetry,
  claudeUsageAvailable,
}: ApiUsageViewProps) {
  const { t, i18n } = useTranslation();
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const percentFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }),
    [i18n.language]
  );
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }),
    [i18n.language]
  );

  const labels: GroupLabels = useMemo(
    () => ({
      unknownProvider: t('api_usage.labels.unknown_provider'),
      unknownModel: t('api_usage.labels.unknown_model'),
      unknownAccount: t('api_usage.labels.unknown_account'),
      removedKeys: t('api_usage.labels.removed_keys'),
      otherClients: t('api_usage.labels.other_clients'),
      other: t('api_usage.labels.other'),
    }),
    [t]
  );
  const view = useMemo(
    () => (usage ? buildUsageView(usage, period, groupBy, labels) : null),
    [usage, period, groupBy, labels]
  );
  const counts = useMemo(
    () => (usage ? countDimensions(slicePeriod(usage, period), labels) : null),
    [usage, period, labels]
  );

  const formatShare = (value: number) =>
    value > 0 && value < 0.001 ? `<${percentFormat.format(0.001)}` : percentFormat.format(value);
  const tokenCell = (value: number) => (
    <span title={numberFormat.format(value)}>{formatTokens(value)}</span>
  );
  const periodText = t(`api_usage.period_long.${period}`);

  /* ---------- Table ---------- */

  const showBadges = groupBy === 'account' || groupBy === 'model';
  const columns: Column<UsageGroup>[] = [
    {
      id: 'group',
      label: t(`api_usage.groups.${groupBy}`),
      grow: true,
      sortValue: (group) => group.label.toLowerCase(),
      render: (group) => (
        <span className={styles.groupCell}>
          <span
            className={`${chartStyles.swatch} ${chartStyles.fillTone}`}
            data-tone={group.totals.tokens > 0 ? group.tone : OTHER_SERIES}
            aria-hidden="true"
          />
          <span className={styles.groupText}>
            <span
              className={styles.groupName}
              data-placeholder={group.placeholder || undefined}
              data-mono={(groupBy === 'model' && !group.placeholder) || undefined}
              title={group.label}
            >
              {group.label}
            </span>
            {group.detail ? <code className={styles.groupDetail}>{group.detail}</code> : null}
          </span>
          {showBadges
            ? group.providers.map((provider) => (
                <span key={provider} className={styles.badge}>
                  {providerLabel(provider, labels.unknownProvider)}
                </span>
              ))
            : null}
        </span>
      ),
    },
    {
      id: 'requests',
      label: t('api_usage.columns.requests'),
      numeric: true,
      sortValue: (group) => group.totals.requests,
      render: (group) => (
        <>
          {numberFormat.format(group.totals.requests)}
          {group.totals.failed > 0 ? (
            <span className={styles.failedNote}>
              {t('api_usage.columns.failed', {
                value: numberFormat.format(group.totals.failed),
              })}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'input',
      label: t('api_usage.columns.input'),
      numeric: true,
      sortValue: (group) => group.totals.input,
      render: (group) => tokenCell(group.totals.input),
    },
    {
      id: 'output',
      label: t('api_usage.columns.output'),
      numeric: true,
      sortValue: (group) => group.totals.output,
      render: (group) => tokenCell(group.totals.output),
    },
    {
      id: 'total',
      label: t('api_usage.columns.total'),
      numeric: true,
      sortValue: (group) => group.totals.tokens,
      render: (group) => <strong>{tokenCell(group.totals.tokens)}</strong>,
    },
    {
      id: 'share',
      label: t('api_usage.columns.share'),
      numeric: true,
      sortValue: (group) => group.share,
      render: (group) => (
        <span className={styles.shareCell}>
          <span className={styles.shareTrack} aria-hidden="true">
            <span className={styles.shareFill} style={{ width: `${group.share * 100}%` }} />
          </span>
          <span className={styles.shareValue}>{formatShare(group.share)}</span>
        </span>
      ),
    },
  ];

  /* ---------- Sections ---------- */

  const tile = (label: string, value: string, options: { title?: string; hint?: ReactNode }) => (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue} title={options.title}>
        {value}
      </span>
      {options.hint ? <span className={styles.tileHint}>{options.hint}</span> : null}
    </div>
  );

  const renderContent = (current: NonNullable<typeof view>) => {
    const { totals } = current;
    const hasOther = current.series.some((item) => item.tone === OTHER_SERIES);
    return (
      <>
        <section className={styles.stats} aria-label={t('api_usage.tiles.label')}>
          <div className={styles.heroTile}>
            <span className={styles.tileLabel}>{t('api_usage.tiles.tokens')}</span>
            <span className={styles.heroValue} title={numberFormat.format(totals.tokens)}>
              {formatTokens(totals.tokens)}
            </span>
            <span className={styles.tileHint}>{periodText}</span>
          </div>
          <div className={styles.tileRow}>
            {tile(t('api_usage.tiles.input'), formatTokens(totals.input), {
              title: numberFormat.format(totals.input),
            })}
            {tile(t('api_usage.tiles.output'), formatTokens(totals.output), {
              title: numberFormat.format(totals.output),
            })}
            {tile(t('api_usage.tiles.requests'), numberFormat.format(totals.requests), {
              hint:
                totals.failed > 0 ? (
                  <span className={styles.warnText}>
                    {t('api_usage.tiles.failed', { value: numberFormat.format(totals.failed) })}
                  </span>
                ) : (
                  t('api_usage.tiles.no_failed')
                ),
            })}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="api-usage-daily">
          <div className={styles.cardHeading}>
            <h2 id="api-usage-daily" className={styles.sectionTitle}>
              {t('api_usage.chart.title')}
            </h2>
            <p className={styles.cardSubtitle}>
              {t(`api_usage.chart.by.${groupBy}`)}
              {hasOther ? ` ${t('api_usage.chart.other_note', { top: TOP_GROUPS })}` : ''}
            </p>
          </div>
          <DailyBarChart
            days={current.dates}
            series={current.series}
            summary={t('api_usage.chart.summary', {
              period: periodText,
              tokens: formatTokens(totals.tokens),
            })}
            keysHint={t('api_usage.chart.keys')}
            totalLabel={t('api_usage.chart.total')}
            extraRows={(index) => [
              [
                t('api_usage.columns.requests'),
                numberFormat.format(current.dailyRequests[index] ?? 0),
              ],
            ]}
          />
        </section>

        <section className={styles.card} aria-labelledby="api-usage-table">
          <div className={styles.cardHeading}>
            <h2 id="api-usage-table" className={styles.sectionTitle}>
              {t(`api_usage.table.${groupBy}`)}
            </h2>
            <p className={styles.cardSubtitle}>{t('api_usage.table.subtitle')}</p>
          </div>
          <DataTable
            key={groupBy}
            caption={t(`api_usage.table.${groupBy}`)}
            columns={columns}
            rows={current.groups}
            rowKey={(group) => group.id}
            defaultSort={{ id: 'total', direction: 'desc' }}
            pageSize={PAGE_SIZE}
          />
        </section>
      </>
    );
  };

  const anyUsage = usage ? hasUsage(usage) : false;
  const periodHasUsage = Boolean(view && (view.totals.tokens > 0 || view.totals.requests > 0));

  let body: ReactNode = null;
  if (view && periodHasUsage) {
    body = renderContent(view);
  } else if (usage && anyUsage) {
    body = (
      <EmptyState
        title={t('api_usage.empty.period_title')}
        description={t('api_usage.empty.period_text', { period: periodText })}
        action={
          period !== '90d' ? (
            <Button size="sm" variant="secondary" onClick={() => onPeriodChange('90d')}>
              {t('api_usage.empty.show_90d')}
            </Button>
          ) : undefined
        }
      />
    );
  } else if (usage) {
    body = (
      <EmptyState
        title={t('api_usage.empty.title')}
        description={
          claudeUsageAvailable
            ? `${t('api_usage.empty.text')} ${t('api_usage.empty.claude_hint')}`
            : t('api_usage.empty.text')
        }
        action={
          claudeUsageAvailable ? (
            <Link
              to="/claude-usage"
              className={['btn btn-secondary btn-sm', styles.emptyLink].filter(Boolean).join(' ')}
            >
              {t('api_usage.empty.open_claude')}
            </Link>
          ) : undefined
        }
      />
    );
  } else if (loading) {
    body = (
      <div className={styles.loadingBlock} aria-busy="true">
        <span className={styles.srOnly}>{t('common.loading')}</span>
        <div className={styles.stats}>
          <Skeleton height={124} rounded={16} />
          <div className={styles.tileRow}>
            <Skeleton height={124} rounded={14} />
            <Skeleton height={124} rounded={14} />
            <Skeleton height={124} rounded={14} />
          </div>
        </div>
        <Skeleton height={300} rounded={16} />
      </div>
    );
  }

  const updated = updatedAt ? timeFormat.format(new Date(updatedAt)) : '';

  return (
    <div className={styles.page} data-loading={(loading && usage !== null) || undefined}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{t('api_usage.title')}</h1>
          <p className={styles.meta}>
            {t('api_usage.meta', {
              providers: counts ? numberFormat.format(counts.providers) : '—',
              accounts: counts ? numberFormat.format(counts.accounts) : '—',
              models: counts ? numberFormat.format(counts.models) : '—',
            })}
            {updated ? (
              <>
                <span className={styles.metaSep} aria-hidden="true">
                  ·
                </span>
                {t('api_usage.updated', { time: updated })}
              </>
            ) : null}
          </p>
          <p className={styles.lede}>{t('api_usage.lede')}</p>
        </div>
      </header>

      <section className={styles.controls} aria-label={t('api_usage.controls_label')}>
        <div className={styles.control}>
          <span className={styles.controlLabel} aria-hidden="true">
            {t('api_usage.period_label')}
          </span>
          <SegmentedControl
            label={t('api_usage.period_label')}
            value={period}
            options={USAGE_PERIODS.map((value) => ({
              value,
              label: t(`api_usage.periods.${value}`),
            }))}
            onChange={onPeriodChange}
          />
        </div>
        <div className={styles.control}>
          <span className={styles.controlLabel} aria-hidden="true">
            {t('api_usage.group_label')}
          </span>
          <SegmentedControl
            label={t('api_usage.group_label')}
            value={groupBy}
            options={GROUP_BYS.map((value) => ({ value, label: t(`api_usage.groups.${value}`) }))}
            onChange={onGroupByChange}
          />
        </div>
      </section>

      {error !== null ? (
        <div className={styles.errorCard} role="alert">
          <div className={styles.errorText}>
            <strong>{t('api_usage.error.title')}</strong>
            <span>{t('api_usage.error.text')}</span>
            {error ? <code className={styles.errorDetail}>{error}</code> : null}
          </div>
          <Button size="sm" variant="secondary" onClick={onRetry} loading={loading}>
            {t('api_usage.error.retry')}
          </Button>
        </div>
      ) : null}

      {body}
    </div>
  );
}
