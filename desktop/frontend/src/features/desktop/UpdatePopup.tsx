import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { IconCheckCircle2, IconDownload, IconExternalLink } from '@/components/ui/icons';
import { CopyButton } from '@/features/oauth/components/CopyButton';
import { openExternal, type DesktopUpdateInfo } from '@/utils/desktop';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  formatPackageSize,
  formatReleaseDate,
  shouldAutoCheck,
  visibleNotes,
} from './updateLogic';
import { useUpdates, type UpdateInstallState } from './useUpdates';
import styles from './UpdatePopup.module.scss';

export interface UpdatePopupViewProps {
  open: boolean;
  info: DesktopUpdateInfo;
  install: UpdateInstallState;
  relaunching: boolean;
  relaunchError: string | null;
  onInstall: () => void;
  onLater: () => void;
  onSkip: () => void;
  onRelaunch: () => void;
  onOpenRelease: () => void;
}

/** The update dialog for a given state; UpdatePopup connects it to the shared store. */
export function UpdatePopupView({
  open,
  info,
  install,
  relaunching,
  relaunchError,
  onInstall,
  onLater,
  onSkip,
  onRelaunch,
  onOpenRelease,
}: UpdatePopupViewProps) {
  const { t, i18n } = useTranslation();
  const installing = install.phase === 'installing';
  const installed = install.phase === 'installed';
  const failed = install.phase === 'error';
  const showManual =
    !installed && !installing && (!info.canInstall || (failed && info.installHint !== ''));
  const published = formatReleaseDate(info.published, i18n.language);
  const size = info.package ? formatPackageSize(info.package.size, i18n.language) : '';
  const notes = visibleNotes(info.notes);
  const current = info.current || '—';

  const footer = installed ? (
    <>
      <Button variant="secondary" onClick={onLater} disabled={relaunching}>
        {t('updates.later')}
      </Button>
      <Button onClick={onRelaunch} loading={relaunching}>
        {t('updates.restart')}
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" className={styles.skip} onClick={onSkip} disabled={installing}>
        {t('updates.skip')}
      </Button>
      <Button variant="secondary" onClick={onLater} disabled={installing}>
        {t('updates.later')}
      </Button>
      {info.canInstall ? (
        <Button onClick={onInstall} loading={installing}>
          {t('updates.install')}
        </Button>
      ) : null}
    </>
  );

  return (
    <Modal
      open={open}
      title={installed ? t('updates.installed_title') : t('updates.title')}
      onClose={onLater}
      closeDisabled={installing}
      width={600}
      className={styles.dialog}
      footer={footer}
    >
      <div className={styles.body}>
        <div className={styles.summary}>
          <p
            className={styles.versions}
            aria-label={t('updates.versions', { current, latest: info.latest })}
          >
            <code>{current}</code>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
            <code className={styles.latest}>{info.latest}</code>
          </p>
          {published || size || info.releaseUrl ? (
            <p className={styles.meta}>
              {published ? <span>{t('updates.published', { date: published })}</span> : null}
              {size ? <span>{t('updates.size', { size })}</span> : null}
              {info.releaseUrl ? (
                <button type="button" className={styles.releaseLink} onClick={onOpenRelease}>
                  {t('updates.release_notes')}
                  <IconExternalLink size={13} aria-hidden="true" />
                </button>
              ) : null}
            </p>
          ) : null}
        </div>

        {installing ? (
          <div className={styles.notice} data-tone="progress" role="status">
            <span className="loading-spinner" aria-hidden="true" />
            <span>{t('updates.installing')}</span>
          </div>
        ) : null}
        {installed ? (
          <div className={styles.notice} data-tone="success" role="status">
            <IconCheckCircle2 size={18} aria-hidden="true" />
            <span>{t('updates.installed', { version: install.version || info.latest })}</span>
          </div>
        ) : null}
        {install.phase === 'cancelled' ? (
          <p className={styles.notice} data-tone="info" role="status">
            {t('updates.cancelled')}
          </p>
        ) : null}
        {failed ? (
          <p className={styles.notice} data-tone="error" role="alert">
            {t('updates.install_failed', {
              error: install.message || t('updates.unknown_error'),
            })}
          </p>
        ) : null}
        {relaunchError !== null ? (
          <p className={styles.notice} data-tone="error" role="alert">
            {t('updates.restart_failed', { error: relaunchError || t('updates.unknown_error') })}
          </p>
        ) : null}

        {!installed && notes.shown.length > 0 ? (
          <section className={styles.notes} aria-labelledby="update-notes-title">
            <h3 id="update-notes-title">{t('updates.whats_new')}</h3>
            <ul>
              {notes.shown.map((note, index) => (
                <li key={`${index}-${note}`}>{note}</li>
              ))}
            </ul>
            {notes.more ? <p className={styles.more}>{t('updates.more_notes')}</p> : null}
          </section>
        ) : null}

        {showManual ? (
          <section className={styles.manual} aria-labelledby="update-manual-title">
            <h3 id="update-manual-title">{t('updates.manual_title')}</h3>
            <p>{info.installHint ? t('updates.manual_text') : t('updates.manual_text_no_hint')}</p>
            {info.installHint ? (
              <div className={styles.command}>
                <code>{info.installHint}</code>
                <CopyButton value={info.installHint} label={t('updates.copy_command')} />
              </div>
            ) : null}
            {info.releaseUrl ? (
              <Button
                variant="secondary"
                size="sm"
                className={styles.iconButton}
                onClick={onOpenRelease}
              >
                <IconDownload size={14} aria-hidden="true" />
                {t('updates.download')}
              </Button>
            ) : null}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Desktop app only: checks for updates on a schedule and shows the dialog when one is
 * found. The Home page's Updates section shares the same store.
 */
export function UpdatePopup() {
  const info = useUpdates((state) => state.info);
  const visible = useUpdates((state) => state.visible);
  const install = useUpdates((state) => state.install);
  const relaunching = useUpdates((state) => state.relaunching);
  const relaunchError = useUpdates((state) => state.relaunchError);
  const close = useUpdates((state) => state.close);
  const skip = useUpdates((state) => state.skip);
  const installUpdate = useUpdates((state) => state.installUpdate);
  const relaunch = useUpdates((state) => state.relaunch);

  useEffect(() => {
    const run = () => {
      const state = useUpdates.getState();
      if (shouldAutoCheck(state.autoCheck, state.info)) void state.check('auto');
    };
    const first = window.setTimeout(run, FIRST_CHECK_DELAY_MS);
    const timer = window.setInterval(run, CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  if (!info) return null;

  return (
    <UpdatePopupView
      open={visible}
      info={info}
      install={install}
      relaunching={relaunching}
      relaunchError={relaunchError}
      onInstall={() => void installUpdate()}
      onLater={close}
      onSkip={skip}
      onRelaunch={() => void relaunch()}
      onOpenRelease={() => {
        if (info.releaseUrl) void openExternal(info.releaseUrl).catch(() => undefined);
      }}
    />
  );
}
