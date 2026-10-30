import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { IconEye, IconEyeOff, IconSearch } from '@/components/ui/icons';
import { CopyButton } from '@/features/oauth/components/CopyButton';
import { useSetupGuide } from '@/features/setup/useSetupGuide';
import { useProxyAddresses } from '@/features/setup/useProxyAddresses';
import { maskApiKey } from '@/features/setup/snippets';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  AUTH_HEADERS,
  ENDPOINT_GROUPS,
  ERROR_ROWS,
  ROUTING_NOTES,
  buildCurl,
  type Endpoint,
} from './endpoints';
import styles from './ApiReferencePage.module.scss';

const PLACEHOLDER_KEY = 'YOUR_API_KEY';
const PLACEHOLDER_MODEL = 'MODEL_ID';
const ENDPOINT_COUNT = ENDPOINT_GROUPS.reduce((sum, group) => sum + group.endpoints.length, 0);

const matches = (endpoint: Endpoint, query: string): boolean => {
  if (!query) return true;
  const haystack = [
    endpoint.path,
    ...(endpoint.aliases ?? []),
    endpoint.summary,
    endpoint.format,
    endpoint.providers ?? '',
    endpoint.methods.join(' '),
  ]
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};

export function ApiReferencePage() {
  const { t } = useTranslation();
  const guide = useSetupGuide();
  const addresses = useProxyAddresses();
  const [baseChoice, setBaseChoice] = useState('local');
  const [model, setModel] = useState('');
  const [reveal, setReveal] = useState(false);
  const [query, setQuery] = useState('');

  const refreshGuide = guide.refresh;
  const refreshAddresses = addresses.refresh;
  useHeaderRefresh(async () => {
    await Promise.allSettled([refreshGuide(), refreshAddresses()]);
  }, guide.connected);

  const base =
    baseChoice !== 'local' && addresses.lan.includes(baseChoice) ? baseChoice : addresses.local;
  const key = guide.clientKeys[0] ?? '';
  const modelNames = useMemo(() => guide.models.map((item) => item.name), [guide.models]);
  const exampleModel = modelNames.includes(model) ? model : (modelNames[0] ?? PLACEHOLDER_MODEL);
  const realInput = { base, key: key || PLACEHOLDER_KEY, model: exampleModel };
  const shownInput = { ...realInput, key: key && !reveal ? maskApiKey(key) : realInput.key };

  const groups = useMemo(
    () =>
      ENDPOINT_GROUPS.map((group) => ({
        ...group,
        endpoints: group.endpoints.filter((endpoint) => matches(endpoint, query.trim())),
      })).filter((group) => group.endpoints.length > 0),
    [query]
  );

  const authLabel = (auth: Endpoint['auth']) => t(`api_docs.auth_${auth}`);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('api_docs.title')}</h1>
        <p className={styles.meta}>{t('api_docs.meta', { count: ENDPOINT_COUNT })}</p>
        <p className={styles.lede}>{t('api_docs.lede')}</p>
      </header>

      {/* ---------- Base URLs ---------- */}
      <section className={styles.card} aria-labelledby="api-bases">
        <h2 id="api-bases" className={styles.cardTitle}>
          {t('api_docs.bases_title')}
        </h2>
        <div className={styles.baseGrid}>
          <div className={styles.baseColumn}>
            <h3 className={styles.baseHeading}>{t('api_docs.this_computer')}</h3>
            <div className={styles.urlRow}>
              <code>{addresses.local}</code>
              <CopyButton value={addresses.local} label={t('api_docs.copy_url')} />
            </div>
            <div className={styles.urlRow}>
              <code>{`${addresses.local}/v1`}</code>
              <CopyButton value={`${addresses.local}/v1`} label={t('api_docs.copy_url')} />
            </div>
          </div>
          <div className={styles.baseColumn}>
            <h3 className={styles.baseHeading}>{t('api_docs.local_network')}</h3>
            {addresses.lan.length > 0 ? (
              addresses.lan.map((lan) => (
                <div key={lan} className={styles.urlRow}>
                  <code>{lan}</code>
                  <CopyButton value={lan} label={t('api_docs.copy_url')} />
                </div>
              ))
            ) : (
              <p className={styles.note}>
                {addresses.restartRequired ? t('api_docs.lan_restart') : t('api_docs.lan_off')}{' '}
                <Link to="/access-keys">{t('api_docs.open_access_keys')}</Link>
              </p>
            )}
          </div>
        </div>
        <p className={styles.hint}>{t('api_docs.bases_hint')}</p>
        <div className={styles.controls}>
          <label className={styles.control}>
            <span>{t('api_docs.examples_use')}</span>
            <Select
              size="sm"
              value={base === addresses.local ? 'local' : base}
              options={[
                { value: 'local', label: `${t('api_docs.this_computer')} · ${addresses.local}` },
                ...addresses.lan.map((lan) => ({
                  value: lan,
                  label: `${t('api_docs.local_network')} · ${lan}`,
                })),
              ]}
              onChange={setBaseChoice}
              ariaLabel={t('api_docs.examples_use')}
            />
          </label>
          {modelNames.length > 0 ? (
            <label className={styles.control}>
              <span>{t('api_docs.example_model')}</span>
              <Select
                size="sm"
                value={exampleModel}
                options={modelNames.map((name) => ({ value: name, label: name }))}
                onChange={setModel}
                ariaLabel={t('api_docs.example_model')}
              />
            </label>
          ) : null}
        </div>
      </section>

      {/* ---------- Authentication ---------- */}
      <section className={styles.card} aria-labelledby="api-auth">
        <h2 id="api-auth" className={styles.cardTitle}>
          {t('api_docs.auth_title')}
        </h2>
        <p className={styles.text}>{t('api_docs.auth_text')}</p>
        <ul className={styles.codeList}>
          {AUTH_HEADERS.map((header) => (
            <li key={header}>
              <code>{header}</code>
            </li>
          ))}
        </ul>
        <div className={styles.urlRow}>
          <span className={styles.rowLabel}>{t('api_docs.your_key')}</span>
          {key ? (
            <>
              <code>{reveal ? key : maskApiKey(key)}</code>
              <button
                type="button"
                className={styles.iconToggle}
                onClick={() => setReveal((value) => !value)}
                aria-pressed={reveal}
                aria-label={reveal ? t('api_docs.hide_key') : t('api_docs.show_key')}
                title={reveal ? t('api_docs.hide_key') : t('api_docs.show_key')}
              >
                {reveal ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>
              <CopyButton value={key} label={t('api_docs.copy_key')} />
            </>
          ) : (
            <span className={styles.note}>
              {t('api_docs.no_key')} <Link to="/access-keys">{t('api_docs.open_access_keys')}</Link>
            </span>
          )}
        </div>
      </section>

      {/* ---------- Model routing ---------- */}
      <section className={styles.card} aria-labelledby="api-routing">
        <h2 id="api-routing" className={styles.cardTitle}>
          {t('api_docs.routing_title')}
        </h2>
        <ul className={styles.list}>
          {ROUTING_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      {/* ---------- Endpoints ---------- */}
      <section aria-labelledby="api-endpoints" className={styles.endpoints}>
        <div className={styles.endpointsHead}>
          <h2 id="api-endpoints" className={styles.sectionTitle}>
            {t('api_docs.endpoints_title')}
          </h2>
          <label className={styles.searchBox}>
            <IconSearch size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('api_docs.search')}
              aria-label={t('api_docs.search')}
            />
          </label>
        </div>

        {groups.length === 0 ? <p className={styles.note}>{t('api_docs.no_match')}</p> : null}

        {groups.map((group) => (
          <div key={group.id} className={styles.group}>
            <h3 className={styles.groupTitle}>{group.title}</h3>
            {group.intro ? (
              <p className={styles.hint}>{group.intro.replace('{base}', base)}</p>
            ) : null}
            {group.endpoints.map((endpoint) => (
              <article key={endpoint.id} className={styles.endpoint} id={`api-${endpoint.id}`}>
                <div className={styles.endpointHead}>
                  <span className={styles.methods}>
                    {endpoint.methods.map((method) => (
                      <span key={method} className={styles.method} data-method={method}>
                        {method}
                      </span>
                    ))}
                  </span>
                  <code className={styles.path}>{endpoint.path}</code>
                  <CopyButton value={`${base}${endpoint.path}`} label={t('api_docs.copy_url')} />
                </div>
                <p className={styles.summary}>{endpoint.summary}</p>
                <dl className={styles.facts}>
                  <div>
                    <dt>{t('api_docs.auth')}</dt>
                    <dd>{authLabel(endpoint.auth)}</dd>
                  </div>
                  <div>
                    <dt>{t('api_docs.format')}</dt>
                    <dd>{endpoint.format}</dd>
                  </div>
                  {endpoint.streaming ? (
                    <div>
                      <dt>{t('api_docs.streaming')}</dt>
                      <dd>{endpoint.streaming}</dd>
                    </div>
                  ) : null}
                  {endpoint.providers ? (
                    <div>
                      <dt>{t('api_docs.providers')}</dt>
                      <dd>{endpoint.providers}</dd>
                    </div>
                  ) : null}
                  {endpoint.aliases?.length ? (
                    <div>
                      <dt>{t('api_docs.also')}</dt>
                      <dd>
                        {endpoint.aliases.map((alias) => (
                          <code key={alias}>{alias}</code>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {endpoint.notes?.length ? (
                  <ul className={styles.list}>
                    {endpoint.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
                {endpoint.example ? (
                  <details className={styles.example}>
                    <summary>{t('api_docs.example')}</summary>
                    <div className={styles.exampleBody}>
                      <CopyButton
                        value={buildCurl(endpoint.example, realInput)}
                        label={t('api_docs.copy_example')}
                        showLabel
                      />
                      <pre>
                        <code>{buildCurl(endpoint.example, shownInput)}</code>
                      </pre>
                    </div>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        ))}
      </section>

      {/* ---------- Errors ---------- */}
      <section className={styles.card} aria-labelledby="api-errors">
        <h2 id="api-errors" className={styles.cardTitle}>
          {t('api_docs.errors_title')}
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('api_docs.status')}</th>
                <th>{t('api_docs.when')}</th>
                <th>{t('api_docs.body')}</th>
              </tr>
            </thead>
            <tbody>
              {ERROR_ROWS.map((row) => (
                <tr key={`${row.status}-${row.when}`}>
                  <td>
                    <code>{row.status}</code>
                  </td>
                  <td>{row.when}</td>
                  <td>
                    <code>{row.body}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
