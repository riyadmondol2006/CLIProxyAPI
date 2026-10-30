import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconDownload, IconRefreshCw } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { downloadBlob } from '@/utils/download';
import { formatFileSize } from '@/utils/format';
import type {
  BranchRow,
  ClaudeUsageData,
  ClaudeUsageStatus,
  DispatchRow,
  ModelRow,
  ProjectRow,
  SessionRow,
  SubagentRow,
} from './api';
import {
  RANGE_KEYS,
  buildViewSearch,
  computeRange,
  csvCost,
  durationParts,
  formatCost,
  formatTokens,
  parseLocalDay,
  parseModelList,
  parseRangeKey,
  projectName,
  shortModel,
  rangeIncludesToday,
  share,
  toCsv,
  toLocalDay,
  toggleModel,
  totalTokens,
  type RangeKey,
} from './logic';
import { useClaudeUsage } from './useClaudeUsage';
import { BarList } from './components/BarList';
import { DailyChart, type DailyMode } from './components/DailyChart';
import { DataTable, type Column } from './components/DataTable';
import { HourlyChart } from './components/HourlyChart';
import styles from './ClaudeUsagePage.module.scss';

const PAGE_SIZE = 25;
const TOP_PROJECTS = 10;

/** Route entry: keeps the range and model filter in the URL and loads the data. */
export function ClaudeUsagePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = parseRangeKey(searchParams.get('range'));
  const modelsParam = searchParams.get('models');
  const models = useMemo(() => parseModelList(modelsParam), [modelsParam]);
  const today = toLocalDay(new Date(useNow()));
  // Recomputed when the local date changes, so the window rolls over at midnight.
  const dayRange = useMemo(
    () => computeRange(range, parseLocalDay(today) ?? new Date()),
    [range, today]
  );

  const usage = useClaudeUsage({
    range: dayRange,
    models,
    live: rangeIncludesToday(dayRange, new Date()),
  });
  useHeaderRefresh(usage.rescan);

  const setView = useCallback(
    (view: { range: RangeKey; models: string[] }) =>
      setSearchParams((current) => buildViewSearch(current, view), { replace: true }),
    [setSearchParams]
  );

  return (
    <ClaudeUsageView
      status={usage.status}
      data={usage.data}
      loading={usage.loading}
      error={usage.error}
      showProgress={usage.showProgress}
      range={range}
      models={models}
      onRangeChange={(next) => setView({ range: next, models })}
      onModelsChange={(next) => setView({ range, models: next })}
      onRescan={() => void usage.rescan()}
    />
  );
}

export interface ClaudeUsageViewProps {
  status: ClaudeUsageStatus | null;
  data: ClaudeUsageData | null;
  loading: boolean;
  error: string;
  showProgress: boolean;
  range: RangeKey;
  models: string[];
  onRangeChange: (range: RangeKey) => void;
  onModelsChange: (models: string[]) => void;
  onRescan: () => void;
}

/** The page itself, driven entirely by props so it can be rendered in tests. */
export function ClaudeUsageView({
  status,
  data,
  loading,
  error,
  showProgress,
  range,
  models,
  onRangeChange,
  onModelsChange,
  onRescan,
}: ClaudeUsageViewProps) {
  const { t, i18n } = useTranslation();
  const [dailyMode, setDailyMode] = useState<DailyMode>('io');
  const [modelMetric, setModelMetric] = useState<'cost' | 'tokens'>('cost');

  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const dateTimeFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language]
  );
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }),
    [i18n.language]
  );

  const shortFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    [i18n.language]
  );

  /** Compact local date and time for table cells; the year only when it isn't this one. */
  const formatDateTime = (value: string) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return date.getFullYear() === new Date().getFullYear()
      ? shortFormat.format(date)
      : dateTimeFormat.format(date);
  };
  const formatUpdated = (value: string) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return toLocalDay(date) === toLocalDay(new Date())
      ? timeFormat.format(date)
      : dateTimeFormat.format(date);
  };
  const formatMinutes = (minutes: number) => {
    const parts = durationParts(minutes);
    if (parts.hours > 0) return t('claude_usage.duration_hm', parts);
    if (minutes > 0 && parts.minutes === 0) return t('claude_usage.duration_lt_minute');
    return t('claude_usage.duration_m', parts);
  };
  const formatMs = (ms: number) =>
    ms > 0 && ms < 60_000
      ? t('claude_usage.duration_s', { seconds: Math.max(1, Math.round(ms / 1000)) })
      : formatMinutes(ms / 60_000);
  const costText = (cost: number, priced = true) =>
    priced ? formatCost(cost) : t('claude_usage.na');
  const tokenCell = (value: number) => (
    <span title={numberFormat.format(value)}>{formatTokens(value)}</span>
  );

  const scanning = status?.scanning === true;
  const firstScan = scanning && !status?.lastScanAt;
  const updatedAt = formatUpdated(status ? status.lastScanAt : (data?.generatedAt ?? ''));
  const noSources =
    status !== null && !scanning && status.sources.length === 0 && status.turns === 0;
  const totals = data?.totals;
  const hasData = Boolean(data && totals && totals.turns > 0);

  const modelOptions = useMemo(() => {
    const list = data?.models ?? [];
    const known = new Set(list.map((item) => item.model));
    // Keep a selected model visible even when it has no usage in this range.
    const extra = models
      .filter((model) => !known.has(model))
      .map((model) => ({ model, turns: 0, tokens: 0, priced: true }));
    return [...list, ...extra];
  }, [data?.models, models]);
  const availableModels = (data?.models ?? []).map((item) => item.model);
  const pricedByModel = useMemo(
    () => new Map((data?.models ?? []).map((item) => [item.model, item.priced])),
    [data?.models]
  );

  /* ---------- CSV ---------- */

  const exportCsv = (name: string, header: string[], rows: Array<Array<string | number>>) => {
    const span = data?.from || data?.to ? `${data?.from || 'start'}_${data?.to || 'now'}` : 'all';
    downloadBlob({
      filename: `claude-${name}-${span}.csv`,
      blob: new Blob(['\ufeff' + toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }),
    });
  };
  const tokenHeader = ['input', 'output', 'cache_read', 'cache_write'];
  const tokenValues = (row: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  }) => [row.input, row.output, row.cacheRead, row.cacheWrite];
  const exportSessions = () =>
    exportCsv(
      'sessions',
      [
        'session_id',
        'topic',
        'project',
        'branch',
        'first',
        'last',
        'duration_min',
        'model',
        'turns',
        ...tokenHeader,
        'cost_usd',
      ],
      (data?.sessions ?? []).map((row) => [
        row.sessionId,
        row.topic,
        row.project,
        row.branch,
        row.first,
        row.last,
        row.durationMin,
        row.model,
        row.turns,
        ...tokenValues(row),
        csvCost(row.cost),
      ])
    );
  const exportProjects = () =>
    exportCsv(
      'projects',
      ['project', 'sessions', 'turns', ...tokenHeader, 'cost_usd'],
      (data?.projects ?? []).map((row) => [
        row.project,
        row.sessions,
        row.turns,
        ...tokenValues(row),
        csvCost(row.cost),
      ])
    );
  const exportModels = () =>
    exportCsv(
      'models',
      ['model', 'turns', ...tokenHeader, 'cost_usd', 'priced'],
      (data?.byModel ?? []).map((row) => [
        row.model,
        row.turns,
        ...tokenValues(row),
        row.priced ? csvCost(row.cost) : '',
        row.priced ? 'yes' : 'no',
      ])
    );

  /* ---------- Columns ---------- */

  const col = {
    turns: <T extends { turns: number }>(): Column<T> => ({
      id: 'turns',
      label: t('claude_usage.columns.turns'),
      numeric: true,
      sortValue: (row) => row.turns,
      render: (row) => numberFormat.format(row.turns),
    }),
    tokens: <
      T extends { input: number; output: number; cacheRead: number; cacheWrite: number },
    >(): Column<T>[] => [
      {
        id: 'input',
        label: t('claude_usage.columns.input'),
        numeric: true,
        sortValue: (row) => row.input,
        render: (row) => tokenCell(row.input),
      },
      {
        id: 'output',
        label: t('claude_usage.columns.output'),
        numeric: true,
        sortValue: (row) => row.output,
        render: (row) => tokenCell(row.output),
      },
      {
        id: 'cache-read',
        label: t('claude_usage.columns.cache_read'),
        numeric: true,
        sortValue: (row) => row.cacheRead,
        render: (row) => tokenCell(row.cacheRead),
      },
      {
        id: 'cache-write',
        label: t('claude_usage.columns.cache_write'),
        numeric: true,
        sortValue: (row) => row.cacheWrite,
        render: (row) => tokenCell(row.cacheWrite),
      },
    ],
    total: <
      T extends { input: number; output: number; cacheRead: number; cacheWrite: number },
    >(): Column<T> => ({
      id: 'tokens',
      label: t('claude_usage.columns.tokens'),
      numeric: true,
      sortValue: (row) => totalTokens(row),
      render: (row) => tokenCell(totalTokens(row)),
    }),
    cost: <T extends { cost: number }>(priced?: (row: T) => boolean): Column<T> => ({
      id: 'cost',
      label: t('claude_usage.columns.cost'),
      numeric: true,
      sortValue: (row) => (priced && !priced(row) ? -1 : row.cost),
      render: (row) => <strong>{costText(row.cost, priced ? priced(row) : true)}</strong>,
    }),
    project: <T extends { project: string }>(): Column<T> => ({
      id: 'project',
      label: t('claude_usage.columns.project'),
      sortValue: (row) => projectName(row.project),
      render: (row) => (
        <span className={styles.ellipsis} title={row.project}>
          {projectName(row.project) || '—'}
        </span>
      ),
    }),
    sessions: <T extends { sessions: number }>(): Column<T> => ({
      id: 'sessions',
      label: t('claude_usage.columns.sessions'),
      numeric: true,
      sortValue: (row) => row.sessions,
      render: (row) => numberFormat.format(row.sessions),
    }),
  };

  const modelColumns: Column<ModelRow>[] = [
    {
      id: 'model',
      label: t('claude_usage.columns.model'),
      sortValue: (row) => row.model,
      render: (row) => <code className={styles.code}>{row.model}</code>,
    },
    col.turns<ModelRow>(),
    ...col.tokens<ModelRow>(),
    col.cost<ModelRow>((row) => row.priced),
  ];

  const sessionColumns: Column<SessionRow>[] = [
    {
      id: 'topic',
      label: t('claude_usage.columns.topic'),
      grow: true,
      sortValue: (row) => row.topic,
      render: (row) => (
        <span className={styles.topic} title={row.topic || undefined}>
          {row.topic || <em className={styles.muted}>{t('claude_usage.sessions.untitled')}</em>}
        </span>
      ),
    },
    col.project<SessionRow>(),
    {
      id: 'branch',
      label: t('claude_usage.columns.branch'),
      sortValue: (row) => row.branch,
      render: (row) => (
        <span className={styles.ellipsis} title={row.branch || undefined}>
          {row.branch || '—'}
        </span>
      ),
    },
    {
      id: 'last',
      label: t('claude_usage.columns.last_active'),
      sortValue: (row) => Date.parse(row.last) || 0,
      render: (row) => formatDateTime(row.last),
    },
    {
      id: 'duration',
      label: t('claude_usage.columns.duration'),
      numeric: true,
      sortValue: (row) => row.durationMin,
      render: (row) => formatMinutes(row.durationMin),
    },
    {
      id: 'model',
      label: t('claude_usage.columns.model'),
      sortValue: (row) => row.model,
      render: (row) => (
        <code className={styles.code} title={row.model || undefined}>
          {shortModel(row.model) || '—'}
        </code>
      ),
    },
    col.turns<SessionRow>(),
    col.total<SessionRow>(),
    col.cost<SessionRow>(),
  ];

  const projectColumns: Column<ProjectRow>[] = [
    col.project<ProjectRow>(),
    col.sessions<ProjectRow>(),
    col.turns<ProjectRow>(),
    ...col.tokens<ProjectRow>(),
    col.cost<ProjectRow>(),
  ];

  const branchColumns: Column<BranchRow>[] = [
    col.project<BranchRow>(),
    {
      id: 'branch',
      label: t('claude_usage.columns.branch'),
      sortValue: (row) => row.branch,
      render: (row) => <code className={styles.code}>{row.branch || '—'}</code>,
    },
    col.sessions<BranchRow>(),
    col.turns<BranchRow>(),
    col.total<BranchRow>(),
    col.cost<BranchRow>(),
  ];

  const subagentColumns: Column<SubagentRow>[] = [
    {
      id: 'agent-type',
      label: t('claude_usage.columns.agent_type'),
      sortValue: (row) => row.agentType,
      render: (row) => <code className={styles.code}>{row.agentType || '—'}</code>,
    },
    {
      id: 'dispatches',
      label: t('claude_usage.columns.dispatches'),
      numeric: true,
      sortValue: (row) => row.dispatches,
      render: (row) => numberFormat.format(row.dispatches),
    },
    col.turns<SubagentRow>(),
    ...col.tokens<SubagentRow>(),
    col.cost<SubagentRow>(),
  ];

  const dispatchColumns: Column<DispatchRow>[] = [
    {
      id: 'agent-type',
      label: t('claude_usage.columns.agent_type'),
      sortValue: (row) => row.agentType,
      render: (row) => <code className={styles.code}>{row.agentType || '—'}</code>,
    },
    {
      id: 'model',
      label: t('claude_usage.columns.model'),
      sortValue: (row) => row.model,
      render: (row) => (
        <code className={styles.code} title={row.model || undefined}>
          {shortModel(row.model) || '—'}
        </code>
      ),
    },
    {
      id: 'started',
      label: t('claude_usage.columns.started'),
      sortValue: (row) => Date.parse(row.started) || 0,
      render: (row) => formatDateTime(row.started),
    },
    col.turns<DispatchRow>(),
    {
      id: 'tool-uses',
      label: t('claude_usage.columns.tool_uses'),
      numeric: true,
      sortValue: (row) => row.toolUses,
      render: (row) => numberFormat.format(row.toolUses),
    },
    {
      id: 'duration',
      label: t('claude_usage.columns.duration'),
      numeric: true,
      sortValue: (row) => row.durationMs,
      render: (row) => formatMs(row.durationMs),
    },
    {
      id: 'status',
      label: t('claude_usage.columns.status'),
      sortValue: (row) => row.status,
      render: (row) =>
        row.status ? (
          <span
            className={styles.pill}
            data-state={/^(completed|success|done|ok)$/i.test(row.status) ? 'ok' : 'warn'}
          >
            {row.status}
          </span>
        ) : (
          '—'
        ),
    },
    col.total<DispatchRow>(),
    col.cost<DispatchRow>(),
  ];

  /* ---------- Sections ---------- */

  const csvButton = (onClick: () => void, label: string) => (
    <Button
      size="sm"
      variant="ghost"
      className={styles.withIcon}
      onClick={onClick}
      aria-label={t('claude_usage.export_csv_named', { name: label })}
    >
      <IconDownload size={14} />
      {t('claude_usage.export_csv')}
    </Button>
  );

  const card = (
    id: string,
    title: string,
    children: ReactNode,
    options: { actions?: ReactNode; subtitle?: string; className?: string } = {}
  ) => (
    <section
      className={[styles.card, options.className].filter(Boolean).join(' ')}
      aria-labelledby={`claude-usage-${id}`}
    >
      <div className={styles.cardHead}>
        <div className={styles.cardHeading}>
          <h2 id={`claude-usage-${id}`} className={styles.sectionTitle}>
            {title}
          </h2>
          {options.subtitle ? <p className={styles.cardSubtitle}>{options.subtitle}</p> : null}
        </div>
        {options.actions ? <div className={styles.cardActions}>{options.actions}</div> : null}
      </div>
      {children}
    </section>
  );

  const segmented = <V extends string>(
    label: string,
    value: V,
    options: Array<{ value: V; label: string }>,
    onChange: (value: V) => void,
    size: 'md' | 'sm' = 'md'
  ) => (
    <div className={styles.segmented} data-size={size} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segment}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const renderTiles = (sum: NonNullable<typeof totals>) => {
    const tile = (label: string, value: number, format: (value: number) => string) => (
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{label}</span>
        <span className={styles.tileValue} title={numberFormat.format(value)}>
          {format(value)}
        </span>
      </div>
    );
    const count = (value: number) => numberFormat.format(value);
    const unpriced = (data?.byModel ?? []).filter((row) => !row.priced && row.turns > 0).length;
    return (
      <section className={styles.stats} aria-label={t('claude_usage.tiles.label')}>
        <div className={styles.costTile}>
          <span className={styles.tileLabel}>{t('claude_usage.tiles.cost')}</span>
          <span className={styles.costValue}>{formatCost(sum.cost)}</span>
          <span className={styles.tileHint}>
            {unpriced > 0
              ? t('claude_usage.tiles.cost_hint_unpriced', { count: unpriced })
              : t('claude_usage.tiles.cost_hint')}
          </span>
        </div>
        <div className={styles.tileGroups}>
          <div className={styles.tileRow} data-count="3">
            {tile(t('claude_usage.tiles.sessions'), sum.sessions, count)}
            {tile(t('claude_usage.tiles.turns'), sum.turns, count)}
            {tile(t('claude_usage.tiles.subagent'), sum.subagentTokens, formatTokens)}
          </div>
          <div className={styles.tileRow} data-count="4">
            {tile(t('claude_usage.columns.input'), sum.input, formatTokens)}
            {tile(t('claude_usage.columns.output'), sum.output, formatTokens)}
            {tile(t('claude_usage.columns.cache_read'), sum.cacheRead, formatTokens)}
            {tile(t('claude_usage.columns.cache_write'), sum.cacheWrite, formatTokens)}
          </div>
        </div>
      </section>
    );
  };

  const renderContent = (current: ClaudeUsageData) => {
    const modelItems = [...current.byModel]
      .sort((a, b) =>
        modelMetric === 'cost'
          ? Number(b.priced) - Number(a.priced) || b.cost - a.cost
          : totalTokens(b) - totalTokens(a)
      )
      .map((row) => ({
        key: row.model,
        label: row.model,
        value: modelMetric === 'cost' ? row.cost : totalTokens(row),
        display:
          modelMetric === 'cost' ? costText(row.cost, row.priced) : formatTokens(totalTokens(row)),
        muted: modelMetric === 'cost' && !row.priced,
      }));
    const projectItems = [...current.projects]
      .sort((a, b) => b.cost - a.cost)
      .slice(0, TOP_PROJECTS)
      .map((row) => ({
        key: row.project,
        label: projectName(row.project) || '—',
        title: row.project,
        value: row.cost,
        display: formatCost(row.cost),
      }));

    return (
      <>
        {renderTiles(current.totals)}

        {card(
          'daily',
          t('claude_usage.daily.title'),
          <DailyChart rows={current.daily} mode={dailyMode} />,
          {
            actions: segmented(
              t('claude_usage.daily.mode_label'),
              dailyMode,
              [
                { value: 'io', label: t('claude_usage.daily.mode_io') },
                { value: 'cache', label: t('claude_usage.daily.mode_cache') },
              ],
              setDailyMode,
              'sm'
            ),
          }
        )}

        <div className={styles.twoUp}>
          {card('hourly', t('claude_usage.hourly.title'), <HourlyChart rows={current.hourly} />, {
            subtitle: t('claude_usage.hourly.subtitle'),
          })}
          {card(
            'top-projects',
            t('claude_usage.projects.top_title'),
            projectItems.length > 0 ? (
              <BarList items={projectItems} label={t('claude_usage.projects.top_title')} />
            ) : (
              <p className={styles.muted}>{t('claude_usage.table.empty')}</p>
            ),
            { subtitle: t('claude_usage.projects.top_subtitle') }
          )}
        </div>

        {card(
          'models',
          t('claude_usage.by_model.title'),
          <>
            <BarList items={modelItems} label={t('claude_usage.by_model.title')} />
            <DataTable
              caption={t('claude_usage.by_model.title')}
              columns={modelColumns}
              rows={current.byModel}
              rowKey={(row) => row.model}
              defaultSort={{ id: 'cost', direction: 'desc' }}
            />
          </>,
          {
            actions: (
              <>
                {segmented(
                  t('claude_usage.by_model.metric_label'),
                  modelMetric,
                  [
                    { value: 'cost', label: t('claude_usage.by_model.metric_cost') },
                    { value: 'tokens', label: t('claude_usage.by_model.metric_tokens') },
                  ],
                  setModelMetric,
                  'sm'
                )}
                {csvButton(exportModels, t('claude_usage.by_model.title'))}
              </>
            ),
          }
        )}

        {card(
          'sessions',
          t('claude_usage.sessions.title'),
          <>
            {current.sessionsTotal > current.sessions.length ? (
              <p className={styles.note}>
                {t('claude_usage.sessions.shown', {
                  shown: numberFormat.format(current.sessions.length),
                  total: numberFormat.format(current.sessionsTotal),
                })}
              </p>
            ) : null}
            <DataTable
              caption={t('claude_usage.sessions.title')}
              columns={sessionColumns}
              rows={current.sessions}
              rowKey={(row, index) => row.sessionId || String(index)}
              defaultSort={{ id: 'last', direction: 'desc' }}
              pageSize={PAGE_SIZE}
            />
          </>,
          { actions: csvButton(exportSessions, t('claude_usage.sessions.title')) }
        )}

        {card(
          'projects',
          t('claude_usage.projects.title'),
          <DataTable
            caption={t('claude_usage.projects.title')}
            columns={projectColumns}
            rows={current.projects}
            rowKey={(row) => row.project}
            defaultSort={{ id: 'cost', direction: 'desc' }}
            pageSize={PAGE_SIZE}
          />,
          { actions: csvButton(exportProjects, t('claude_usage.projects.title')) }
        )}

        {card(
          'branches',
          t('claude_usage.branches.title'),
          <DataTable
            caption={t('claude_usage.branches.title')}
            columns={branchColumns}
            rows={current.branches}
            rowKey={(row) => `${row.project}\u0000${row.branch}`}
            defaultSort={{ id: 'cost', direction: 'desc' }}
            pageSize={PAGE_SIZE}
          />
        )}

        {card(
          'subagents',
          t('claude_usage.subagents.title'),
          current.subagents.length > 0 ? (
            <DataTable
              caption={t('claude_usage.subagents.title')}
              columns={subagentColumns}
              rows={current.subagents}
              rowKey={(row) => row.agentType}
              defaultSort={{ id: 'cost', direction: 'desc' }}
            />
          ) : (
            <p className={styles.muted}>{t('claude_usage.subagents.empty')}</p>
          )
        )}

        {current.dispatches.length > 0
          ? card(
              'dispatches',
              t('claude_usage.dispatches.title'),
              <DataTable
                caption={t('claude_usage.dispatches.title')}
                columns={dispatchColumns}
                rows={current.dispatches}
                rowKey={(row, index) => row.agentId || String(index)}
                defaultSort={{ id: 'cost', direction: 'desc' }}
                pageSize={PAGE_SIZE}
              />
            )
          : null}
      </>
    );
  };

  const progress = status && status.bytesTotal > 0 ? share(status.bytesDone, status.bytesTotal) : 0;

  let body: ReactNode;
  if (noSources) {
    body = (
      <EmptyState
        title={t('claude_usage.empty.no_sources_title')}
        description={t('claude_usage.empty.no_sources_text')}
        action={
          <Button size="sm" variant="secondary" onClick={onRescan}>
            {t('claude_usage.rescan')}
          </Button>
        }
      />
    );
  } else if (firstScan && !hasData) {
    body = null;
  } else if (data && hasData) {
    body = renderContent(data);
  } else if (data) {
    body = (
      <EmptyState
        title={t('claude_usage.empty.no_data_title')}
        description={t('claude_usage.empty.no_data_text')}
        action={
          range !== 'all' ? (
            <Button size="sm" variant="secondary" onClick={() => onRangeChange('all')}>
              {t('claude_usage.empty.show_all')}
            </Button>
          ) : undefined
        }
      />
    );
  } else if (loading) {
    body = <p className={styles.muted}>{t('common.loading')}</p>;
  } else {
    body = null;
  }

  return (
    <div className={styles.page} data-loading={(loading && data !== null) || undefined}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{t('claude_usage.title')}</h1>
          <p className={styles.meta}>
            {t('claude_usage.meta', {
              sessions: numberFormat.format(status?.sessions ?? 0),
              turns: numberFormat.format(status?.turns ?? 0),
            })}
            <span className={styles.metaSep} aria-hidden="true">
              ·
            </span>
            {updatedAt
              ? t('claude_usage.updated', { time: updatedAt })
              : t('claude_usage.never_updated')}
          </p>
          <p className={styles.lede}>{t('claude_usage.lede')}</p>
        </div>
        <Button
          variant="secondary"
          className={styles.withIcon}
          onClick={onRescan}
          loading={scanning}
          aria-label={scanning ? t('claude_usage.scanning') : undefined}
        >
          {scanning ? null : <IconRefreshCw size={15} />}
          {t('claude_usage.rescan')}
        </Button>
      </header>

      <section className={styles.controls} aria-label={t('claude_usage.filters')}>
        {segmented(
          t('claude_usage.range_label'),
          range,
          RANGE_KEYS.map((key) => ({ value: key, label: t(`claude_usage.ranges.${key}`) })),
          onRangeChange
        )}
        {modelOptions.length > 0 ? (
          <div className={styles.chips} role="group" aria-label={t('claude_usage.models_label')}>
            <button
              type="button"
              className={styles.chip}
              aria-pressed={models.length === 0}
              onClick={() => onModelsChange([])}
            >
              {t('claude_usage.all_models')}
            </button>
            {modelOptions.map((option) => (
              <button
                key={option.model}
                type="button"
                className={styles.chip}
                aria-pressed={models.includes(option.model)}
                title={
                  pricedByModel.get(option.model) === false
                    ? t('claude_usage.unpriced_hint')
                    : undefined
                }
                onClick={() => onModelsChange(toggleModel(models, option.model, availableModels))}
              >
                {option.model}
                {pricedByModel.get(option.model) === false ? (
                  <span className={styles.chipNote}>{t('claude_usage.na')}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {showProgress && scanning && status ? (
        <section className={styles.scanCard} aria-labelledby="claude-usage-scan">
          <div className={styles.scanHead}>
            <h2 id="claude-usage-scan" className={styles.cardTitle}>
              {firstScan ? t('claude_usage.scan.first_title') : t('claude_usage.scan.title')}
            </h2>
            <span className={styles.scanPercent}>{Math.round(progress * 100)}%</span>
          </div>
          {firstScan ? (
            <p className={styles.cardText}>{t('claude_usage.scan.first_text')}</p>
          ) : null}
          <div
            className={styles.progress}
            role="progressbar"
            aria-label={t('claude_usage.scan.progress_label')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <span style={{ width: `${progress * 100}%` }} />
          </div>
          <p className={styles.note}>
            {t('claude_usage.scan.progress', {
              done: numberFormat.format(status.filesDone),
              total: numberFormat.format(status.filesTotal),
              bytesDone: formatFileSize(status.bytesDone),
              bytesTotal: formatFileSize(status.bytesTotal),
            })}
          </p>
        </section>
      ) : null}

      {status?.lastError ? (
        <div className={styles.notice} role="alert">
          {t('claude_usage.scan.error', { error: status.lastError })}
        </div>
      ) : null}
      {error ? (
        <div className="error-box" role="alert">
          {t('claude_usage.empty.unavailable')} {error}
        </div>
      ) : null}

      {body}
    </div>
  );
}
