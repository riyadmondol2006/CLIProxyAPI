import { useTranslation } from 'react-i18next';
import type { ConfigEditorMode } from '../constants';
import styles from './ModeSwitch.module.scss';

export type ModeSwitchProps = {
  mode: ConfigEditorMode;
  disabled?: boolean;
  onChange: (mode: ConfigEditorMode) => void;
};

/**
 * Visual / source segmented switch. Source mode is another representation of the whole document
 * (not a 9th section), so it isn't one of the tabs; it stays at the right end of the tabs row
 * (on mobile it moves up into the header action row).
 */
export function ModeSwitch({ mode, disabled = false, onChange }: ModeSwitchProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.segmented} role="group" aria-label={t('config_management.mode.label')}>
      <button
        type="button"
        className={`${styles.segment} ${mode === 'visual' ? styles.segmentActive : ''}`}
        aria-pressed={mode === 'visual'}
        disabled={disabled}
        onClick={() => onChange('visual')}
      >
        {t('config_management.mode.visual')}
      </button>
      <button
        type="button"
        className={`${styles.segment} ${mode === 'source' ? styles.segmentActive : ''}`}
        aria-pressed={mode === 'source'}
        disabled={disabled}
        onClick={() => onChange('source')}
      >
        {t('config_management.mode.source')}
      </button>
    </div>
  );
}
