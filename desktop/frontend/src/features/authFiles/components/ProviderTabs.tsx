import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFilterAll } from '@/components/ui/icons';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { scrollProviderTabs } from './providerTabsWheel';
import styles from './ProviderTabs.module.scss';

export type ProviderTabsProps = {
  types: string[];
  counts: Record<string, number>;
  active: string;
  resolvedTheme: ResolvedTheme;
  onChange: (type: string) => void;
};

/**
 * Provider filter tabs: laid out horizontally, with mouse-wheel and touch horizontal scrolling.
 * Brand colors appear only on icons; the active state is text plus a 2px ink underline.
 */
export function ProviderTabs({
  types,
  counts,
  active,
  resolvedTheme,
  onChange,
}: ProviderTabsProps) {
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => scrollProviderTabs(strip, event);
    // React delegates wheel events passively; use a local listener to prevent page scrolling.
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={tabsRef} className={styles.tabs} role="group" aria-label={t('auth_files.filter_all')}>
      {types.map((type) => {
        const isActive = active === type;
        const label = type === 'all' ? t('auth_files.filter_all') : getTypeLabel(t, type);
        const iconSrc = type === 'all' ? null : getAuthFileIcon(type, resolvedTheme);

        return (
          <button
            key={type}
            type="button"
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            aria-pressed={isActive}
            onClick={() => onChange(type)}
          >
            {type === 'all' ? (
              <IconFilterAll className={styles.tabGlyph} size={15} />
            ) : (
              <span
                className={styles.tabIconWrap}
                style={
                  // Consistent with the AI providers screen: the Kimi icon base changes
                  // color with the theme
                  isThemeSurfaceIconProvider(type)
                    ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
                    : undefined
                }
              >
                {iconSrc ? (
                  <img src={iconSrc} alt="" className={styles.tabIcon} />
                ) : (
                  <span className={styles.tabIconFallback}>{label.slice(0, 1).toUpperCase()}</span>
                )}
              </span>
            )}
            <span className={styles.tabLabel}>{label}</span>
            <span className={styles.tabCount}>{counts[type] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
