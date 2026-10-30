/**
 * Validation utilities
 */

/**
 * Validate the API key character set (only printable ASCII characters are allowed)
 */
export function isValidApiKeyCharset(key: string): boolean {
  if (!key) return false;
  return /^[\x21-\x7E]+$/.test(key);
}
