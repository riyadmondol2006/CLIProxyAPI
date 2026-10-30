import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import type { DailyRow } from '../api';
import { formatCost, formatTokens, niceMax, parseLocalDay, totalTokens } from '../logic';
import { topRoundedBar, tooltipShift, useChartFocus, useElementWidth } from './chartHooks';
import styles from './charts.module.scss';

export type DailyMode = 'io' | 'cache';

const HEIGHT = 240;
const PAD = { top: 12, right: 56, bottom: 26, left: 52 };
const TICKS = 4;
const SEGMENT_GAP = 2;

interface Series {
  key: 'input' | 'output' | 'cacheRead' | 'cacheWrite';
  label: string;
  className: string;
}

interface DailyChartProps {
  rows: DailyRow[];
  mode: DailyMode;
}

export function DailyChart({ rows, mode }: DailyChartProps) {
  const { t, i18n } = useTranslation();
  const { ref, width } = useElementWidth<HTMLDivElement>(760);
  const { active, keyboard, point, containerProps } = useChartFocus(rows.length);

  const series: Series[] =
    mode === 'io'
      ? [
          { key: 'input', label: t('claude_usage.columns.input'), className: styles.fillInput },
          { key: 'output', label: t('claude_usage.columns.output'), className: styles.fillOutput },
        ]
      : [
          {
            key: 'cacheRead',
            label: t('claude_usage.columns.cache_read'),
            className: styles.fillCacheRead,
          },
          {
            key: 'cacheWrite',
            label: t('claude_usage.columns.cache_write'),
            className: styles.fillCacheWrite,
          },
        ];

  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }),
    [i18n.language]
  );
  const longDayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    [i18n.language]
  );
  const dayLabel = (day: string, long = false) => {
    const date = parseLocalDay(day);
    return date ? (long ? longDayFormat : dayFormat).format(date) : day;
  };

  const plotWidth = Math.max(40, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const [first, second] = series;
  const stackMax = niceMax(
    Math.max(0, ...rows.map((row) => row[first.key] + row[second.key])),
    TICKS
  );
  const costMax = niceMax(Math.max(0, ...rows.map((row) => row.cost)), TICKS);
  const slot = rows.length > 0 ? plotWidth / rows.length : plotWidth;
  const barGap = slot >= 6 ? 2 : slot >= 3 ? 1 : 0;
  const barWidth = Math.max(1, Math.min(28, slot - barGap));
  const yFor = (value: number, max: number) => PAD.top + plotHeight - (value / max) * plotHeight;
  const xCenter = (index: number) => PAD.left + slot * (index + 0.5);

  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => index / TICKS);
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(plotWidth / 80))));
  const costLine = rows
    .map((row, index) => `${index === 0 ? 'M' : 'L'}${xCenter(index)} ${yFor(row.cost, costMax)}`)
    .join(' ');

  const totals = rows.reduce(
    (sum, row) => ({
      input: sum.input + row.input,
      output: sum.output + row.output,
      cacheRead: sum.cacheRead + row.cacheRead,
      cacheWrite: sum.cacheWrite + row.cacheWrite,
      cost: sum.cost + row.cost,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  );
  const summary = t('claude_usage.daily.summary', {
    days: rows.length,
    tokens: formatTokens(totalTokens(totals)),
    cost: formatCost(totals.cost),
  });

  const activeRow = active === null ? null : rows[active];
  const tooltipLines = activeRow
    ? [
        [t('claude_usage.columns.input'), formatTokens(activeRow.input)],
        [t('claude_usage.columns.output'), formatTokens(activeRow.output)],
        [t('claude_usage.columns.cache_read'), formatTokens(activeRow.cacheRead)],
        [t('claude_usage.columns.cache_write'), formatTokens(activeRow.cacheWrite)],
        [t('claude_usage.columns.turns'), String(activeRow.turns)],
        [t('claude_usage.columns.cost'), formatCost(activeRow.cost)],
      ]
    : [];

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.legend}>
        {series.map((item) => (
          <span key={item.key} className={styles.legendItem}>
            <span className={`${styles.swatch} ${item.className}`} aria-hidden="true" />
            {item.label}
            <b>{formatTokens(totals[item.key])}</b>
          </span>
        ))}
        <span className={styles.legendItem}>
          <span className={styles.lineKey} aria-hidden="true" />
          {t('claude_usage.daily.cost_line')}
          <b>{formatCost(totals.cost)}</b>
        </span>
      </figcaption>

      <div
        ref={ref}
        className={styles.plot}
        role="group"
        aria-label={`${summary} ${t('claude_usage.chart_keys')}`}
        {...containerProps}
      >
        <svg width={width} height={HEIGHT} className={styles.svg} aria-hidden="true">
          {ticks.map((ratio) => {
            const y = PAD.top + plotHeight * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotWidth}
                  y1={y}
                  y2={y}
                  className={ratio === 0 ? styles.baseline : styles.gridline}
                />
                <text x={PAD.left - 8} y={y} className={styles.axisLabel} textAnchor="end">
                  {formatTokens(stackMax * ratio)}
                </text>
                <text
                  x={PAD.left + plotWidth + 8}
                  y={y}
                  className={styles.axisLabel}
                  textAnchor="start"
                >
                  {formatCost(costMax * ratio)}
                </text>
              </g>
            );
          })}

          {rows.map((row, index) => {
            const x = xCenter(index) - barWidth / 2;
            const bottomHeight = (row[first.key] / stackMax) * plotHeight;
            const topHeight = (row[second.key] / stackMax) * plotHeight;
            const gap = bottomHeight > 0 && topHeight > 0 ? SEGMENT_GAP : 0;
            const baseY = PAD.top + plotHeight;
            return (
              <g key={row.day} className={active === index ? styles.barActive : undefined}>
                {bottomHeight > 0 ? (
                  <path
                    className={first.className}
                    d={
                      topHeight > 0
                        ? `M${x} ${baseY} V${baseY - bottomHeight} H${x + barWidth} V${baseY} Z`
                        : topRoundedBar(x, baseY - bottomHeight, barWidth, bottomHeight)
                    }
                  />
                ) : null}
                {topHeight > gap ? (
                  <path
                    className={second.className}
                    d={topRoundedBar(
                      x,
                      baseY - bottomHeight - topHeight,
                      barWidth,
                      Math.max(1, topHeight - gap)
                    )}
                  />
                ) : null}
              </g>
            );
          })}

          {rows.length > 1 ? <path d={costLine} className={styles.costLine} /> : null}
          {rows.map((row, index) =>
            rows.length === 1 || active === index ? (
              <circle
                key={row.day}
                cx={xCenter(index)}
                cy={yFor(row.cost, costMax)}
                r={4}
                className={styles.costDot}
              />
            ) : null
          )}

          {rows.map((row, index) =>
            index % labelEvery === 0 ? (
              <text
                key={row.day}
                x={xCenter(index)}
                y={HEIGHT - 6}
                className={styles.axisLabel}
                textAnchor="middle"
              >
                {dayLabel(row.day)}
              </text>
            ) : null
          )}

          {active !== null ? (
            <line
              x1={xCenter(active)}
              x2={xCenter(active)}
              y1={PAD.top}
              y2={PAD.top + plotHeight}
              className={styles.crosshair}
            />
          ) : null}

          {rows.map((row, index) => (
            <rect
              key={row.day}
              x={PAD.left + slot * index}
              y={PAD.top}
              width={slot}
              height={plotHeight}
              className={styles.hit}
              onPointerEnter={() => point(index)}
              onPointerDown={() => point(index)}
            />
          ))}
        </svg>

        {activeRow && active !== null ? (
          <div
            className={styles.tooltip}
            style={{ left: xCenter(active), transform: tooltipShift(active, rows.length) }}
            aria-hidden="true"
          >
            <span className={styles.tooltipTitle}>{dayLabel(activeRow.day, true)}</span>
            {tooltipLines.map(([label, value]) => (
              <span key={label} className={styles.tooltipRow}>
                {label}
                <b>{value}</b>
              </span>
            ))}
          </div>
        ) : null}
        <span className={styles.srOnly} aria-live="polite">
          {keyboard && activeRow
            ? `${dayLabel(activeRow.day, true)}: ${tooltipLines
                .map(([label, value]) => `${label} ${value}`)
                .join(', ')}`
            : ''}
        </span>
      </div>

      <Collapsible className={styles.tableToggle} label={t('claude_usage.show_table')}>
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <caption className={styles.srOnly}>{summary}</caption>
            <thead>
              <tr>
                <th scope="col">{t('claude_usage.columns.day')}</th>
                <th scope="col">{t('claude_usage.columns.input')}</th>
                <th scope="col">{t('claude_usage.columns.output')}</th>
                <th scope="col">{t('claude_usage.columns.cache_read')}</th>
                <th scope="col">{t('claude_usage.columns.cache_write')}</th>
                <th scope="col">{t('claude_usage.columns.turns')}</th>
                <th scope="col">{t('claude_usage.columns.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.day}>
                  <th scope="row">{dayLabel(row.day, true)}</th>
                  <td>{formatTokens(row.input)}</td>
                  <td>{formatTokens(row.output)}</td>
                  <td>{formatTokens(row.cacheRead)}</td>
                  <td>{formatTokens(row.cacheWrite)}</td>
                  <td>{row.turns}</td>
                  <td>{formatCost(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>
    </figure>
  );
}
