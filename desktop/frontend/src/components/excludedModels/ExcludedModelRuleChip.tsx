import type { ReactNode } from 'react';
import { IconX } from '@/components/ui/icons';
import styles from './ExcludedModelRuleChip.module.scss';

/**
 * Exclusion chip: three variants distinguished by **source**, replacing two near-duplicate
 * hand-written markups (`.excludedModelChip` in `AuthFileDetailsSheet.module.scss` and
 * `.customRuleChip` in `AuthFilesOAuthExcludedEditPage.module.scss`).
 *
 * - `exact`    Solid primary tint: a model the user explicitly checked; can be removed directly.
 * - `wildcard` Dashed: a model derived from a wildcard rule. No ✕ — removing it means editing
 *              that rule, and offering a ✕ would promise something it can't do.
 * - `unknown`  Dashed and muted: an exact rule that isn't in the catalog (e.g. a retired model
 *              id); can be removed.
 */
export type ExcludedModelChipVariant = 'exact' | 'wildcard' | 'unknown';

export interface ExcludedModelRuleChipProps {
  label: string;
  variant?: ExcludedModelChipVariant;
  /** Secondary note, e.g. the rule this chip was derived from. */
  detail?: string;
  /** When omitted, the ✕ is not rendered. */
  onRemove?: () => void;
  removeAriaLabel?: string;
  disabled?: boolean;
  title?: string;
}

/** Wrapping row for chips. Exported on its own so each consumer doesn't rewrite flex-wrap. */
export function ExcludedModelChipRow({ children }: { children: ReactNode }) {
  return <div className={styles.chipRow}>{children}</div>;
}

export function ExcludedModelRuleChip({
  label,
  variant = 'exact',
  detail,
  onRemove,
  removeAriaLabel,
  disabled = false,
  title,
}: ExcludedModelRuleChipProps) {
  return (
    <span
      className={`${styles.chip} ${styles[variant]}`}
      title={title ?? (detail ? `${label} — ${detail}` : label)}
    >
      <span className={styles.label}>{label}</span>
      {detail ? <span className={styles.detail}>{detail}</span> : null}
      {onRemove ? (
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeAriaLabel ?? label}
        >
          <IconX size={12} />
        </button>
      ) : null}
    </span>
  );
}
