import { useMemo, type CSSProperties } from 'react';
import type { AuthFileItem } from '@/types';
import { hasAuthFileStatusWarning } from '@/features/authFiles/constants';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import styles from './VaultPulse.module.scss';

/** Max number of credentials rendered as bars; any overflow shows as a mono "+N" trailer. */
const MAX_BARS = 160;
/** Total cascade entrance budget (same 360ms vocabulary as useRevealGroup / ThroughputChart). */
const ENTRANCE_BUDGET_MS = 360;

type PulseState = 'live' | 'idle' | 'warning' | 'problem';

type PulseBar = {
  key: string;
  state: PulseState;
  disabled: boolean;
};

export type VaultPulseProps = {
  files: AuthFileItem[];
  statusBarCache: Map<string, AuthFileStatusBarData>;
};

const STATE_CLASS: Record<PulseState, string> = {
  live: styles.barLive,
  idle: styles.barIdle,
  warning: styles.barWarning,
  problem: styles.barProblem,
};

/**
 * VaultPulse — the credential spectrum, this page's signature element.
 *
 * A sibling of the dashboard's LiveWire in a different form: the wire is a traffic pulse over
 * time, while the spectrum is a health check across the credential fleet. Each vertical bar maps
 * to one credential, and health is encoded on two channels, color + height (distinguishable
 * with color blindness):
 * emerald = recent live traffic, gray = enabled but no data, amber = warning,
 * red = unavailable; disabled credentials are faded overall.
 * A purely decorative info layer (aria-hidden); the text equivalent is carried by the header's
 * meta row.
 */
export function VaultPulse({ files, statusBarCache }: VaultPulseProps) {
  const bars = useMemo<PulseBar[]>(
    () =>
      files.slice(0, MAX_BARS).map((file) => {
        const disabled = file.disabled === true;
        let state: PulseState;
        if (file.unavailable === true) {
          state = 'problem';
        } else if (hasAuthFileStatusWarning(file)) {
          state = 'warning';
        } else {
          const authIndexKey = typeof file.authIndex === 'string' ? file.authIndex : null;
          const statusData = authIndexKey ? statusBarCache.get(authIndexKey) : undefined;
          const hasTraffic =
            Boolean(statusData) &&
            (statusData?.totalSuccess ?? 0) + (statusData?.totalFailure ?? 0) > 0;
          state = hasTraffic ? 'live' : 'idle';
        }
        return { key: file.name, state, disabled };
      }),
    [files, statusBarCache]
  );

  const overflow = files.length - bars.length;
  const delayStep = bars.length > 1 ? ENTRANCE_BUDGET_MS / (bars.length - 1) : 0;

  if (bars.length === 0) {
    return (
      <div className={styles.pulse} aria-hidden="true">
        <span className={styles.idleLine} />
      </div>
    );
  }

  return (
    <div className={styles.pulse} aria-hidden="true">
      <div className={styles.bars}>
        {bars.map((bar, index) => (
          <span
            key={bar.key}
            className={`${styles.bar} ${STATE_CLASS[bar.state]} ${bar.disabled ? styles.barDisabled : ''}`}
            style={{ '--bar-delay': `${Math.round(index * delayStep)}ms` } as CSSProperties}
          />
        ))}
      </div>
      {overflow > 0 && <span className={styles.overflow}>+{overflow}</span>}
    </div>
  );
}
