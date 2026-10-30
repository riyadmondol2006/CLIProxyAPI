import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDesktopStatus } from './useDesktopStatus';

const POLL_MS = 10000;

/** Sidebar footer: live state of the proxy service, linking to Home for controls. */
export function ServiceStatusPill({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { status } = useDesktopStatus(POLL_MS);
  const running = Boolean(status?.reachable);
  const label = !status
    ? t('desktop.status_checking')
    : running
      ? t('desktop.status_running', { port: status.port })
      : t('desktop.status_stopped');

  return (
    <Link
      to="/"
      className={`service-pill${compact ? ' compact' : ''}`}
      data-state={!status ? 'unknown' : running ? 'running' : 'stopped'}
      title={label}
      aria-label={label}
    >
      <span className="service-pill-dot" aria-hidden="true" />
      {compact ? null : <span className="service-pill-label">{label}</span>}
    </Link>
  );
}
