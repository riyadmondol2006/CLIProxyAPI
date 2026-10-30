/**
 * Pure logic for the auth file list: wildcard search, field matching, sorting.
 * React-free; consumed directly by tests/authFilesListLogic.test.ts.
 */

import type { AuthFileItem } from '@/types';
import { isPluginQuotaFile, resolveAuthProvider } from '@/utils/quota';
import {
  QUOTA_PROVIDER_TYPES,
  getAuthFileStatusMessage,
  normalizeProviderKey,
  type AuthFileQuotaFilter,
  type QuotaProviderType,
} from './constants';
import { deriveAuthFileIdentity } from './identity';
import type { AuthFilesSortMode } from './uiState';

const escapeWildcardSearchSegment = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Returns null when there is no '*' (the includes path is used). Deliberately has no ^/$
 * anchors, to keep substring semantics.
 */
export const buildWildcardSearch = (value: string): RegExp | null => {
  if (!value.includes('*')) return null;
  const pattern = value.split('*').map(escapeWildcardSearchSegment).join('.*');
  return new RegExp(pattern, 'i');
};

/**
 * "All" shows each supported card's own quota; a specific provider shows only matching quotas.
 */
export const resolveAuthFileQuotaType = (
  file: AuthFileItem,
  filter: AuthFileQuotaFilter
): QuotaProviderType | null => {
  if (!filter) return null;

  const provider = resolveAuthProvider(file);
  if (isPluginQuotaFile(file)) {
    if (filter !== 'all' && filter !== 'plugin' && provider !== filter) return null;
    return 'plugin';
  }
  if (QUOTA_PROVIDER_TYPES.has(provider as QuotaProviderType)) {
    if (filter !== 'all' && provider !== filter) return null;
    return provider as QuotaProviderType;
  }

  return null;
};

/**
 * Search haystack: file name + type + provider + account email + project ID + status/error message.
 * Explicitly excludes account: for api-key credentials, account is the API key itself
 * (see identity.ts).
 */
export const matchesAuthFileSearch = (
  file: AuthFileItem,
  term: string,
  wildcard: RegExp | null
): boolean => {
  if (!term) return true;
  const needle = term.toLowerCase();
  return [
    file.name,
    file.type,
    file.provider,
    file.email,
    file.projectId,
    getAuthFileStatusMessage(file),
  ].some((value) => {
    const content = (value || '').toString();
    return wildcard ? wildcard.test(content) : content.toLowerCase().includes(needle);
  });
};

/** Returns a new array; the input is not mutated. An unknown mode returns a copy as is. */
export const sortAuthFiles = (files: AuthFileItem[], mode: AuthFilesSortMode): AuthFileItem[] => {
  const copy = [...files];
  if (mode === 'default') {
    copy.sort((a, b) => {
      const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
      const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
      const providerCompare = providerA.localeCompare(providerB);
      if (providerCompare !== 0) return providerCompare;
      return a.name.localeCompare(b.name);
    });
  } else if (mode === 'az') {
    // Sort by the card's primary line (the email when there is an account), so what you see is
    // what gets sorted; ties are broken by file name.
    // Decorate once to avoid re-deriving inside the comparator.
    const keys = new Map(copy.map((file) => [file, deriveAuthFileIdentity(file).primary]));
    copy.sort(
      (a, b) => (keys.get(a) ?? '').localeCompare(keys.get(b) ?? '') || a.name.localeCompare(b.name)
    );
  } else if (mode === 'priority') {
    copy.sort((a, b) => {
      const pa = typeof a.priority === 'number' ? a.priority : 0;
      const pb = typeof b.priority === 'number' ? b.priority : 0;
      return pb - pa; // Higher priority first
    });
  }
  return copy;
};
