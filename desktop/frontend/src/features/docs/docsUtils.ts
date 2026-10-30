/** Pure helpers for the Docs page, kept free of bundler-only imports so they can be tested. */

export interface DocEntry {
  id: string;
  group: 'guides' | 'reference';
  title: string;
  markdown: string;
}

export interface DocHeading {
  id: string;
  text: string;
}

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

/** First level-1 heading, or the fallback. */
export const docTitle = (markdown: string, fallback: string): string =>
  markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback;

/** Level-2 headings outside fenced code blocks, for the on-page outline. */
export const docHeadings = (markdown: string): DocHeading[] => {
  const headings: DocHeading[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = line.match(/^##\s+(.+)$/);
    if (match) headings.push({ id: slugify(match[1]), text: match[1].trim() });
  }
  return headings;
};

/**
 * Adds ids to h2/h3 headings and wraps code blocks with a copy button.
 * The HTML comes from bundled, trusted Markdown.
 */
export const decorateDocHtml = (html: string, copyLabel: string): string =>
  html
    .replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => {
      return `<h${level} id="${slugify(inner)}">${inner}</h${level}>`;
    })
    .replace(
      /<pre><code/g,
      `<div class="doc-code"><button type="button" class="doc-copy" data-copy="true">${copyLabel}</button><pre><code`
    )
    .replace(/<\/code><\/pre>/g, '</code></pre></div>');

/** Case-insensitive search over titles and text; title matches rank first. */
export const searchDocs = (docs: DocEntry[], query: string): DocEntry[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return docs;
  const titleHits = docs.filter((doc) => doc.title.toLowerCase().includes(needle));
  const bodyHits = docs.filter(
    (doc) => !titleHits.includes(doc) && doc.markdown.toLowerCase().includes(needle)
  );
  return [...titleHits, ...bodyHits];
};
