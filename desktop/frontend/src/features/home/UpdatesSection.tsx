import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw } from '@/components/ui/icons';
import { describeCheckedAt } from '@/features/desktop/updateLogic';
import { useUpdates, type UpdateInstallState } from '@/features/desktop/useUpdates';
import { useNow } from '@/hooks/useNow';
import type { DesktopUpdateInfo } from '@/utils/desktop';
import styles from './HomePage.module.scss';

type StatusTone = 'ok' | 'available' | 'error' | 'muted';

export interface UpdatesSectionViewProps {
  info: DesktopUpdateInfo | null;
  /** Shown until the first check reports the running version. */
  appVersion: string;
  checking: boolean;
  checkError: string | null;
  install: UpdateInstallState;
  relaunching: boolean;
  autoCheck: boolean;
  now: number;
  onCheck: () => void;
  onOpen: () => void;
  onRelaunch: () => void;
  onAutoCheckChange: (enabled: boolean) => void;
}

/** Home's "Updates" rows for a given state; UpdatesSection connects it to the store. */
export function UpdatesSectionView({
  info,
  appVersion,
  checking,
  checkError,
  install,
  relaunching,
  autoCheck,
  now,
  onCheck,
  onOpen,
  onRelaunch,
  onAutoCheckChange,
}: UpdatesSectionViewProps) {
  const { t, i18n } = useTranslation();
  const version = info?.current || appVersion || '—';
  const devBuild = info?.devBuild === true;
  const error = checkError ?? (info?.error || null);
  const installedVersion = install.phase === 'installed' ? install.version || info?.latest : '';
  const available = Boolean(info?.available && info.latest) && !devBuild;

  let tone: StatusTone = 'muted';
  let status: string;
  if (devBuild) {
    status = t('updates.home.dev_build');
  } else if (installedVersion) {
    tone = 'available';
    status = t('updates.home.restart_pending', { version: installedVersion });
  } else if (error !== null) {
    tone = 'error';
    status = t('updates.home.check_failed', { error: error || t('updates.unknown_error') });
  } else if (available) {
    tone = 'available';
    status = t('updates.home.available', { version: info?.latest });
  } else if (info) {
    tone = 'ok';
    status = t('updates.home.up_to_date');
  } else {
    status = checking ? t('updates.home.checking') : t('updates.home.not_checked');
  }

  const checkedAt =
    info && !devBuild ? describeCheckedAt(info.checkedAt, now, i18n.language) : null;
  const checkedLabel = !checkedAt
    ? ''
    : checkedAt.justNow
      ? t('updates.home.checked_just_now')
      : t('updates.home.last_checked', { time: checkedAt.text });

  return (
    <section className={styles.startup} aria-labelledby="home-updates">
      <h2 id="home-updates" className={styles.sectionTitle}>
        {t('updates.home.title')}
      </h2>
      <div className={styles.startupRows}>
        <div className={`${styles.startupRow} ${styles.updateRow}`}>
          <div className={styles.startupText}>
            <strong>{t('updates.home.version', { version })}</strong>
            <span className={styles.updateStatus} data-tone={tone}>
              {status}
            </span>
            {checkedLabel ? <span>{checkedLabel}</span> : null}
          </div>
          <div className={styles.updateActions}>
            {installedVersion ? (
              <Button size="sm" onClick={onRelaunch} loading={relaunching}>
                {t('updates.restart')}
              </Button>
            ) : available ? (
              <Button size="sm" onClick={onOpen}>
                {t('updates.home.view')}
              </Button>
            ) : null}
            {devBuild ? null : (
              <Button
                size="sm"
                variant="secondary"
                className={styles.iconButton}
                onClick={onCheck}
                loading={checking}
                disabled={install.phase === 'installing'}
              >
                {checking ? null : <IconRefreshCw size={14} aria-hidden="true" />}
                {t('updates.home.check_now')}
              </Button>
            )}
          </div>
        </div>
        <div className={styles.startupRow}>
          <div className={styles.startupText}>
            <strong>{t('updates.home.auto')}</strong>
            <span>{t('updates.home.auto_hint')}</span>
          </div>
          <ToggleSwitch
            checked={autoCheck}
            onChange={onAutoCheckChange}
            ariaLabel={t('updates.home.auto')}
          />
        </div>
      </div>
    </section>
  );
}

/** Desktop app only: the Updates section, sharing state with the update popup. */
export function UpdatesSection({ appVersion }: { appVersion: string }) {
  const info = useUpdates((state) => state.info);
  const checking = useUpdates((state) => state.checking);
  const checkError = useUpdates((state) => state.checkError);
  const install = useUpdates((state) => state.install);
  const relaunching = useUpdates((state) => state.relaunching);
  const autoCheck = useUpdates((state) => state.autoCheck);
  const check = useUpdates((state) => state.check);
  const open = useUpdates((state) => state.open);
  const relaunch = useUpdates((state) => state.relaunch);
  const setAutoCheck = useUpdates((state) => state.setAutoCheck);
  const now = useNow();

  // Show the cached state right away instead of waiting for the scheduled check. With
  // automatic checks off, nothing is fetched until the user asks.
  useEffect(() => {
    const state = useUpdates.getState();
    if (!state.info && state.autoCheck) void state.check('silent');
  }, []);

  return (
    <UpdatesSectionView
      info={info}
      appVersion={appVersion}
      checking={checking}
      checkError={checkError}
      install={install}
      relaunching={relaunching}
      autoCheck={autoCheck}
      now={now}
      onCheck={() => void check('manual')}
      onOpen={open}
      onRelaunch={() => void relaunch()}
      onAutoCheckChange={setAutoCheck}
    />
  );
}
