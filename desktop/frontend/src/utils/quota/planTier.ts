import { normalizePlanType } from './parsers';

/**
 * Pure mapping from Codex plan tier → badge style.
 *
 * - elite   → liquid platinum badge (Pro 200, plan=pro)
 * - premium → gold card badge (Pro 100; Antigravity ultra / xAI paid reuse the gold card class)
 * - plain   → plain text badge (plus/team/free/unknown)
 */
export type CodexPlanTier = 'elite' | 'premium' | 'plain';

export const PREMIUM_CODEX_PLAN_TYPES = new Set([
  'pro',
  'prolite',
  'pro-lite',
  'pro_lite',
  'self_serve_business_prolite',
]);

// Pro 200 (plan=pro) is one tier above the gold premium: a liquid platinum badge;
// see .elitePlanValue in QuotaPage.module.scss.
export const ELITE_CODEX_PLAN_TYPE = 'pro';

/**
 * Order-sensitive: 'pro' also matches PREMIUM_CODEX_PLAN_TYPES, so the elite check must come
 * first; otherwise Pro 200 silently falls back to the gold card. The contract is guarded by
 * tests/quotaPlanTier.test.ts.
 */
export function resolvePlanTier(planType: string | null | undefined): CodexPlanTier {
  const normalized = normalizePlanType(planType);
  if (!normalized) return 'plain';
  if (normalized === ELITE_CODEX_PLAN_TYPE) return 'elite';
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return 'premium';
  return 'plain';
}
