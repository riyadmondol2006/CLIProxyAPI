import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { prefersReducedMotion } from '@/hooks/motion';
import {
  CONFIG_TAB_ICONS,
  CONFIG_TAB_IDS,
  configPanelDomId,
  configTabDomId,
  type ConfigTabId,
} from '../constants';
import styles from './ConfigTabs.module.scss';

export type ConfigTabsProps = {
  active: ConfigTabId;
  /**
   * Validation error count per tab (produced by uiState.countSectionErrors); >0 shows a
   * failure-colored badge.
   */
  errorCounts: Partial<Record<ConfigTabId, number>>;
  /** Tabs with unsaved changes (produced by uiState.resolveDirtyTabs); shows an amber dirty dot. */
  dirtyTabs: ReadonlySet<ConfigTabId>;
  disabled?: boolean;
  onChange: (id: ConfigTabId) => void;
};

/**
 * Section tabs: quiet underline style (same vocabulary as the provider tabs), icon + label +
 * error badge + dirty dot.
 * "Common" is the first tab; switching tabs is a high-frequency action, so there is no animation.
 */
export function ConfigTabs({
  active,
  errorCounts,
  dirtyTabs,
  disabled = false,
  onChange,
}: ConfigTabsProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Partial<Record<ConfigTabId, HTMLButtonElement | null>>>({});

  // When scrolling horizontally on mobile, bring the active tab back to the center of the view;
  // do nothing when there is no overflow, to avoid needless page scrolling.
  useEffect(() => {
    const scroller = listRef.current;
    const button = buttonRefs.current[active];
    if (!scroller || !button) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    button.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [active]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const count = CONFIG_TAB_IDS.length;
    const currentIndex = CONFIG_TAB_IDS.indexOf(active);
    let nextIndex = -1;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % count;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + count) % count;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = count - 1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextId = CONFIG_TAB_IDS[nextIndex];
    onChange(nextId);
    buttonRefs.current[nextId]?.focus();
  };

  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label={t('config_management.title')}
      ref={listRef}
    >
      {CONFIG_TAB_IDS.map((id) => {
        const Icon = CONFIG_TAB_ICONS[id];
        const isActive = active === id;
        const errorCount = errorCounts[id] ?? 0;
        const isDirty = dirtyTabs.has(id);
        const tabLabel = t(`config_management.visual.sections.${id}.title`);
        const accessibleLabel = [
          tabLabel,
          errorCount > 0 ? t('config_management.meta_errors', { count: errorCount }) : null,
          isDirty ? t('config_management.status_dirty_short') : null,
        ]
          .filter(Boolean)
          .join(', ');

        return (
          <button
            key={id}
            ref={(node) => {
              buttonRefs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={configTabDomId(id)}
            aria-selected={isActive}
            aria-controls={configPanelDomId(id)}
            aria-label={accessibleLabel}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            disabled={disabled}
            onClick={() => onChange(id)}
            onKeyDown={handleKeyDown}
          >
            <Icon size={15} className={styles.tabGlyph} />
            <span className={styles.tabLabel}>{tabLabel}</span>
            {errorCount > 0 ? (
              <span className={styles.tabBadge} aria-hidden="true">
                {errorCount}
              </span>
            ) : null}
            {isDirty ? <span className={styles.tabDirtyDot} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
