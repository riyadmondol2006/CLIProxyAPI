import { useTranslation } from 'react-i18next';
import styles from './LiveBadge.module.scss';

interface LiveBadgeProps {
  /** Tooltip, e.g. when the data was last refreshed. */
  title?: string;
  className?: string;
}

/** A small pulsing "Live" marker for data that refreshes by itself. */
export function LiveBadge({ title, className }: LiveBadgeProps) {
  const { t } = useTranslation();
  return (
    <span className={[styles.liveBadge, className].filter(Boolean).join(' ')} title={title}>
      <i className={styles.liveDot} aria-hidden="true" />
      {t('common.live')}
    </span>
  );
}
