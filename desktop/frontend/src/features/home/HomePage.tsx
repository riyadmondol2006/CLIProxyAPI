import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  IconBookOpen,
  IconBot,
  IconKey,
  IconNetwork,
  IconPower,
  IconRefreshCw,
  IconSidebarLogs,
  IconSidebarOauth,
  IconSidebarProviders,
} from '@/components/ui/icons';
import { CopyButton } from '@/features/oauth/components/CopyButton';
import { useSetupGuide } from '@/features/setup/useSetupGuide';
import { buildEndpoints, maskApiKey } from '@/features/setup/snippets';
import { useDesktopStatus } from '@/features/desktop/useDesktopStatus';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { accessKeysApi, type ServerNetwork } from '@/services/api/accessKeys';
import { isDesktopApp } from '@/utils/desktop';
import styles from './HomePage.module.scss';

const DESKTOP_POLL_MS = 5000;

interface Tile {
  to: string;
  label: string;
  value: string;
  hint: string;
  tone: 'ok' | 'todo' | 'neutral';
}

interface Action {
  to: string;
  icon: ReactNode;
  title: string;
  text: string;
}

export function HomePage() {
  const { t } = useTranslation();
  const desktop = isDesktopApp();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const guide = useSetupGuide();
  const desktopStatus = useDesktopStatus(DESKTOP_POLL_MS, desktop);
  const [network, setNetwork] = useState<ServerNetwork | null>(null);

  useEffect(() => {
    if (!guide.connected) return;
    accessKeysApi
      .network()
      .then(setNetwork)
      .catch(() => setNetwork(null));
  }, [guide.connected]);

  useHeaderRefresh(async () => {
    await Promise.allSettled([
      guide.refresh(),
      desktopStatus.refresh(),
      accessKeysApi.network().then(setNetwork),
    ]);
  }, guide.connected);

  const endpoints = useMemo(() => buildEndpoints(guide.apiBase), [guide.apiBase]);
  const localBase = network
    ? `http://127.0.0.1:${network.port}`
    : desktopStatus.status
      ? `http://127.0.0.1:${desktopStatus.status.port}`
      : endpoints.anthropic;
  const clientKey = guide.clientKeys[0] ?? '';
  const accounts = (guide.authFileCount ?? 0) + (guide.providerKeyCount ?? 0);
  const running = desktop ? Boolean(desktopStatus.status?.reachable) : guide.connected;

  const tiles: Tile[] = [
    {
      to: '/auth-files',
      label: t('home.tiles.accounts'),
      value: String(accounts),
      hint: accounts > 0 ? t('home.tiles.accounts_hint') : t('home.tiles.accounts_empty'),
      tone: accounts > 0 ? 'ok' : 'todo',
    },
    {
      to: '/quick-start',
      label: t('home.tiles.models'),
      value: String(guide.models.length),
      hint: guide.models.length > 0 ? t('home.tiles.models_hint') : t('home.tiles.models_empty'),
      tone: guide.models.length > 0 ? 'ok' : 'todo',
    },
    {
      to: '/access-keys',
      label: t('home.tiles.keys'),
      value: String(guide.clientKeys.length),
      hint: t('home.tiles.keys_hint'),
      tone: guide.clientKeys.length > 0 ? 'ok' : 'todo',
    },
    {
      to: '/access-keys',
      label: t('home.tiles.lan'),
      value: network
        ? network.lanEnabled
          ? t('home.tiles.lan_on')
          : t('home.tiles.lan_off')
        : '—',
      hint: network?.lanEnabled
        ? (network.lanUrls[0] ?? t('home.tiles.lan_on_hint'))
        : t('home.tiles.lan_off_hint'),
      tone: 'neutral',
    },
  ];

  const actions: Action[] = [
    {
      to: '/oauth',
      icon: <IconSidebarOauth size={18} />,
      title: t('home.actions.signin'),
      text: t('home.actions.signin_text'),
    },
    {
      to: '/ai-providers',
      icon: <IconSidebarProviders size={18} />,
      title: t('home.actions.provider'),
      text: t('home.actions.provider_text'),
    },
    {
      to: '/quick-start',
      icon: <IconBot size={18} />,
      title: t('home.actions.connect'),
      text: t('home.actions.connect_text'),
    },
    {
      to: '/access-keys',
      icon: <IconKey size={18} />,
      title: t('home.actions.share'),
      text: t('home.actions.share_text'),
    },
    {
      to: '/docs',
      icon: <IconBookOpen size={18} />,
      title: t('home.actions.docs'),
      text: t('home.actions.docs_text'),
    },
    {
      to: '/logs',
      icon: <IconSidebarLogs size={18} />,
      title: t('home.actions.logs'),
      text: t('home.actions.logs_text'),
    },
  ];

  const steps = [
    { done: guide.clientKeys.length > 0, label: t('home.steps.key'), to: '/access-keys' },
    { done: accounts > 0, label: t('home.steps.account'), to: '/oauth' },
    { done: guide.models.length > 0, label: t('home.steps.models'), to: '/quick-start' },
  ];
  const allDone = steps.every((step) => step.done);
  const pending = desktopStatus.pending;

  return (
    <div className={styles.page}>
      {/* ---------- Hero ---------- */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroMain}>
          <span className={styles.statusBadge} data-state={running ? 'running' : 'stopped'}>
            <span className={styles.statusDot} aria-hidden="true" />
            {running ? t('home.running') : t('home.stopped')}
          </span>
          <h1 className={styles.title}>{t('home.title')}</h1>
          <p className={styles.subtitle}>
            {running
              ? t('home.subtitle_running', { address: localBase.replace(/^https?:\/\//, '') })
              : t('home.subtitle_stopped')}
          </p>
          <div className={styles.heroMeta}>
            {serverVersion ? <span>{t('home.version', { version: serverVersion })}</span> : null}
            {desktop && desktopStatus.status?.configPath ? (
              <span title={desktopStatus.status.configPath}>
                {t('home.config', { path: desktopStatus.status.configPath })}
              </span>
            ) : null}
          </div>
        </div>
        {desktop ? (
          <div className={styles.heroActions}>
            {running ? (
              <>
                <Button
                  variant="secondary"
                  className={styles.iconButton}
                  onClick={() => void desktopStatus.run('restart')}
                  loading={pending === 'restart'}
                  disabled={pending !== null}
                >
                  <IconRefreshCw size={15} />
                  {t('desktop.restart_service')}
                </Button>
                <Button
                  variant="ghost"
                  className={styles.iconButton}
                  onClick={() => void desktopStatus.run('stop')}
                  loading={pending === 'stop'}
                  disabled={pending !== null}
                >
                  <IconPower size={15} />
                  {t('desktop.stop_service')}
                </Button>
              </>
            ) : (
              <Button
                className={styles.iconButton}
                onClick={() => void desktopStatus.run('start')}
                loading={pending === 'start'}
                disabled={pending !== null}
              >
                <IconPower size={15} />
                {t('desktop.start_service')}
              </Button>
            )}
            {desktopStatus.error ? <p className={styles.error}>{desktopStatus.error}</p> : null}
          </div>
        ) : null}
      </section>

      {/* ---------- Connection ---------- */}
      <section className={styles.connect} aria-labelledby="home-connect">
        <div className={styles.sectionHead}>
          <h2 id="home-connect" className={styles.sectionTitle}>
            {t('home.connect_title')}
          </h2>
          <Link to="/quick-start" className={styles.sectionLink}>
            {t('home.connect_more')} →
          </Link>
        </div>
        <div className={styles.copyGrid}>
          <div className={styles.copyItem}>
            <span className={styles.copyLabel}>{t('home.base_url')}</span>
            <code>{`${localBase}/v1`}</code>
            <CopyButton value={`${localBase}/v1`} label={t('home.copy_base_url')} />
          </div>
          {network?.lanEnabled && network.lanUrls[0] ? (
            <div className={styles.copyItem}>
              <span className={styles.copyLabel}>{t('home.lan_url')}</span>
              <code>{`${network.lanUrls[0]}/v1`}</code>
              <CopyButton value={`${network.lanUrls[0]}/v1`} label={t('home.copy_lan_url')} />
            </div>
          ) : null}
          <div className={styles.copyItem}>
            <span className={styles.copyLabel}>{t('home.api_key')}</span>
            <code>{clientKey ? maskApiKey(clientKey) : '—'}</code>
            {clientKey ? <CopyButton value={clientKey} label={t('home.copy_api_key')} /> : null}
          </div>
        </div>
      </section>

      {/* ---------- Overview tiles ---------- */}
      <section className={styles.tiles} aria-label={t('home.overview')}>
        {tiles.map((tile) => (
          <Link key={tile.label} to={tile.to} className={styles.tile} data-tone={tile.tone}>
            <span className={styles.tileLabel}>{tile.label}</span>
            <span className={styles.tileValue}>{tile.value}</span>
            <span className={styles.tileHint}>{tile.hint}</span>
          </Link>
        ))}
      </section>

      {/* ---------- First steps ---------- */}
      {!allDone ? (
        <section className={styles.steps} aria-labelledby="home-steps">
          <h2 id="home-steps" className={styles.sectionTitle}>
            {t('home.steps_title')}
          </h2>
          <ol>
            {steps.map((step, index) => (
              <li key={step.label} data-done={step.done}>
                <span className={styles.stepIndex} aria-hidden="true">
                  {step.done ? '✓' : index + 1}
                </span>
                <Link to={step.to}>{step.label}</Link>
                <span className={styles.stepState}>
                  {step.done ? t('setup_guide.status.done') : t('setup_guide.status.todo')}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* ---------- Actions ---------- */}
      <section aria-labelledby="home-actions" className={styles.actionsSection}>
        <h2 id="home-actions" className={styles.sectionTitle}>
          {t('home.actions_title')}
        </h2>
        <div className={styles.actions}>
          {actions.map((action) => (
            <Link key={action.to + action.title} to={action.to} className={styles.action}>
              <span className={styles.actionIcon}>{action.icon}</span>
              <span className={styles.actionText}>
                <strong>{action.title}</strong>
                <span>{action.text}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {network && !network.lanEnabled ? (
        <p className={styles.footnote}>
          <IconNetwork size={14} /> {t('home.lan_footnote')}
        </p>
      ) : null}
    </div>
  );
}
