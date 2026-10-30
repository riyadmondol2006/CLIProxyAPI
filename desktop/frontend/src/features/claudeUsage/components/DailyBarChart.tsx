import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTokens, niceMax, parseLocalDay } from '../logic';
import { topRoundedBar, tooltipShift, useChartFocus, useElementWidth } from './chartHooks';
import styles from './charts.module.scss';

const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };
const TICKS = 4;
const SEGMENT_GAP = 2;

export interface DailyBarSeries {
  key: string;
  label: string;
  /** One value per day. */
  values: number[];
  /**
   * Color slot for stacked charts: a top-group index or `other`. Without one the series is
   * drawn in the primary color and no legend is shown.
   */
  tone?: number | 'other';
}

interface TooltipLine {
  label: string;
  value: string;
  /** The series, for its swatch in stacked charts. */
  item?: DailyBarSeries;
}

interface DailyBarChartProps {
  /** Local days (YYYY-MM-DD), oldest first. */
  days: string[];
  /** Stacked bottom to top. */
  series: DailyBarSeries[];
  /** Read out with the chart, e.g. "Daily tokens over 30 days: 1.2M tokens." */
  summary: string;
  /** Explains the arrow-key navigation. */
  keysHint: string;
  /** Label of the per-day total in the tooltip; shown only with more than one series. */
  totalLabel?: string;
  /** Extra tooltip rows for a day, e.g. its request count. */
  extraRows?: (index: number) => Array<[string, string]>;
}

/**
 * Daily token bars, one series or several stacked, drawn like the Claude usage daily chart.
 * A single day renders as one wide bar.
 */
export function DailyBarChart({
  days,
  series,
  summary,
  keysHint,
  totalLabel,
  extraRows,
}: DailyBarChartProps) {
  const { i18n } = useTranslation();
  const { ref, width } = useElementWidth<HTMLDivElement>(760);
  const { active, keyboard, point, containerProps } = useChartFocus(days.length);

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

  const stacked = series.some((item) => item.tone !== undefined);
  const dayTotals = days.map((_, index) =>
    series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0)
  );
  const plotWidth = Math.max(40, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...dayTotals), TICKS);
  const slot = days.length > 0 ? plotWidth / days.length : plotWidth;
  const barGap = slot >= 6 ? 2 : slot >= 3 ? 1 : 0;
  const barWidth = Math.max(1, Math.min(days.length === 1 ? 64 : 28, slot - barGap));
  const baseY = PAD.top + plotHeight;
  const xCenter = (index: number) => PAD.left + slot * (index + 0.5);
  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => index / TICKS);
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(plotWidth / 80))));

  const fillClass = (item: DailyBarSeries) =>
    item.tone === undefined ? styles.fillSingle : styles.fillTone;

  /** Segments of one day's bar, bottom up; the top one gets the rounded corners. */
  const renderBar = (index: number) => {
    const x = xCenter(index) - barWidth / 2;
    const segments: Array<{ item: DailyBarSeries; y: number; height: number }> = [];
    let stackedHeight = 0;
    series.forEach((item) => {
      const height = ((item.values[index] ?? 0) / max) * plotHeight;
      if (height <= 0) return;
      const gap = stackedHeight > 0 ? SEGMENT_GAP : 0;
      segments.push({
        item,
        y: baseY - stackedHeight - height,
        height: Math.max(1, height - gap),
      });
      stackedHeight += height;
    });
    if (segments.length === 0) return null;
    return (
      <g key={days[index]} className={active === index ? styles.barActive : undefined}>
        {segments.map((segment, position) => (
          <path
            key={segment.item.key}
            className={fillClass(segment.item)}
            data-tone={segment.item.tone}
            d={
              position === segments.length - 1
                ? topRoundedBar(x, segment.y, barWidth, segment.height)
                : `M${x} ${segment.y + segment.height} V${segment.y} H${x + barWidth} V${segment.y + segment.height} Z`
            }
          />
        ))}
      </g>
    );
  };

  const lines: TooltipLine[] =
    active === null
      ? []
      : [
          ...series
            // Stacked tooltips skip the groups that had nothing that day.
            .filter((item) => !stacked || (item.values[active] ?? 0) > 0)
            .map((item) => ({
              label: item.label,
              value: numberFormat.format(item.values[active] ?? 0),
              item: stacked ? item : undefined,
            })),
          ...(series.length > 1 && totalLabel
            ? [{ label: totalLabel, value: numberFormat.format(dayTotals[active]) }]
            : []),
          ...(extraRows ? extraRows(active) : []).map(([label, value]) => ({ label, value })),
        ];

  return (
    <figure className={styles.figure}>
      {stacked ? (
        <figcaption className={styles.legend}>
          {series.map((item) => (
            <span key={item.key} className={styles.legendItem}>
              <span
                className={`${styles.swatch} ${fillClass(item)}`}
                data-tone={item.tone}
                aria-hidden="true"
              />
              {item.label}
              <b>{formatTokens(item.values.reduce((sum, value) => sum + value, 0))}</b>
            </span>
          ))}
        </figcaption>
      ) : null}

      <div
        ref={ref}
        className={styles.plot}
        role="group"
        aria-label={`${summary} ${keysHint}`}
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

          {days.map((_, index) => renderBar(index))}

          {days.map((day, index) =>
            index % labelEvery === 0 ? (
              <text
                key={day}
                x={xCenter(index)}
                y={HEIGHT - 6}
                className={styles.axisLabel}
                textAnchor="middle"
              >
                {dayLabel(day)}
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

          {days.map((day, index) => (
            <rect
              key={day}
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

        {active !== null ? (
          <div
            className={styles.tooltip}
            style={{ left: xCenter(active), transform: tooltipShift(active, days.length) }}
            aria-hidden="true"
          >
            <span className={styles.tooltipTitle}>{dayLabel(days[active], true)}</span>
            {lines.map((line, index) => (
              <span key={`${index}-${line.label}`} className={styles.tooltipRow}>
                {line.item ? (
                  <span className={styles.tooltipLabel}>
                    <span
                      className={`${styles.swatch} ${fillClass(line.item)}`}
                      data-tone={line.item.tone}
                    />
                    {line.label}
                  </span>
                ) : (
                  line.label
                )}
                <b>{line.value}</b>
              </span>
            ))}
          </div>
        ) : null}
        <span className={styles.srOnly} aria-live="polite">
          {keyboard && active !== null
            ? `${dayLabel(days[active], true)}: ${lines
                .map((line) => `${line.label} ${line.value}`)
                .join(', ')}`
            : ''}
        </span>
      </div>
    </figure>
  );
}
