/**
 * Local storage obfuscation service (reversible)
 * Based on src/utils/secure-storage.js from the original project
 *
 * IMPORTANT: this is not a security boundary, only light obfuscation against reading at a glance.
 */

import { obfuscateData, deobfuscateData, isObfuscated } from '@/utils/encryption';

interface StorageOptions {
  /**
   * Whether to obfuscate the stored value. This was historically called `encrypt`,
   * but the implementation is reversible obfuscation, not cryptographic security.
   */
  obfuscate?: boolean;
  encrypt?: boolean;
}

class ObfuscatedStorageService {
  /**
   * Store data
   */
  setItem(key: string, value: unknown, options: StorageOptions = {}): void {
    const obfuscate = options.obfuscate ?? options.encrypt ?? true;

    if (value === null || value === undefined) {
      this.removeItem(key);
      return;
    }

    const stringValue = JSON.stringify(value);
    const storedValue = obfuscate ? obfuscateData(stringValue) : stringValue;

    localStorage.setItem(key, storedValue);
  }

  /**
   * Get data
   */
  getItem<T = unknown>(key: string, options: StorageOptions = {}): T | null {
    const obfuscate = options.obfuscate ?? options.encrypt ?? true;

    const raw = localStorage.getItem(key);
    if (raw === null) return null;

    try {
      const decrypted = obfuscate ? deobfuscateData(raw) : raw;
      return JSON.parse(decrypted) as T;
    } catch {
      // JSON parsing failed; try to stay compatible with old plain-string data (non-JSON)
      try {
        // If it is encrypted, try to decrypt it and return it directly
        if (obfuscate && isObfuscated(raw)) {
          const decrypted = deobfuscateData(raw);
          // If it is still not JSON after decryption, return the raw string
          return decrypted as T;
        }
        // Unencrypted plain string, return it directly
        return raw as T;
      } catch {
        // Complete failure: silently return null (to avoid console noise)
        return null;
      }
    }
  }

  /**
   * Remove data
   */
  removeItem(key: string): void {
    localStorage.removeItem(key);
  }

  /**
   * Migrate the old plaintext cache to the encrypted format
   */
  migratePlaintextKeys(keys: string[]): void {
    keys.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;

      // Skip if it is already in the encrypted format
      if (isObfuscated(raw)) {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // The original value is not JSON; use the string as is
        parsed = raw;
      }

      try {
        this.setItem(key, parsed);
      } catch (error) {
        console.warn(`Failed to migrate key "${key}":`, error);
      }
    });
  }
}

export const obfuscatedStorage = new ObfuscatedStorageService();
