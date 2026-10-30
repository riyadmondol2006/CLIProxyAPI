/**
 * Auth state management
 * Migrated from the original project's src/modules/login.js and src/core/connection.js
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthState, LoginCredentials, ConnectionStatus } from '@/types';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { obfuscatedStorage } from '@/services/storage/secureStorage';
import { apiClient } from '@/services/api/client';
import { LegacyBackendError, probeLegacyBackend } from '@/services/api/legacyBackendProbe';
import { useConfigStore } from './useConfigStore';
import { useModelsStore } from './useModelsStore';
import { useQuotaStore } from './useQuotaStore';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';
import { DESKTOP_MANAGEMENT_KEY, isDesktopApp } from '@/utils/desktop';

interface AuthStoreState extends AuthState {
  connectionStatus: ConnectionStatus;

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  updateServerVersion: (version: string | null, buildDate?: string | null) => void;
  updateServerPluginSupport: (supportsPlugin: boolean) => void;
}

let restoreSessionPromise: Promise<boolean> | null = null;

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      apiBase: '',
      managementKey: '',
      rememberPassword: false,
      serverVersion: null,
      serverBuildDate: null,
      supportsPlugin: false,
      connectionStatus: 'disconnected',

      // Restore session and log in automatically
      restoreSession: () => {
        if (restoreSessionPromise) return restoreSessionPromise;

        restoreSessionPromise = (async () => {
          if (isDesktopApp()) {
            // The app backend authenticates every request, so there is nothing to remember.
            try {
              await get().login({
                apiBase: detectApiBaseFromLocation(),
                managementKey: DESKTOP_MANAGEMENT_KEY,
                rememberPassword: false,
              });
              return true;
            } catch {
              return false;
            } finally {
              restoreSessionPromise = null;
            }
          }

          obfuscatedStorage.migratePlaintextKeys(['apiBase', 'apiUrl', 'managementKey']);

          const wasLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
          const legacyBase =
            obfuscatedStorage.getItem<string>('apiBase') ||
            obfuscatedStorage.getItem<string>('apiUrl', { encrypt: true });
          const legacyKey = obfuscatedStorage.getItem<string>('managementKey');

          const { apiBase, managementKey, rememberPassword } = get();
          const resolvedBase = normalizeApiBase(
            apiBase || legacyBase || detectApiBaseFromLocation()
          );
          const resolvedKey = managementKey || legacyKey || '';
          const resolvedRememberPassword =
            rememberPassword || Boolean(managementKey) || Boolean(legacyKey);

          set({
            apiBase: resolvedBase,
            managementKey: resolvedKey,
            rememberPassword: resolvedRememberPassword,
          });
          apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey });

          if (wasLoggedIn && resolvedBase && resolvedKey) {
            try {
              await get().login({
                apiBase: resolvedBase,
                managementKey: resolvedKey,
                rememberPassword: resolvedRememberPassword,
              });
              return true;
            } catch (error) {
              console.warn('Auto login failed:', error);
              return false;
            }
          }

          return false;
        })();

        return restoreSessionPromise;
      },

      // Log in
      login: async (credentials) => {
        const apiBase = normalizeApiBase(credentials.apiBase);
        const managementKey = credentials.managementKey.trim();
        const rememberPassword = credentials.rememberPassword ?? get().rememberPassword ?? false;

        try {
          set({
            connectionStatus: 'connecting',
            serverVersion: null,
            serverBuildDate: null,
            supportsPlugin: false,
          });
          useConfigStore.getState().clearCache();
          useModelsStore.getState().clearCache();
          useQuotaStore.getState().clearQuotaCache();

          // Configure the API client
          apiClient.setConfig({
            apiBase,
            managementKey,
          });

          // Test the connection - fetch config. Diagnose a legacy backend only when the v8 route is
          // missing.
          const revision = apiClient.getConnectionRevision();
          try {
            await useConfigStore.getState().fetchConfig(true);
          } catch (error) {
            if (
              (error as { status?: number })?.status === 404 &&
              revision === apiClient.getConnectionRevision() &&
              (await probeLegacyBackend(apiBase, managementKey)) &&
              revision === apiClient.getConnectionRevision()
            ) {
              throw new LegacyBackendError();
            }
            throw error;
          }

          // Login succeeded
          set({
            isAuthenticated: true,
            apiBase,
            managementKey,
            rememberPassword,
            connectionStatus: 'connected',
          });
          if (rememberPassword) {
            localStorage.setItem('isLoggedIn', 'true');
          } else {
            localStorage.removeItem('isLoggedIn');
          }
        } catch (error: unknown) {
          set({ connectionStatus: 'error' });
          throw error;
        }
      },

      // Log out
      logout: () => {
        restoreSessionPromise = null;
        apiClient.setConfig({ apiBase: '', managementKey: '' });
        useConfigStore.getState().clearCache();
        useModelsStore.getState().clearCache();
        useQuotaStore.getState().clearQuotaCache();
        set({
          isAuthenticated: false,
          apiBase: '',
          managementKey: '',
          serverVersion: null,
          serverBuildDate: null,
          supportsPlugin: false,
          connectionStatus: 'disconnected',
        });
        localStorage.removeItem('isLoggedIn');
      },

      // Check auth status
      checkAuth: async () => {
        const { managementKey, apiBase } = get();

        if (!managementKey || !apiBase) {
          return false;
        }

        try {
          // Reconfigure the client
          apiClient.setConfig({ apiBase, managementKey });
          set({ supportsPlugin: false });

          // Verify the connection
          await useConfigStore.getState().fetchConfig();

          set({
            isAuthenticated: true,
            connectionStatus: 'connected',
          });

          return true;
        } catch {
          set({
            isAuthenticated: false,
            connectionStatus: 'error',
            supportsPlugin: false,
          });
          return false;
        }
      },

      // Update server version
      updateServerVersion: (version, buildDate) => {
        set({
          serverVersion: version || null,
          serverBuildDate: buildDate || null,
        });
      },

      updateServerPluginSupport: (supportsPlugin) => {
        set({ supportsPlugin });
      },
    }),
    {
      name: STORAGE_KEY_AUTH,
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const data = obfuscatedStorage.getItem<AuthStoreState>(name);
          return data ? JSON.stringify(data) : null;
        },
        setItem: (name, value) => {
          obfuscatedStorage.setItem(name, JSON.parse(value));
        },
        removeItem: (name) => {
          obfuscatedStorage.removeItem(name);
        },
      })),
      partialize: (state) => ({
        apiBase: state.apiBase,
        ...(state.rememberPassword ? { managementKey: state.managementKey } : {}),
        rememberPassword: state.rememberPassword,
        serverVersion: state.serverVersion,
        serverBuildDate: state.serverBuildDate,
      }),
    }
  )
);

// Listen for the global unauthorized event
if (typeof window !== 'undefined') {
  window.addEventListener('unauthorized', () => {
    // In the desktop app a 401 only means the service restarted with a new token; the
    // next request picks it up, so keep the session instead of showing a login page.
    if (isDesktopApp()) return;
    useAuthStore.getState().logout();
  });

  window.addEventListener('server-version-update', ((e: CustomEvent) => {
    const detail = e.detail || {};
    useAuthStore.getState().updateServerVersion(detail.version || null, detail.buildDate || null);
  }) as EventListener);

  window.addEventListener('server-plugin-support-update', ((e: CustomEvent) => {
    useAuthStore.getState().updateServerPluginSupport(e.detail?.supportsPlugin === true);
  }) as EventListener);
}
