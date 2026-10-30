/**
 * OAuth-related types
 * Based on the original project's src/modules/oauth.js
 */

// OAuth model alias
export interface OAuthModelAliasEntry {
  name: string;
  alias: string;
  fork?: boolean;
  forceMapping?: boolean;
}
