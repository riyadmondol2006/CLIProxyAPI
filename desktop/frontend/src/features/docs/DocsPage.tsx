import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import { IconSearch } from '@/components/ui/icons';
import { copyToClipboard } from '@/utils/clipboard';
import { useNotificationStore } from '@/stores';
import { DOCS } from './docsCatalog';
import { decorateDocHtml, docHeadings, searchDocs } from './docsUtils';
import styles from './DocsPage.module.scss';

export function DocsPage() {
  const { t } = useTranslation();
  const { docId } = useParams();
  const { showNotification } = useNotificationStore();
  const [query, setQuery] = useState('');
  const articleRef = useRef<HTMLElement>(null);

  const doc = DOCS.find((entry) => entry.id === docId) ?? DOCS[0];
  const results = useMemo(() => searchDocs(DOCS, query), [query]);
  const html = useMemo(
    () => decorateDocHtml(marked.parse(doc.markdown, { async: false }) as string, t('docs.copy')),
    [doc, t]
  );
  const headings = useMemo(() => docHeadings(doc.markdown), [doc]);

  const onArticleClick = async (event: MouseEvent<HTMLElement>) => {
    const button = (event.target as HTMLElement).closest('button[data-copy]');
    if (!button) return;
    const code = button.parentElement?.querySelector('pre')?.innerText ?? '';
    const ok = await copyToClipboard(code);
    showNotification(
      ok ? t('docs.copied') : t('notification.copy_failed'),
      ok ? 'success' : 'error'
    );
  };

  const renderGroup = (group: 'guides' | 'reference') => {
    const entries = results.filter((entry) => entry.group === group);
    if (entries.length === 0) return null;
    return (
      <div className={styles.navGroup}>
        <div className={styles.navLabel}>{t(`docs.groups.${group}`)}</div>
        {entries.map((entry) => (
          <Link
            key={entry.id}
            to={`/docs/${entry.id}`}
            className={styles.navItem}
            aria-current={entry.id === doc.id ? 'page' : undefined}
          >
            {entry.title}
          </Link>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <aside className={styles.nav} aria-label={t('docs.nav_label')}>
        <label className={styles.search}>
          <IconSearch size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('docs.search')}
            aria-label={t('docs.search')}
          />
        </label>
        {renderGroup('guides')}
        {renderGroup('reference')}
        {results.length === 0 ? <p className={styles.empty}>{t('docs.no_results')}</p> : null}
      </aside>

      <article
        ref={articleRef}
        className={styles.article}
        onClick={(event) => void onArticleClick(event)}
        // Rendered from Markdown bundled with the app.
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {headings.length > 1 ? (
        <nav className={styles.toc} aria-label={t('docs.on_this_page')}>
          <div className={styles.navLabel}>{t('docs.on_this_page')}</div>
          {headings.map((heading) => (
            <button
              key={heading.id}
              type="button"
              className={styles.tocItem}
              onClick={() =>
                articleRef.current
                  ?.querySelector(`#${CSS.escape(heading.id)}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {heading.text}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
