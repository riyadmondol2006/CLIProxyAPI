/**
 * Excluded-model rules: the single source of pure logic.
 *
 * Merged from two deleted modules: `excludedModelSelection.ts` (text/array based) and
 * `oauthExcludedRules.ts` (Set based). They were the same domain model written twice: their
 * normalize implementations were identical word for word; one just took newline-separated text
 * and the other took an iterable.
 *
 * Rule semantics (matching the backend):
 * - Case-insensitive;
 * - `*` matches any characters; all other characters are literal (the `.` in `gpt-4.1` is not
 *   a regex wildcard);
 * - Deduplication uses the lowercase key, but **keeps the spelling of the first occurrence**.
 */

/**
 * Backend encoding for "disable the whole provider". Owned only by the provider form's disabled
 * toggle; the exclusion editor never produces it.
 */
export const DISABLE_ALL_RULE = '*';

const ruleKey = (value: string): string => value.trim().toLowerCase();

export const isWildcardRule = (rule: string): boolean => rule.includes('*');

export function normalizeExcludedRules(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const rules: string[] = [];

  for (const value of values) {
    const rule = value.trim();
    const key = ruleKey(rule);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }

  return rules;
}

export const parseExcludedRulesText = (text: string): string[] =>
  normalizeExcludedRules(text.split(/\r?\n/));

export const formatExcludedRulesText = (rules: readonly string[]): string => rules.join('\n');

export function matchesExcludedRule(rule: string, modelId: string): boolean {
  const normalizedRule = ruleKey(rule);
  const normalizedModel = ruleKey(modelId);
  if (!normalizedRule || !normalizedModel) return false;
  if (!isWildcardRule(normalizedRule)) return normalizedRule === normalizedModel;

  // Split on `*`, escape regex metacharacters in each segment, then rejoin with `.*`: only `*`
  // is a wildcard.
  const escaped = normalizedRule
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i').test(normalizedModel);
}

/** Whether the model is matched by some **wildcard** rule (exact rules don't count). */
export const isMatchedByWildcardRule = (rules: Iterable<string>, modelId: string): boolean =>
  Array.from(rules).some((rule) => isWildcardRule(rule) && matchesExcludedRule(rule, modelId));

/** Whether a rule literally equals candidate (ignoring case). Wildcards are not expanded. */
export function hasExcludedRule(rules: Iterable<string>, candidate: string): boolean {
  const candidateKey = ruleKey(candidate);
  if (!candidateKey) return false;
  return Array.from(rules).some((rule) => ruleKey(rule) === candidateKey);
}

/**
 * Add or remove a single literal rule.
 *
 * Note: this filters by key and does **not** exempt rules containing `*`. The old
 * `toggleExcludedModel` refused to remove wildcard rules because its call site had two writers
 * unaware of each other (the list owned exact rules, the textarea owned wildcards) that had to
 * avoid trampling each other. In the unified component both editors live in one component, so
 * that guard belongs to the component, not to the pure function.
 */
export function toggleExcludedRule(
  rules: Iterable<string>,
  candidate: string,
  excluded: boolean
): string[] {
  const candidateRule = candidate.trim();
  const candidateKey = ruleKey(candidateRule);
  const next = normalizeExcludedRules(rules).filter((rule) => ruleKey(rule) !== candidateKey);

  if (excluded && candidateKey) next.push(candidateRule);
  return next;
}

export interface SplitExcludedRules {
  /**
   * Rules that exactly match the catalog, **rewritten to the catalog's spelling** (checkbox-driven,
   * so ids should be canonical).
   */
  exactRules: string[];
  /** Rules containing `*`, keeping the spelling from the config. */
  wildcardRules: string[];
  /**
   * Exact rules not in the catalog (e.g. ids of retired models), keeping the spelling from the
   * config.
   */
  unknownRules: string[];
  /**
   * `wildcardRules ∪ unknownRules`, but in **original order of appearance**: both the textarea
   * content and the order-sensitive diff depend on it.
   */
  customRules: string[];
}

export function splitExcludedRules(
  rules: Iterable<string>,
  candidateIds: readonly string[]
): SplitExcludedRules {
  const candidateByKey = new Map(candidateIds.map((id) => [ruleKey(id), id]));
  const exactRules: string[] = [];
  const wildcardRules: string[] = [];
  const unknownRules: string[] = [];
  const customRules: string[] = [];

  normalizeExcludedRules(rules).forEach((rule) => {
    if (isWildcardRule(rule)) {
      wildcardRules.push(rule);
      customRules.push(rule);
      return;
    }
    const candidate = candidateByKey.get(ruleKey(rule));
    if (candidate) {
      exactRules.push(candidate);
      return;
    }
    unknownRules.push(rule);
    customRules.push(rule);
  });

  return { exactRules, wildcardRules, unknownRules, customRules };
}

/**
 * Replace the "custom" half (wildcards + exact rules outside the catalog) with a block of text,
 * keeping the exact checked half.
 */
export function replaceCustomExcludedRules(
  rules: Iterable<string>,
  candidateIds: readonly string[],
  text: string
): string[] {
  const { exactRules } = splitExcludedRules(rules, candidateIds);
  return normalizeExcludedRules([...exactRules, ...parseExcludedRulesText(text)]);
}

/* -------------------------------------------------------------------------- */
/* Display-derived values                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Exclusion state of a single model.
 *
 * `both` is the subtlest level: the model is both explicitly checked and matched by some
 * wildcard rule. After unchecking it is **still excluded**, so that row must not visually
 * "uncheck", or the user would think the click failed. The old UI hid this level entirely.
 */
export type ModelExclusionState =
  | { state: 'included' }
  | { state: 'excluded'; by: 'exact' }
  | { state: 'excluded'; by: 'wildcard'; rule: string }
  | { state: 'excluded'; by: 'both'; rule: string };

export function getModelExclusionState(
  rules: readonly string[],
  modelId: string
): ModelExclusionState {
  const modelKey = ruleKey(modelId);
  if (!modelKey) return { state: 'included' };

  let hasExact = false;
  let wildcard: string | undefined;

  for (const rule of rules) {
    if (isWildcardRule(rule)) {
      if (wildcard === undefined && matchesExcludedRule(rule, modelId)) wildcard = rule;
    } else if (!hasExact && ruleKey(rule) === modelKey) {
      hasExact = true;
    }
  }

  if (hasExact && wildcard !== undefined) return { state: 'excluded', by: 'both', rule: wildcard };
  if (hasExact) return { state: 'excluded', by: 'exact' };
  if (wildcard !== undefined) return { state: 'excluded', by: 'wildcard', rule: wildcard };
  return { state: 'included' };
}

export const isModelExcluded = (rules: readonly string[], modelId: string): boolean =>
  getModelExclusionState(rules, modelId).state === 'excluded';

export interface RuleMatchSummary {
  rule: string;
  /** Catalog models matched by this rule, in catalog order. */
  matched: string[];
  matchCount: number;
}

/** Which catalog models each rule matches: the wildcard editor's live feedback relies on it. */
export const matchedModelsByRule = (
  rules: readonly string[],
  candidateIds: readonly string[]
): RuleMatchSummary[] =>
  rules.map((rule) => {
    const matched = candidateIds.filter((id) => matchesExcludedRule(rule, id));
    return { rule, matched, matchCount: matched.length };
  });

export interface ExclusionStats {
  total: number;
  excluded: number;
  available: number;
}

/**
 * Data source for the summary line and the meter.
 *
 * `excluded` counts **catalog models matched by any rule**, not `rules.length`: a single
 * `gpt-5-*` may match 6 models or none at all. Using the rule count as the numerator would
 * recreate the old UI's lie in a new place: numerator and denominator must share a source for
 * the meter to be honest.
 */
export function summarizeExclusion(
  rules: readonly string[],
  candidateIds: readonly string[]
): ExclusionStats {
  const total = candidateIds.length;
  const excluded = candidateIds.reduce(
    (count, id) => (isModelExcluded(rules, id) ? count + 1 : count),
    0
  );
  return { total, excluded, available: total - excluded };
}
