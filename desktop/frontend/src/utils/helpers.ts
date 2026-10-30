/**
 * Helper utility functions
 * Migrated from the original project's src/utils/array.js, dom.js, html.js
 */

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check whether a value is a plain object (excluding null and arrays)
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Extract a readable message from an unknown error
 */
export const getErrorMessage = (error: unknown, fallback = ''): string => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  if (isRecord(error) && typeof error.message === 'string') return error.message || fallback;
  return fallback;
};
