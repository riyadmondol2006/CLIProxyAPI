import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconCopy } from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './CopyButton.module.scss';

const COPIED_RESET_MS = 1400;

/**
 * Copy button: on success the icon turns into a checkmark in place (feedback right where the
 * action happens, no toast); only failures go through global notifications. Screen readers hear
 * "Copied" via role=status.
 */
export function CopyButton({
  value,
  label,
  showLabel = false,
}: {
  value: string;
  label: string;
  showLabel?: boolean;
}) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    if (!ok) {
      showNotification(t('notification.copy_failed'), 'error');
      return;
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  return (
    <button
      type="button"
      className={showLabel ? styles.labeled : styles.icon}
      onClick={handleCopy}
      aria-label={showLabel ? undefined : label}
      title={showLabel ? undefined : label}
      data-copied={copied}
    >
      <span className={styles.glyphs} aria-hidden="true">
        <IconCopy size={14} className={styles.copyGlyph} />
        <IconCheck size={14} className={styles.checkGlyph} />
      </span>
      {showLabel && <span>{label}</span>}
      <span className={styles.srOnly} role="status">
        {copied ? t('auth_login.copied') : ''}
      </span>
    </button>
  );
}
