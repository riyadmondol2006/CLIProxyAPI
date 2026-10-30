import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { IconPlus, IconRefreshCw } from '@/components/ui/icons';
import { CopyButton } from '@/features/oauth/components/CopyButton';
import { maskApiKey } from '@/features/setup/snippets';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { apiKeysApi } from '@/services/api/apiKeys';
import {
  accessKeysApi,
  KEY_LIMIT_PERIODS,
  type KeyLimit,
  type KeyUsage,
  type ServerNetwork,
} from '@/services/api/accessKeys';
import { getErrorMessage } from '@/utils/helpers';
import { desktopApi, isDesktopApp } from '@/utils/desktop';
import {
  buildRows,
  draftFromRow,
  generateApiKey,
  isLanHost,
  parseTokenLimit,
  removeLimit,
  upsertLimit,
  usagePercent,
  type AccessKeyRow,
  type KeyLimitDraft,
} from './logic';
import styles from './AccessKeysPage.module.scss';

type Editor =
  | { mode: 'create'; apiKey: string; draft: KeyLimitDraft }
  | {
      mode: 'edit';
      row: AccessKeyRow;
      draft: KeyLimitDraft;
    };

export function AccessKeysPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const { showNotification, showConfirmation } = useNotificationStore();

  const [keys, setKeys] = useState<string[]>([]);
  const [limits, setLimits] = useState<KeyLimit[]>([]);
  const [usage, setUsage] = useState<KeyUsage[]>([]);
  const [network, setNetwork] = useState<ServerNetwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(async () => {
    if (!connected) return;
    setLoadError('');
    try {
      const [nextKeys, nextLimits, nextUsage, nextNetwork] = await Promise.all([
        apiKeysApi.list(),
        accessKeysApi.listLimits(),
        accessKeysApi.listUsage().catch(() => [] as KeyUsage[]),
        accessKeysApi.network().catch(() => null),
      ]);
      setKeys(nextKeys);
      setLimits(nextLimits);
      setUsage(nextUsage);
      setNetwork(nextNetwork);
    } catch (error) {
      setLoadError(getErrorMessage(error, t('access_keys.load_failed')));
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useHeaderRefresh(load, connected);

  const rows = useMemo(() => buildRows(keys, limits, usage), [keys, limits, usage]);
  const limitedCount = rows.filter((row) => row.tokenLimit).length;
  const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language]
  );
  const shareUrl = network?.lanUrls[0] ?? apiBase;

  /** Runs a config mutation, then reloads the page state and the shared config cache. */
  const mutate = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      if (success) showNotification(success, 'success');
      await Promise.allSettled([load(), fetchConfig(true)]);
      return true;
    } catch (error) {
      showNotification(getErrorMessage(error, t('access_keys.save_failed')), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () =>
    setEditor({ mode: 'create', apiKey: generateApiKey(), draft: draftFromRow() });

  const saveEditor = async () => {
    if (!editor) return;
    const tokenLimit = parseTokenLimit(editor.draft.tokenLimit);
    if (editor.draft.tokenLimit.trim() && !tokenLimit) {
      showNotification(t('access_keys.invalid_limit'), 'error');
      return;
    }
    if (editor.mode === 'create') {
      const apiKey = editor.apiKey.trim();
      if (!apiKey) return;
      if (keys.includes(apiKey)) {
        showNotification(t('access_keys.duplicate_key'), 'error');
        return;
      }
      const ok = await mutate(async () => {
        await apiKeysApi.replace([...keys, apiKey]);
        if (editor.draft.name.trim() || tokenLimit) {
          await accessKeysApi.replaceLimits(
            upsertLimit(limits, {
              apiKey,
              name: editor.draft.name,
              tokenLimit,
              period: editor.draft.period,
            })
          );
        }
      });
      if (ok) {
        setEditor(null);
        setCreated(apiKey);
      }
      return;
    }
    const ok = await mutate(
      () =>
        accessKeysApi.replaceLimits(
          upsertLimit(limits, {
            apiKey: editor.row.apiKey,
            name: editor.draft.name,
            tokenLimit,
            period: editor.draft.period,
            disabled: editor.row.disabled,
          })
        ),
      t('access_keys.saved')
    );
    if (ok) setEditor(null);
  };

  const rowLimit = (row: AccessKeyRow, patch: Partial<KeyLimit>): KeyLimit => ({
    apiKey: row.apiKey,
    name: row.name,
    tokenLimit: row.tokenLimit,
    period: row.period,
    disabled: row.disabled,
    ...patch,
  });

  const toggleDisabled = (row: AccessKeyRow) =>
    void mutate(
      () =>
        accessKeysApi.replaceLimits(
          upsertLimit(limits, rowLimit(row, { disabled: !row.disabled }))
        ),
      row.disabled ? t('access_keys.enabled_notice') : t('access_keys.disabled_notice')
    );

  const resetUsage = (row: AccessKeyRow) =>
    void mutate(() => accessKeysApi.resetUsage(row.apiKey), t('access_keys.reset_notice'));

  const deleteKey = (row: AccessKeyRow) =>
    showConfirmation({
      title: t('access_keys.delete_title'),
      message: t('access_keys.delete_message', { name: row.name || maskApiKey(row.apiKey) }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await mutate(async () => {
          await apiKeysApi.replace(keys.filter((key) => key !== row.apiKey));
          if (limits.some((limit) => limit.apiKey === row.apiKey)) {
            await accessKeysApi.replaceLimits(removeLimit(limits, row.apiKey));
          }
        }, t('access_keys.deleted_notice'));
      },
    });

  const allowLan = () =>
    showConfirmation({
      title: t('access_keys.lan_confirm_title'),
      message: t('access_keys.lan_confirm_message'),
      confirmText: t('access_keys.lan_enable'),
      cancelText: t('common.cancel'),
      variant: 'primary',
      onConfirm: async () => {
        await mutate(() => accessKeysApi.setHost(''));
      },
    });

  const disableLan = () =>
    showConfirmation({
      title: t('access_keys.lan_disable_confirm_title'),
      message: t('access_keys.lan_disable_confirm_message'),
      confirmText: t('access_keys.lan_disable'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await mutate(() => accessKeysApi.setHost('127.0.0.1'));
      },
    });

  /** Desktop app only: restart the service so a host change takes effect, then reload. */
  const restartService = async () => {
    setRestarting(true);
    try {
      await desktopApi.service('restart');
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const status = await desktopApi.status().catch(() => null);
        if (status?.reachable && status.tokenReady) break;
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      await load();
      showNotification(t('access_keys.lan_restarted'), 'success');
    } catch (error) {
      showNotification(getErrorMessage(error, t('access_keys.save_failed')), 'error');
    } finally {
      setRestarting(false);
    }
  };

  const periodLabel = (period: string) => t(`access_keys.periods.${period}`);

  const renderUsage = (row: AccessKeyRow) => {
    const percent = usagePercent(row.tokensUsed, row.tokenLimit);
    return (
      <div className={styles.usage}>
        <div className={styles.usageLine}>
          <span>
            {row.tokenLimit
              ? t('access_keys.usage_limited', {
                  used: numberFormat.format(row.tokensUsed),
                  limit: numberFormat.format(row.tokenLimit),
                  period: periodLabel(row.period),
                })
              : t('access_keys.usage_unlimited', {
                  used: numberFormat.format(row.tokensUsed),
                  period: periodLabel(row.period),
                })}
          </span>
          <span className={styles.usageMuted}>
            {t('access_keys.requests', { count: row.requests })}
          </span>
        </div>
        {percent !== null ? (
          <div
            className={styles.bar}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-label={t('access_keys.usage_label')}
            data-level={percent >= 100 ? 'full' : percent >= 80 ? 'high' : 'ok'}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        ) : null}
        <div className={styles.usageMuted}>
          {row.tokenLimit && row.period !== 'total' && row.periodEnd
            ? t('access_keys.resets_at', { date: dateFormat.format(new Date(row.periodEnd)) })
            : null}
          {row.lastUsed ? (
            <span>
              {' '}
              {t('access_keys.last_used', { date: dateFormat.format(new Date(row.lastUsed)) })}
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  const statusOf = (row: AccessKeyRow) =>
    row.disabled ? 'disabled' : row.exceeded ? 'exceeded' : 'active';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>{t('access_keys.title')}</h1>
          <p className={styles.meta}>
            {t('access_keys.meta', { count: rows.length, limited: limitedCount })}
          </p>
          <p className={styles.lede}>{t('access_keys.lede')}</p>
        </div>
        <Button className={styles.withIcon} onClick={openCreate} disabled={!connected || busy}>
          <IconPlus size={16} />
          {t('access_keys.new_key')}
        </Button>
      </header>

      {loadError ? <div className="error-box">{loadError}</div> : null}

      {/* ---------- LAN sharing ---------- */}
      <section className={styles.card} aria-labelledby="access-lan-title">
        <div className={styles.cardHead}>
          <h2 id="access-lan-title" className={styles.cardTitle}>
            {t('access_keys.lan_title')}
          </h2>
          {network ? (
            <span className={styles.pill} data-state={network.lanEnabled ? 'ok' : 'warn'}>
              {network.lanEnabled ? t('access_keys.lan_on') : t('access_keys.lan_off')}
            </span>
          ) : null}
        </div>
        {network ? (
          <>
            {network.lanEnabled ? (
              <>
                <p className={styles.cardText}>{t('access_keys.lan_on_text')}</p>
                {network.lanUrls.length > 0 ? (
                  <div className={styles.urlList}>
                    {network.lanUrls.map((url) => (
                      <div key={url} className={styles.urlRow}>
                        <code>{`${url}/v1`}</code>
                        <CopyButton value={`${url}/v1`} label={t('access_keys.copy_url')} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.cardText}>{t('access_keys.lan_no_address')}</p>
                )}
                <p className={styles.hint}>{t('access_keys.lan_firewall')}</p>
              </>
            ) : (
              <p className={styles.cardText}>
                {t('access_keys.lan_off_text', { host: network.host || '—' })}
              </p>
            )}
            {network.restartRequired ? (
              <div className={styles.notice}>
                <span>
                  {isDesktopApp()
                    ? t('access_keys.lan_restart_needed')
                    : t('access_keys.lan_restart')}
                </span>
                {isDesktopApp() ? (
                  <Button size="sm" onClick={() => void restartService()} loading={restarting}>
                    {t('access_keys.lan_restart_now')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div>
                {isLanHost(network.configuredHost) ? (
                  <Button variant="secondary" size="sm" onClick={disableLan} disabled={busy}>
                    {t('access_keys.lan_disable')}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={allowLan} disabled={busy}>
                    {t('access_keys.lan_enable')}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <p className={styles.cardText}>{t('access_keys.lan_unknown')}</p>
        )}
      </section>

      {/* ---------- Keys ---------- */}
      <section className={styles.keys} aria-label={t('access_keys.list_label')}>
        {loading ? (
          <p className={styles.cardText}>{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            <p>{t('access_keys.empty')}</p>
            <Button className={styles.withIcon} onClick={openCreate} disabled={!connected || busy}>
              <IconPlus size={16} />
              {t('access_keys.new_key')}
            </Button>
          </div>
        ) : (
          rows.map((row) => {
            const status = statusOf(row);
            return (
              <article key={row.apiKey} className={styles.keyCard} data-status={status}>
                <div className={styles.keyHead}>
                  <div className={styles.keyIdentity}>
                    <h3 className={styles.keyName}>{row.name || t('access_keys.unnamed')}</h3>
                    <div className={styles.keyValue}>
                      <code>{maskApiKey(row.apiKey)}</code>
                      <CopyButton value={row.apiKey} label={t('access_keys.copy_key')} />
                    </div>
                  </div>
                  <span className={styles.pill} data-state={status === 'active' ? 'ok' : 'warn'}>
                    {t(`access_keys.status.${status}`)}
                  </span>
                </div>
                {renderUsage(row)}
                <div className={styles.keyActions}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditor({ mode: 'edit', row, draft: draftFromRow(row) })}
                    disabled={busy}
                  >
                    {t('access_keys.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => toggleDisabled(row)}
                    disabled={busy}
                  >
                    {row.disabled ? t('access_keys.enable') : t('access_keys.disable')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={styles.withIcon}
                    onClick={() => resetUsage(row)}
                    disabled={busy || (row.tokensUsed === 0 && row.requests === 0)}
                  >
                    <IconRefreshCw size={14} />
                    {t('access_keys.reset_usage')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => deleteKey(row)}
                    disabled={busy || rows.length <= 1}
                    title={rows.length <= 1 ? t('access_keys.last_key_hint') : undefined}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </section>

      <p className={styles.hint}>{t('access_keys.limit_note')}</p>

      {/* ---------- Create / edit ---------- */}
      <Modal
        open={editor !== null}
        title={
          editor?.mode === 'edit' ? t('access_keys.edit_title') : t('access_keys.create_title')
        }
        onClose={() => setEditor(null)}
        closeDisabled={busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void saveEditor()} loading={busy}>
              {editor?.mode === 'edit' ? t('common.save') : t('access_keys.create')}
            </Button>
          </>
        }
      >
        {editor ? (
          <div className={styles.form}>
            <Input
              label={t('access_keys.field_name')}
              placeholder={t('access_keys.field_name_placeholder')}
              value={editor.draft.name}
              onChange={(event) =>
                setEditor({ ...editor, draft: { ...editor.draft, name: event.target.value } })
              }
            />
            {editor.mode === 'create' ? (
              <Input
                label={t('access_keys.field_key')}
                value={editor.apiKey}
                hint={t('access_keys.field_key_hint')}
                onChange={(event) => setEditor({ ...editor, apiKey: event.target.value })}
                rightElement={
                  <button
                    type="button"
                    className={styles.inlineAction}
                    onClick={() => setEditor({ ...editor, apiKey: generateApiKey() })}
                  >
                    {t('access_keys.regenerate')}
                  </button>
                }
              />
            ) : (
              <div className={styles.readonlyKey}>
                <span>{t('access_keys.field_key')}</span>
                <code>{maskApiKey(editor.row.apiKey)}</code>
              </div>
            )}
            <div className={styles.formRow}>
              <Input
                label={t('access_keys.field_limit')}
                inputMode="numeric"
                placeholder={t('access_keys.field_limit_placeholder')}
                value={editor.draft.tokenLimit}
                hint={t('access_keys.field_limit_hint')}
                onChange={(event) =>
                  setEditor({
                    ...editor,
                    draft: { ...editor.draft, tokenLimit: event.target.value },
                  })
                }
              />
              <label className={styles.selectField}>
                <span>{t('access_keys.field_period')}</span>
                <Select
                  value={editor.draft.period}
                  options={KEY_LIMIT_PERIODS.map((period) => ({
                    value: period,
                    label: t(`access_keys.period_options.${period}`),
                  }))}
                  onChange={(value) =>
                    setEditor({
                      ...editor,
                      draft: { ...editor.draft, period: value as KeyLimitDraft['period'] },
                    })
                  }
                  ariaLabel={t('access_keys.field_period')}
                  fullWidth
                />
              </label>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ---------- Share the new key ---------- */}
      <Modal
        open={created !== null}
        title={t('access_keys.created_title')}
        onClose={() => setCreated(null)}
        footer={<Button onClick={() => setCreated(null)}>{t('common.close')}</Button>}
      >
        {created ? (
          <div className={styles.form}>
            <p className={styles.cardText}>{t('access_keys.created_text')}</p>
            <div className={styles.urlRow}>
              <code>{`${shareUrl}/v1`}</code>
              <CopyButton value={`${shareUrl}/v1`} label={t('access_keys.copy_url')} />
            </div>
            <div className={styles.urlRow}>
              <code>{created}</code>
              <CopyButton value={created} label={t('access_keys.copy_key')} />
            </div>
            {!network?.lanEnabled ? (
              <p className={styles.notice}>{t('access_keys.created_lan_off')}</p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
