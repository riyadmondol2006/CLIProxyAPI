import { useId, useState, type CSSProperties } from 'react';
import { IconPlus } from '@/components/ui/icons';
import type { ProviderFlowState } from '../hooks/useOAuthFlows';
import { BrandGlyph } from './BrandGlyph';
import styles from './ProviderTile.module.scss';

/** Initial tile cascade: starts after the header (140ms), 30ms stagger, 360ms cap for the group. */
const TILE_BASE_DELAY_MS = 140;
const TILE_STAGGER_MS = 30;
const TILE_MAX_DELAY_MS = 360;

export interface ProviderTileProps {
  label: string;
  caption: string;
  icon: string;
  index: number;
  status?: ProviderFlowState['status'];
  statusLabel?: string;
  onOpen: () => void;
}

/**
 * Provider tile: the whole tile is clickable (stretched button); clicking starts sign-in and
 * opens the authorization dialog.
 * The subline normally describes the sign-in method and switches to live status during sign-in,
 * so background progress is visible even with the dialog closed.
 * Sponsors don't use tiles; see SponsorCard.
 */
export function ProviderTile({
  label,
  caption,
  icon,
  index,
  status,
  statusLabel,
  onOpen,
}: ProviderTileProps) {
  const captionId = useId();
  // Capture the delay on mount: later re-renders (status polling) don't replay the entrance
  const [enterDelay] = useState(
    () => `${Math.min(TILE_BASE_DELAY_MS + index * TILE_STAGGER_MS, TILE_MAX_DELAY_MS)}ms`
  );

  return (
    <div
      className={styles.tile}
      data-status={status ?? 'idle'}
      style={{ '--tile-delay': enterDelay } as CSSProperties}
    >
      <span className={styles.glyph}>
        <BrandGlyph src={icon} size={20} className={styles.glyphImage} />
      </span>
      <span className={styles.text}>
        <button
          type="button"
          className={styles.main}
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-describedby={captionId}
        >
          {label}
        </button>
        <span className={styles.caption} id={captionId}>
          {status && statusLabel ? (
            <span className={styles.status}>
              <span className={styles.statusDot} aria-hidden="true" />
              {statusLabel}
            </span>
          ) : (
            <span className={styles.captionText}>{caption}</span>
          )}
        </span>
      </span>
      <span className={styles.trail} aria-hidden="true">
        <IconPlus size={15} />
      </span>
    </div>
  );
}
