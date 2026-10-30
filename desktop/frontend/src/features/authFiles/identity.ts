/**
 * Credential identity derivation: the card's primary row shows the "account" instead of the
 * file name.
 * React-free — consumed directly by tests/authFileIdentity.test.ts.
 *
 * Background: real file names look like codex-<hash8>-<email>-<plan>.json, with the email in
 * the middle, so single-line tail truncation keeps exactly the provider prefix that the type
 * badge already conveys.
 *
 * Two red lines:
 * 1. Read only email / projectId. The backend also sends account, but for api-key credentials
 *    the account is the API key itself (sdk/cliproxy/auth/types.go AccountInfo); once it reaches
 *    the primary row, the title, or the search haystack, that's a key leak. And on the oauth
 *    branch, account is a redundant copy of email from the same source.
 * 2. Don't extract email from the file name with a regex. codex uses '-' as the separator, but
 *    '-' is valid in both the local part and the domain, so
 *    codex-abc12345-first-last@example.com-team can't be split correctly by any regex — it would
 *    only produce plausible-looking wrong values. Providers that need email all have
 *    json:"email" on the backend, and kimi, which has no email, has none to extract from its
 *    file name anyway.
 */

import type { AuthFileItem } from '@/types';

export type AuthFileIdentityKind = 'email' | 'projectId' | 'fileName';

export type AuthFileIdentity = {
  /** Card primary row. Empty string when there's no identity clue at all — no fake placeholder. */
  primary: string;
  /**
   * Source of the primary row. With 'fileName' the primary row renders in mono, and the
   * secondary row doesn't repeat it.
   */
  kind: AuthFileIdentityKind;
  /** Card secondary row (file name without .json); null = don't render the row. */
  secondary: string | null;
  /** Original full file name, used for the secondary row's title. */
  fullName: string;
};

/**
 * AuthFileItem has an index signature, so non-string values from the backend pass type checks —
 * block them here.
 */
const readIdentityText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** Strip the .json suffix (case-insensitive); only applies if something remains afterwards. */
export const stripJsonExtension = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.length <= 5) return trimmed;
  return trimmed.toLowerCase().endsWith('.json') ? trimmed.slice(0, -5) : trimmed;
};

/**
 * Identity fallback chain: email → projectId → file name (without .json).
 * Deliberately provider-agnostic: runtime-only virtual credentials (name === email === channel
 * ID) are handled structurally by the secondary-row dedup guard, which is sturdier than a
 * per-provider allowlist.
 */
export const deriveAuthFileIdentity = (file: AuthFileItem): AuthFileIdentity => {
  const fullName = readIdentityText(file.name);
  const base = stripJsonExtension(fullName);
  const email = readIdentityText(file.email);
  const projectId = readIdentityText(file.projectId);

  const kind: AuthFileIdentityKind = email ? 'email' : projectId ? 'projectId' : 'fileName';
  const primary = email || projectId || base;

  const secondary =
    kind === 'fileName' || !base || base.toLowerCase() === primary.toLowerCase() ? null : base;

  return { primary, kind, secondary, fullName };
};
