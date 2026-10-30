import { share } from '../logic';
import styles from './charts.module.scss';

export interface BarListItem {
  key: string;
  label: string;
  /** Full text for the tooltip when the label is shortened (e.g. a project path). */
  title?: string;
  value: number;
  display: string;
  /** Unpriced or empty rows draw no bar but keep their row. */
  muted?: boolean;
}

/**
 * Horizontal bars as a plain list: every value is real text, so the list itself is the
 * accessible equivalent and the bars are decoration.
 */
export function BarList({ items, label }: { items: BarListItem[]; label: string }) {
  const max = Math.max(0, ...items.map((item) => (item.muted ? 0 : item.value)));
  return (
    <ol className={styles.barList} aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className={styles.barRow} data-muted={item.muted || undefined}>
          <span className={styles.barLabel} title={item.title ?? item.label}>
            {item.label}
          </span>
          <span className={styles.barTrack} aria-hidden="true">
            <span
              className={styles.barFill}
              style={{ width: `${item.muted ? 0 : share(item.value, max) * 100}%` }}
            />
          </span>
          <span className={styles.barValue}>{item.display}</span>
        </li>
      ))}
    </ol>
  );
}
