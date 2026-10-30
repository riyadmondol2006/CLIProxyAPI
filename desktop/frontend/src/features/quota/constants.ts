import type { QuotaProviderType } from './providers/types';

/**
 * Tab order = the vertical order of the old page's five sections; under the 'All' tab, cards
 * are grouped in this order too.
 */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
  'plugin',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/**
 * Page-level pagination is fixed at 20 per page, which also caps the upstream concurrency of
 * "Refresh all" at 20.
 */
export const QUOTA_PAGE_SIZE = 20;

/** Card sort: default = provider group order; soonest = soonest recovery first. */
export const QUOTA_SORT_MODES = ['default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** Matches useRevealGroup's GROUP_MAX_TOTAL: a total card cascade budget of 360ms. */
export const CARD_ENTRANCE_BUDGET_MS = 360;
