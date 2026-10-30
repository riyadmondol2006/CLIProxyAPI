import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconEye, IconEyeOff } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { CopyButton } from '@/features/oauth/components/CopyButton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useRevealGroup } from '@/hooks/motion';
import { useSetupGuide } from './useSetupGuide';
import {
  buildEndpoints,
  buildLoginCommand,
  buildSnippet,
  LOGIN_COMMANDS,
  maskApiKey,
  SETUP_CLIENT_IDS,
  type SetupClientId,
} from './snippets';
import styles from './SetupGuidePage.module.scss';

const MODEL_PREVIEW_LIMIT = 8;

type StepState = 'done' | 'todo' | 'pending';

function StepStatus({ state }: { state: StepState }) {
  const { t } = useTranslation();
  return (
    <span className={styles.status} data-state={state}>
      {state === 'done' ? <IconCheck size={12} aria-hidden="true" /> : null}
      {t(`setup_guide.status.${state}`)}
    </span>
  );
}

function Step({
  index,
  state,
  title,
  children,
  actions,
}: {
  index: number;
  state: StepState;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className={styles.step} data-state={state} data-reveal>
      <span className={styles.stepIndex} aria-hidden="true">
        {state === 'done' ? <IconCheck size={14} /> : index}
      </span>
      <div className={styles.stepBody}>
        <div className={styles.stepHead}>
          <h3 className={styles.stepTitle}>{title}</h3>
          <StepStatus state={state} />
        </div>
        <div className={styles.stepText}>{children}</div>
        {actions ? <div className={styles.stepActions}>{actions}</div> : null}
      </div>
    </li>
  );
}

function CopyRow({ label, value, display }: { label: string; value: string; display?: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.copyRow}>
      <span className={styles.copyLabel}>{label}</span>
      <code className={styles.copyValue}>{display ?? value}</code>
      <CopyButton value={value} label={t('setup_guide.copy_value', { name: label })} />
    </div>
  );
}

export function SetupGuidePage() {
  const { t } = useTranslation();
  const guide = useSetupGuide();
  useHeaderRefresh(guide.refresh, guide.connected);

  const revealRef = useRevealGroup<HTMLDivElement>();
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [client, setClient] = useState<SetupClientId>('curl');
  const [keyIndex, setKeyIndex] = useState(0);
  const [revealKey, setRevealKey] = useState(false);
  const [model, setModel] = useState('');

  const endpoints = useMemo(() => buildEndpoints(guide.apiBase), [guide.apiBase]);
  const selectedKey = guide.clientKeys[keyIndex] ?? guide.clientKeys[0] ?? '';
  const modelNames = useMemo(() => guide.models.map((item) => item.name), [guide.models]);
  const selectedModel = modelNames.includes(model) ? model : (modelNames[0] ?? '');

  const snippetFor = (apiKey: string) =>
    buildSnippet(client, { baseUrl: guide.apiBase, apiKey, model: selectedModel });
  const snippet = snippetFor(selectedKey);
  const displayedSnippet =
    revealKey || !selectedKey ? snippet : snippetFor(maskApiKey(selectedKey));

  const keysState: StepState = !guide.clientKeysLoaded
    ? 'pending'
    : guide.clientKeys.length > 0
      ? 'done'
      : 'todo';
  const accountsKnown = guide.authFileCount !== null || guide.providerKeyCount !== null;
  const accountTotal = (guide.authFileCount ?? 0) + (guide.providerKeyCount ?? 0);
  const accountsState: StepState = !accountsKnown ? 'pending' : accountTotal > 0 ? 'done' : 'todo';
  const modelsState: StepState =
    guide.modelsLoading && modelNames.length === 0
      ? 'pending'
      : modelNames.length > 0
        ? 'done'
        : 'todo';
  const doneCount = [keysState, accountsState, modelsState].filter((s) => s === 'done').length;

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = SETUP_CLIENT_IDS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setClient(SETUP_CLIENT_IDS[next]);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className={styles.page} ref={revealRef}>
      <header className={styles.header}>
        <h1 className={styles.title} data-reveal>
          {t('setup_guide.title')}
        </h1>
        <p className={styles.meta} data-reveal>
          {t('setup_guide.meta', { done: doneCount, total: 3 })}
        </p>
        <p className={styles.lede} data-reveal>
          {t('setup_guide.lede')}
        </p>
      </header>

      {/* ---------- Checklist ---------- */}
      <section className={styles.section} aria-labelledby={`${tabsId}-checklist`}>
        <h2 className={styles.sectionLabel} id={`${tabsId}-checklist`} data-reveal>
          {t('setup_guide.checklist_title')}
        </h2>
        <ol className={styles.steps}>
          <Step
            index={1}
            state={keysState}
            title={t('setup_guide.step_keys.title')}
            actions={
              <Link to="/config" className={styles.action}>
                {t('setup_guide.step_keys.action')}
              </Link>
            }
          >
            <p>
              {keysState === 'done'
                ? t('setup_guide.step_keys.done', { count: guide.clientKeys.length })
                : t('setup_guide.step_keys.todo')}
            </p>
            <p className={styles.hint}>{t('setup_guide.step_keys.hint')}</p>
          </Step>

          <Step
            index={2}
            state={accountsState}
            title={t('setup_guide.step_accounts.title')}
            actions={
              <>
                <Link to="/oauth" className={styles.action}>
                  {t('setup_guide.step_accounts.action_oauth')}
                </Link>
                <Link to="/ai-providers" className={styles.actionGhost}>
                  {t('setup_guide.step_accounts.action_providers')}
                </Link>
                <Link to="/auth-files" className={styles.actionGhost}>
                  {t('setup_guide.step_accounts.action_files')}
                </Link>
              </>
            }
          >
            <p>
              {accountsState === 'done'
                ? t('setup_guide.step_accounts.done', {
                    oauth: guide.authFileCount ?? 0,
                    keys: guide.providerKeyCount ?? 0,
                  })
                : t('setup_guide.step_accounts.todo')}
            </p>
            <p className={styles.hint}>{t('setup_guide.step_accounts.hint')}</p>
          </Step>

          <Step
            index={3}
            state={modelsState}
            title={t('setup_guide.step_models.title')}
            actions={
              <button
                type="button"
                className={styles.actionGhost}
                onClick={() => void guide.refresh()}
                disabled={guide.modelsLoading}
              >
                {t('setup_guide.step_models.action')}
              </button>
            }
          >
            <p>
              {modelsState === 'done'
                ? t('setup_guide.step_models.done', { count: modelNames.length })
                : modelsState === 'pending'
                  ? t('setup_guide.step_models.pending')
                  : t('setup_guide.step_models.todo')}
            </p>
            {modelNames.length > 0 ? (
              <ul className={styles.modelChips} aria-label={t('setup_guide.step_models.list')}>
                {modelNames.slice(0, MODEL_PREVIEW_LIMIT).map((name) => (
                  <li key={name}>
                    <code>{name}</code>
                  </li>
                ))}
                {modelNames.length > MODEL_PREVIEW_LIMIT ? (
                  <li className={styles.moreChip}>
                    {t('setup_guide.step_models.more', {
                      count: modelNames.length - MODEL_PREVIEW_LIMIT,
                    })}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </Step>
        </ol>
      </section>

      {/* ---------- Connect apps ---------- */}
      <section className={styles.section} aria-labelledby={`${tabsId}-connect`}>
        <h2 className={styles.sectionLabel} id={`${tabsId}-connect`} data-reveal>
          {t('setup_guide.connect_title')}
        </h2>
        <div className={styles.card} data-reveal>
          <p className={styles.cardLede}>{t('setup_guide.connect_lede')}</p>

          <div className={styles.copyRows}>
            <CopyRow label={t('setup_guide.endpoint_openai')} value={endpoints.openai} />
            <CopyRow label={t('setup_guide.endpoint_anthropic')} value={endpoints.anthropic} />
            <CopyRow label={t('setup_guide.endpoint_gemini')} value={endpoints.gemini} />
            {selectedKey ? (
              <CopyRow
                label={t('setup_guide.api_key')}
                value={selectedKey}
                display={revealKey ? selectedKey : maskApiKey(selectedKey)}
              />
            ) : (
              <div className={styles.copyRow}>
                <span className={styles.copyLabel}>{t('setup_guide.api_key')}</span>
                <span className={styles.missing}>{t('setup_guide.no_key')}</span>
              </div>
            )}
          </div>

          <div className={styles.controls}>
            {guide.clientKeys.length > 1 ? (
              <label className={styles.control}>
                <span>{t('setup_guide.key_select')}</span>
                <Select
                  size="sm"
                  value={String(keyIndex)}
                  options={guide.clientKeys.map((key, index) => ({
                    value: String(index),
                    label: maskApiKey(key),
                  }))}
                  onChange={(value) => setKeyIndex(Number(value))}
                  ariaLabel={t('setup_guide.key_select')}
                />
              </label>
            ) : null}
            {modelNames.length > 0 ? (
              <label className={styles.control}>
                <span>{t('setup_guide.model_select')}</span>
                <Select
                  size="sm"
                  value={selectedModel}
                  options={modelNames.map((name) => ({ value: name, label: name }))}
                  onChange={setModel}
                  ariaLabel={t('setup_guide.model_select')}
                />
              </label>
            ) : null}
            {selectedKey ? (
              <button
                type="button"
                className={styles.revealToggle}
                onClick={() => setRevealKey((value) => !value)}
                aria-pressed={revealKey}
              >
                {revealKey ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                {revealKey ? t('setup_guide.hide_key') : t('setup_guide.show_key')}
              </button>
            ) : null}
          </div>

          <div className={styles.tabs} role="tablist" aria-label={t('setup_guide.clients_label')}>
            {SETUP_CLIENT_IDS.map((id, index) => (
              <button
                key={id}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={`${tabsId}-tab-${id}`}
                aria-selected={client === id}
                aria-controls={`${tabsId}-panel`}
                tabIndex={client === id ? 0 : -1}
                className={styles.tab}
                onClick={() => setClient(id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {t(`setup_guide.clients.${id}`)}
              </button>
            ))}
          </div>

          <div
            className={styles.snippet}
            role="tabpanel"
            id={`${tabsId}-panel`}
            aria-labelledby={`${tabsId}-tab-${client}`}
          >
            <div className={styles.snippetHead}>
              <span className={styles.snippetContext}>{snippet.context}</span>
              <CopyButton value={snippet.code} label={t('setup_guide.copy_snippet')} showLabel />
            </div>
            <pre className={styles.code}>
              <code>{displayedSnippet.code}</code>
            </pre>
            <p className={styles.hint}>{t(`setup_guide.client_notes.${client}`)}</p>
          </div>
        </div>
      </section>

      {/* ---------- Terminal logins ---------- */}
      <section className={styles.section} aria-labelledby={`${tabsId}-cli`}>
        <h2 className={styles.sectionLabel} id={`${tabsId}-cli`} data-reveal>
          {t('setup_guide.cli_title')}
        </h2>
        <div className={styles.card} data-reveal>
          <p className={styles.cardLede}>{t('setup_guide.cli_lede')}</p>
          <div className={styles.copyRows}>
            {LOGIN_COMMANDS.map((command) => (
              <CopyRow
                key={command.flag}
                label={command.label}
                value={buildLoginCommand(command.flag)}
              />
            ))}
          </div>
          <p className={styles.hint}>{t('setup_guide.cli_hint')}</p>
        </div>
      </section>

      {/* ---------- Troubleshooting ---------- */}
      <section className={styles.section} aria-labelledby={`${tabsId}-help`}>
        <h2 className={styles.sectionLabel} id={`${tabsId}-help`} data-reveal>
          {t('setup_guide.help_title')}
        </h2>
        <dl className={styles.faq} data-reveal>
          {(['unauthorized', 'no_models', 'remote', 'panel'] as const).map((id) => (
            <div key={id} className={styles.faqItem}>
              <dt>{t(`setup_guide.help.${id}.q`)}</dt>
              <dd>{t(`setup_guide.help.${id}.a`)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
