import { useId, useMemo } from 'react';
import { buildSmoothLinePath } from './curve';
import styles from './Sparkline.module.scss';

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 32;
/** Top padding so peaks don't touch the edge and get clipped */
const TOP_PADDING = 3;

interface SparklineProps {
  points: number[];
  /** Line/fill color; defaults to the primary color */
  color?: string;
  ariaLabel: string;
  className?: string;
}

/**
 * Minimal sparkline: 2px line + a 10% area in the same color.
 * Single series, so no legend is needed; the values are carried by the containing card's text.
 */
export function Sparkline({ points, color, ariaLabel, className }: SparklineProps) {
  const gradientId = useId();

  const geometry = useMemo(() => {
    const values = points.filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      return null;
    }

    const max = Math.max(...values);
    const usableHeight = VIEW_HEIGHT - TOP_PADDING;
    const stepX = values.length > 1 ? VIEW_WIDTH / (values.length - 1) : 0;

    const coordinates = values.map((value, index) => {
      const x = values.length > 1 ? index * stepX : VIEW_WIDTH / 2;
      const ratio = max > 0 ? value / max : 0;
      const y = VIEW_HEIGHT - ratio * usableHeight;
      return { x, y };
    });

    const line = buildSmoothLinePath(coordinates, TOP_PADDING, VIEW_HEIGHT);

    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const area = `${line} L${last.x.toFixed(2)} ${VIEW_HEIGHT} L${first.x.toFixed(2)} ${VIEW_HEIGHT} Z`;

    return { line, area, isFlat: max <= 0 };
  }, [points]);

  if (!geometry) {
    return (
      <div className={[styles.empty, className].filter(Boolean).join(' ')} aria-hidden="true" />
    );
  }

  const strokeColor = geometry.isFlat
    ? 'var(--text-quaternary)'
    : (color ?? 'var(--primary-color)');

  return (
    <svg
      className={[styles.sparkline, className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.16" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {!geometry.isFlat && <path d={geometry.area} fill={`url(#${gradientId})`} stroke="none" />}
      <path
        d={geometry.line}
        fill="none"
        stroke={strokeColor}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
