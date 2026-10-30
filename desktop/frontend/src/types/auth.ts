/**
 * Auth type definitions
 * Based on src/modules/login.js and src/core/connection.js from the original project
 */

// Login credentials
export interface LoginCredentials {
  apiBase: string;
  managementKey: string;
  rememberPassword?: boolean;
}

// Auth state
export interface AuthState {
  isAuthenticated: boolean;
  apiBase: string;
  managementKey: string;
  rememberPassword: boolean;
  serverVersion: string | null;
  serverBuildDate: string | null;
  supportsPlugin: boolean;
}

// Connection status
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';
