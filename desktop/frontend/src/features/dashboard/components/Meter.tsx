import { toneForSuccessRate, type MeterTone } from '../utils';
import styles from './Meter.module.scss';

const TONE_COLORS: Record<MeterTone, string> = {
  good: 'var(--viz-success, #10b981)',
  warning: 'var(--amber-color)',
  critical: 'var(--viz-failure, #c65746)',
  idle: 'var(--text-quaternary)',
};

interface MeterProps {
  /** 0–100; null means no requests in the window */
  value: number | null;
  tone?: MeterTone;
  ariaLabel: string;
  className?: string;
}

/**
 * Thin bar meter: the fill color carries severity and the track is a faded step of the same
 * color, so the state can be read along the whole bar.
 */
export function Meter({ value, tone, ariaLabel, className }: MeterProps) {
  const resolvedTone = tone ?? toneForSuccessRate(value);
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div
      className={[styles.track, className].filter(Boolean).join(' ')}
      style={{ '--meter-fill': TONE_COLORS[resolvedTone] } as React.CSSProperties}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(clamped)}
      aria-label={ariaLabel}
    >
      <div className={styles.fill} style={{ width: `${clamped}%` }} />
    </div>
  );
}
