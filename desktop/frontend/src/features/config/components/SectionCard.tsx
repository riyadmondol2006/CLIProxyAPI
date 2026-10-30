import type { ReactNode } from 'react';
import { FIELDS_ROOT_CLASS } from './fields/FieldPrimitives';
import styles from './SectionCard.module.scss';

export type SectionCardProps = {
  /** Section number (01–07). The common tab is an alias view; omit it to hide the number. */
  indexLabel?: string;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /**
   * True only for the first-load entrance (captured with useState on page mount); tab switches
   * have no animation and do not replay it.
   */
  animateIn?: boolean;
  children: ReactNode;
};

/**
 * Section card: natural-height vertical flow (replaces the old fixed-height scroll-snap carousel).
 * The surface recipe matches cards site-wide: 14px radius / 1px border / 82% color-mix.
 */
export function SectionCard({
  indexLabel,
  icon,
  title,
  description,
  animateIn = false,
  children,
}: SectionCardProps) {
  return (
    <section className={`${styles.card} ${animateIn ? styles.cardEnter : ''}`}>
      <header className={styles.header}>
        <div className={styles.badges}>
          {indexLabel ? <span className={styles.indexBadge}>{indexLabel}</span> : null}
          {icon ? <span className={styles.iconBadge}>{icon}</span> : null}
        </div>
        <div className={styles.heading}>
          <h2 className={styles.title}>{title}</h2>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
      </header>
      <div className={`${styles.content} ${FIELDS_ROOT_CLASS}`}>{children}</div>
    </section>
  );
}
