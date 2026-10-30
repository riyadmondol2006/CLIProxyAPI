import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore } from '@/stores';
import type { DesktopServiceAction, DesktopStatus } from '@/utils/desktop';
import { DIAGNOSTIC_STATES } from './diagnosticsLogic';
import { ServiceDiagnosticsView } from './ServiceDiagnostics';
import { useDesktopStatus } from './useDesktopStatus';
import { useServiceDiagnostics } from './useServiceDiagnostics';
import styles from './DesktopGate.module.scss';

const POLL_MS = 2000;

/** Which explanation the gate shows for the current status. */
function gateState(status: DesktopStatus | null): string {
  const service = status?.service;
  if (!status) return 'unknown';
  if (!service?.available) return 'no_systemd';
  if (!service.installed) return 'not_installed';
  if (service.active === 'active') return status.tokenReady ? 'starting' : 'no_token';
  if (service.active === 'activating') return 'starting';
  return service.active === 'failed' ? 'failed' : 'stopped';
}

/**
 * Replaces the login page in the desktop app: it connects automatically, and while the
 * proxy service is down it explains why and offers to start it.
 */
export function DesktopGate({ children }: { children: ReactElement }) {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const [attempted, setAttempted] = useState(false);
  const connecting = useRef(false);
  const { status, error, pending, run } = useDesktopStatus(POLL_MS, !isAuthenticated);
  const state = gateState(status);
  const showDiagnostics = !isAuthenticated && attempted && DIAGNOSTIC_STATES.includes(state);
  // Bumped after a start or restart so the diagnostics describe the new attempt.
  const [actions, setActions] = useState(0);
  const diagnostics = useServiceDiagnostics(showDiagnostics, `${state}:${actions}`);

  const runAction = async (action: DesktopServiceAction) => {
    await run(action);
    setActions((count) => count + 1);
  };

  const connect = async () => {
    if (connecting.current) return;
    connecting.current = true;
    try {
      await restoreSession();
    } finally {
      connecting.current = false;
      setAttempted(true);
    }
  };

  useEffect(() => {
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconnect as soon as the service is up and has written its token.
  useEffect(() => {
    if (!isAuthenticated && status?.reachable && status.tokenReady) void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, status?.reachable, status?.tokenReady]);

  if (isAuthenticated) return children;

  if (!attempted) {
    return (
      <div className={styles.screen}>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={showDiagnostics ? `${styles.card} ${styles.cardWide}` : styles.card}>
        <div className={styles.mark} aria-hidden="true" />
        <h1 className={styles.title}>{t(`desktop.gate.${state}.title`)}</h1>
        <p className={styles.text}>{t(`desktop.gate.${state}.text`)}</p>
        {state === 'no_systemd' || state === 'not_installed' ? (
          <pre className={styles.code}>
            {`cli-proxy-api --config ${status?.configPath || '~/.config/cliproxyapi/config.yaml'} \\\n  --local-token-file $XDG_RUNTIME_DIR/cliproxyapi/management-token`}
          </pre>
        ) : null}
        <div className={styles.actions}>
          {state === 'stopped' || state === 'failed' ? (
            <Button onClick={() => void runAction('start')} loading={pending === 'start'}>
              {t('desktop.start_service')}
            </Button>
          ) : null}
          {state === 'no_token' || state === 'failed' ? (
            <Button
              variant="secondary"
              onClick={() => void runAction('restart')}
              loading={pending === 'restart'}
            >
              {t('desktop.restart_service')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => void connect()}>
            {t('desktop.retry')}
          </Button>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
        {showDiagnostics ? (
          <ServiceDiagnosticsView
            diagnostics={diagnostics.diagnostics}
            loading={diagnostics.loading}
            error={diagnostics.error}
            now={diagnostics.loadedAt}
            onRefresh={() => void diagnostics.refresh()}
          />
        ) : null}
        {status?.configPath ? (
          <p className={styles.meta}>{t('desktop.config_at', { path: status.configPath })}</p>
        ) : null}
      </div>
    </div>
  );
}
