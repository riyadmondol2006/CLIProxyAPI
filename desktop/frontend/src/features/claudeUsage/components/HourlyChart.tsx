import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import type { HourlyRow } from '../api';
import { formatTokens, niceMax } from '../logic';
import { topRoundedBar, tooltipShift, useChartFocus, useElementWidth } from './chartHooks';
import styles from './charts.module.scss';

const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };
const TICKS = 3;

export function HourlyChart({ rows }: { rows: HourlyRow[] }) {
  const { t, i18n } = useTranslation();
  const { ref, width } = useElementWidth<HTMLDivElement>(480);
  const { active, keyboard, point, containerProps } = useChartFocus(rows.length);

  const hourFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: 'numeric' }),
    [i18n.language]
  );
  const decimal = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }),
    [i18n.language]
  );
  const hourLabel = (hour: number) => hourFormat.format(new Date(2000, 0, 1, hour));
  const hourRange = (hour: number) => `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`;

  const plotWidth = Math.max(40, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...rows.map((row) => row.avgTurns)), TICKS);
  const slot = plotWidth / Math.max(1, rows.length);
  const barWidth = Math.max(2, Math.min(22, slot - 2));
  const xCenter = (index: number) => PAD.left + slot * (index + 0.5);
  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => index / TICKS);

  const peak = rows.reduce<HourlyRow | null>(
    (best, row) => (row.avgTurns > (best?.avgTurns ?? 0) ? row : best),
    null
  );
  const summary = peak
    ? t('claude_usage.hourly.summary', {
        hour: hourRange(peak.hour),
        value: decimal.format(peak.avgTurns),
      })
    : t('claude_usage.hourly.summary_empty');

  const activeRow = active === null ? null : rows[active];
  const lines = activeRow
    ? [
        [t('claude_usage.hourly.avg_turns'), decimal.format(activeRow.avgTurns)],
        [t('claude_usage.hourly.avg_output'), formatTokens(activeRow.avgOutput)],
        [t('claude_usage.columns.turns'), String(activeRow.turns)],
      ]
    : [];

  return (
    <figure className={styles.figure}>
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
                  {decimal.format(max * ratio)}
                </text>
              </g>
            );
          })}
          {rows.map((row, index) => {
            const height = (row.avgTurns / max) * plotHeight;
            return (
              <path
                key={row.hour}
                className={`${styles.fillSingle} ${active === index ? styles.barActive : ''}`}
                d={topRoundedBar(
                  xCenter(index) - barWidth / 2,
                  PAD.top + plotHeight - height,
                  barWidth,
                  height
                )}
              />
            );
          })}
          {rows.map((row, index) =>
            row.hour % 6 === 0 ? (
              <text
                key={row.hour}
                x={xCenter(index)}
                y={HEIGHT - 6}
                className={styles.axisLabel}
                textAnchor="middle"
              >
                {hourLabel(row.hour)}
              </text>
            ) : null
          )}
          {rows.map((row, index) => (
            <rect
              key={row.hour}
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
            <span className={styles.tooltipTitle}>{hourRange(activeRow.hour)}</span>
            {lines.map(([label, value]) => (
              <span key={label} className={styles.tooltipRow}>
                {label}
                <b>{value}</b>
              </span>
            ))}
          </div>
        ) : null}
        <span className={styles.srOnly} aria-live="polite">
          {keyboard && activeRow
            ? `${hourRange(activeRow.hour)}: ${lines.map(([l, v]) => `${l} ${v}`).join(', ')}`
            : ''}
        </span>
      </div>

      <Collapsible className={styles.tableToggle} label={t('claude_usage.show_table')}>
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <caption className={styles.srOnly}>{summary}</caption>
            <thead>
              <tr>
                <th scope="col">{t('claude_usage.hourly.hour')}</th>
                <th scope="col">{t('claude_usage.hourly.avg_turns')}</th>
                <th scope="col">{t('claude_usage.hourly.avg_output')}</th>
                <th scope="col">{t('claude_usage.columns.turns')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.hour}>
                  <th scope="row">{hourRange(row.hour)}</th>
                  <td>{decimal.format(row.avgTurns)}</td>
                  <td>{formatTokens(row.avgOutput)}</td>
                  <td>{row.turns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Collapsible>
    </figure>
  );
}
