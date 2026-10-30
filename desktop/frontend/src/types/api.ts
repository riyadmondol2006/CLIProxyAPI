/**
 * API type definitions
 * Based on src/core/api-client.js and the module APIs of the original project
 */

// API client config
export interface ApiClientConfig {
  apiBase: string;
  managementKey: string;
  timeout?: number;
}

// API error
export type ApiError = Error & {
  status?: number;
  /** Axios/network error code, such as ERR_NETWORK. */
  code?: string;
  /** Machine-readable error code returned by the Management API. */
  apiCode?: string;
  details?: unknown;
  data?: unknown;
};
