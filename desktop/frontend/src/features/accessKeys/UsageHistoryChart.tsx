import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  topRoundedBar,
  tooltipShift,
  useChartFocus,
  useElementWidth,
} from '@/features/claudeUsage/components/chartHooks';
import styles from '@/features/claudeUsage/components/charts.module.scss';
import { formatTokens, niceMax, parseLocalDay } from '@/features/claudeUsage/logic';
import type { HistoryPoint } from './logic';

const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };
const TICKS = 4;

/** Daily token bars for client keys, drawn like the Claude usage daily chart. */
export function UsageHistoryChart({ points }: { points: HistoryPoint[] }) {
  const { t, i18n } = useTranslation();
  const { ref, width } = useElementWidth<HTMLDivElement>(760);
  const { active, keyboard, point, containerProps } = useChartFocus(points.length);

  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
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
  const max = niceMax(Math.max(0, ...points.map((item) => item.tokens)), TICKS);
  const slot = points.length > 0 ? plotWidth / points.length : plotWidth;
  const barGap = slot >= 6 ? 2 : slot >= 3 ? 1 : 0;
  const barWidth = Math.max(1, Math.min(28, slot - barGap));
  const baseY = PAD.top + plotHeight;
  const xCenter = (index: number) => PAD.left + slot * (index + 0.5);
  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => index / TICKS);
  const labelEvery = Math.max(
    1,
    Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / 80)))
  );

  const total = points.reduce((sum, item) => sum + item.tokens, 0);
  const summary = t('access_keys.history.chart_summary', {
    days: points.length,
    tokens: formatTokens(total),
  });

  const activePoint = active === null ? null : points[active];
  const lines = activePoint
    ? [
        [t('access_keys.history.tokens'), numberFormat.format(activePoint.tokens)],
        [t('access_keys.history.requests'), numberFormat.format(activePoint.requests)],
      ]
    : [];

  return (
    <figure className={styles.figure}>
      <div
        ref={ref}
        className={styles.plot}
        role="group"
        aria-label={`${summary} ${t('access_keys.history.chart_keys')}`}
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
                  {formatTokens(max * ratio)}
                </text>
              </g>
            );
          })}

          {points.map((item, index) => {
            const height = (item.tokens / max) * plotHeight;
            return height > 0 ? (
              <path
                key={item.day}
                className={`${styles.fillSingle} ${active === index ? styles.barActive : ''}`}
                d={topRoundedBar(xCenter(index) - barWidth / 2, baseY - height, barWidth, height)}
              />
            ) : null;
          })}

          {points.map((item, index) =>
            index % labelEvery === 0 ? (
              <text
                key={item.day}
                x={xCenter(index)}
                y={HEIGHT - 6}
                className={styles.axisLabel}
                textAnchor="middle"
              >
                {dayLabel(item.day)}
              </text>
            ) : null
          )}

          {active !== null ? (
            <line
              x1={xCenter(active)}
              x2={xCenter(active)}
              y1={PAD.top}
              y2={baseY}
              className={styles.crosshair}
            />
          ) : null}

          {points.map((item, index) => (
            <rect
              key={item.day}
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

        {activePoint && active !== null ? (
          <div
            className={styles.tooltip}
            style={{ left: xCenter(active), transform: tooltipShift(active, points.length) }}
            aria-hidden="true"
          >
            <span className={styles.tooltipTitle}>{dayLabel(activePoint.day, true)}</span>
            {lines.map(([label, value]) => (
              <span key={label} className={styles.tooltipRow}>
                {label}
                <b>{value}</b>
              </span>
            ))}
          </div>
        ) : null}
        <span className={styles.srOnly} aria-live="polite">
          {keyboard && activePoint
            ? `${dayLabel(activePoint.day, true)}: ${lines
                .map(([label, value]) => `${label} ${value}`)
                .join(', ')}`
            : ''}
        </span>
      </div>
    </figure>
  );
}
