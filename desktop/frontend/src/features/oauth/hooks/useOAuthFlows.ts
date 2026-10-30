import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useNotificationStore } from '@/stores';
import { oauthApi, pluginsApi } from '@/services/api';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import { createOAuthAttempts, type OAuthAttempt } from '../oauthAttempts';
import { validateDevinCallback } from '../devinOAuth';
import { resolveCallbackUrl } from '../callbackUrl';
import { openAuthUrlInBrowser } from '@/utils/desktop';
import {
  buildPluginOAuthProviderCards,
  type OAuthProviderCard,
  type PluginOAuthProviderCard,
} from '../providers';

export interface ProviderFlowState {
  url?: string;
  userCode?: string;
  state?: string;
  status?: 'waiting' | 'success' | 'error';
  error?: string;
  polling?: boolean;
  cancelling?: boolean;
  cancelError?: string;
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
  /** Local validation failure (not submitted to the backend), shown inline below the input. */
  callbackValidation?: string;
}

interface UseOAuthFlowsOptions {
  providerCards: OAuthProviderCard[];
  /**
   * Whether this provider's dialog is open. While it is open, results are already shown inline
   * in the dialog, so no duplicate toast is raised; the success state also stays until the
   * dialog closes instead of auto-clearing after 5 seconds.
   */
  isFocused: (provider: string) => boolean;
}

const SUCCESS_RESET_DELAY_MS = 5000;
const POLL_INTERVAL_MS = 3000;

const getAuthKey = (provider: string, suffix: string) =>
  `auth_login.${provider.replace('-', '_')}_${suffix}`;

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

/** Enabled plugins that declare OAuth capability → appended after the built-in providers. */
export function usePluginOAuthProviders(apiBase: string) {
  const [pluginProviders, setPluginProviders] = useState<PluginOAuthProviderCard[]>([]);

  useEffect(() => {
    let cancelled = false;
    pluginsApi
      .list()
      .then((response) => {
        if (!cancelled)
          setPluginProviders(buildPluginOAuthProviderCards(response.plugins, apiBase));
      })
      .catch(() => {
        if (!cancelled) setPluginProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  return pluginProviders;
}

/**
 * One independent sign-in attempt per provider: start → poll status → success/failure, with
 * optional manual callback submission and Devin session cancellation. Once an attempt is
 * invalidated, requests already sent no longer write state when they land.
 */
export function useOAuthFlows({ providerCards, isFocused }: UseOAuthFlowsOptions) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [states, setStates] = useState<Record<string, ProviderFlowState>>({});
  /** Credentials added this session (incl. Vertex imports); reset to 0 on connection switch. */
  const [addedCount, setAddedCount] = useState(0);
  const recordCredentialAdded = useCallback(() => setAddedCount((count) => count + 1), []);
  const attempts = useRef(
    createOAuthAttempts({
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (timer) => window.clearTimeout(timer),
    })
  );

  const clearTimers = useCallback(() => {
    attempts.current.invalidateAll();
  }, []);

  useEffect(() => {
    // Invalidate synchronously on connection changes, including a new key on
    // the same server. Never send cleanup requests through the new connection.
    const unsubscribe = useAuthStore.subscribe((current, previous) => {
      if (
        current.apiBase !== previous.apiBase ||
        current.managementKey !== previous.managementKey ||
        current.isAuthenticated !== previous.isAuthenticated
      ) {
        clearTimers();
        setStates({});
        setAddedCount(0);
      }
    });
    return () => {
      unsubscribe();
      clearTimers();
    };
  }, [clearTimers]);

  const providerText = (provider: string, suffix: string) => {
    const card = providerCards.find((item) => item.id === provider);
    return card?.kind === 'plugin'
      ? t(`auth_login.plugin_${suffix}`, { name: card.title })
      : t(getAuthKey(provider, suffix));
  };

  /** When the dialog is not open, the toast is the only result feedback. */
  const notify = (provider: string, message: string, type: 'success' | 'error' | 'warning') => {
    if (!isFocused(provider)) showNotification(message, type);
  };

  const updateProviderState = (provider: string, next: Partial<ProviderFlowState>) => {
    setStates((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] ?? {}), ...next },
    }));
  };

  const resetProviderAttempt = (provider: string) => {
    attempts.current.get(provider)?.invalidate();
    setStates((prev) => ({ ...prev, [provider]: {} }));
  };

  const completeProviderAuth = (provider: string) => {
    const resetAttempt = attempts.current.begin(provider);
    notifyAuthFilesChanged();
    recordCredentialAdded();
    updateProviderState(provider, {
      url: undefined,
      state: undefined,
      status: 'success',
      error: undefined,
      polling: false,
      cancelling: false,
      cancelError: undefined,
      callbackUrl: '',
      callbackSubmitting: false,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackValidation: undefined,
    });
    // When it completes in the background the tile briefly shows "Added"; if the dialog is
    // open, keep the success page and clear it when the dialog closes.
    resetAttempt.schedule(() => {
      if (!isFocused(provider)) resetProviderAttempt(provider);
    }, SUCCESS_RESET_DELAY_MS);
  };

  const startPolling = (provider: string, state: string, attempt: OAuthAttempt) => {
    attempt.poll(
      () => oauthApi.getAuthStatus(state, attempt.signal),
      (res) => {
        if (res.status === 'ok') {
          completeProviderAuth(provider);
          notify(provider, providerText(provider, 'oauth_status_success'), 'success');
        } else if (res.status === 'error') {
          if (provider === 'devin') {
            // Expired, denied and cancelled states cannot accept another callback.
            attempt.invalidate();
            updateProviderState(provider, {
              url: undefined,
              state: undefined,
              callbackUrl: '',
              callbackSubmitting: false,
              callbackStatus: undefined,
              callbackError: undefined,
              callbackValidation: undefined,
            });
          }
          updateProviderState(provider, { status: 'error', error: res.error, polling: false });
          notify(
            provider,
            `${providerText(provider, 'oauth_status_error')} ${res.error || ''}`,
            'error'
          );
        }
        return res.status === 'wait';
      },
      (err) => {
        updateProviderState(provider, {
          status: 'error',
          error: getErrorMessage(err),
          polling: false,
        });
      },
      POLL_INTERVAL_MS
    );
  };

  const cancelAuth = async (provider: string) => {
    const state = states[provider]?.state;
    if (provider !== 'devin' || !state || states[provider]?.cancelling) return;
    // Replace the attempt before DELETE so late polls/callback submissions cannot
    // overwrite the cancellation result or a subsequent login.
    const attempt = attempts.current.begin(provider);
    updateProviderState(provider, {
      cancelling: true,
      cancelError: undefined,
      polling: true,
      callbackSubmitting: false,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackValidation: undefined,
    });
    try {
      const result = await oauthApi.cancelSession(state, attempt.signal);
      if (!attempt.isCurrent()) return;
      if (result.cancelled) {
        resetProviderAttempt(provider);
        notify(provider, t('auth_login.devin_oauth_cancelled'), 'success');
        return;
      }
      // A completed or expired session returns cancelled=false. Read its real
      // status rather than claiming cancellation or losing a completed login.
    } catch (err: unknown) {
      if (!attempt.isCurrent()) return;
      const message = getErrorMessage(err);
      updateProviderState(provider, { cancelError: message });
      notify(provider, `${t('auth_login.devin_oauth_cancel_error')} ${message}`, 'error');
    }
    updateProviderState(provider, {
      cancelling: false,
      status: 'waiting',
      error: undefined,
    });
    startPolling(provider, state, attempt);
  };

  const startAuth = async (provider: string) => {
    // A network error can stop polling while the server is still waiting. Require
    // explicit cancellation before replacing that Devin session.
    if (provider === 'devin' && states[provider]?.state) return;
    const attempt = attempts.current.begin(provider);
    updateProviderState(provider, {
      url: undefined,
      userCode: undefined,
      state: undefined,
      status: 'waiting',
      polling: true,
      cancelling: false,
      cancelError: undefined,
      error: undefined,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackValidation: undefined,
      callbackUrl: '',
      callbackSubmitting: false,
    });
    try {
      const res = await oauthApi.startAuth(provider, attempt.signal);
      if (!attempt.isCurrent()) return;
      if (!res.state) {
        const message = t('auth_login.missing_state');
        updateProviderState(provider, {
          url: res.url,
          state: undefined,
          status: 'error',
          error: message,
          polling: false,
        });
        notify(provider, message, 'error');
        return;
      }
      updateProviderState(provider, {
        url: res.url,
        userCode: res.user_code,
        state: res.state,
        status: 'waiting',
        polling: true,
      });
      openAuthUrlInBrowser(res.url);
      startPolling(provider, res.state, attempt);
    } catch (err: unknown) {
      if (!attempt.isCurrent()) return;
      const message = getErrorMessage(err);
      updateProviderState(provider, { status: 'error', error: message, polling: false });
      notify(
        provider,
        `${providerText(provider, 'oauth_start_error')}${message ? ` ${message}` : ''}`,
        'error'
      );
    }
  };

  const setCallbackInput = (provider: string, value: string) => {
    updateProviderState(provider, {
      callbackUrl: value,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackValidation: undefined,
    });
  };

  const submitCallback = async (provider: string) => {
    const attempt = attempts.current.get(provider);
    if (!attempt?.isCurrent()) return;
    if (
      provider === 'devin' &&
      (states[provider]?.cancelling || states[provider]?.status !== 'waiting')
    ) {
      return;
    }
    const rejectInput = (key: string) =>
      updateProviderState(provider, { callbackValidation: t(key) });
    const callbackInput = (states[provider]?.callbackUrl || '').trim();
    if (!callbackInput) {
      rejectInput(
        provider === 'xai'
          ? 'auth_login.xai_callback_required'
          : 'auth_login.oauth_callback_required'
      );
      return;
    }
    if (provider === 'devin') {
      const callbackError = validateDevinCallback(callbackInput, states[provider]?.state);
      if (callbackError) {
        rejectInput(`auth_login.devin_callback_${callbackError}`);
        return;
      }
    }
    const redirectUrl = resolveCallbackUrl(provider, callbackInput, states[provider]?.state);
    if (!redirectUrl) {
      rejectInput(
        provider === 'xai' ? 'auth_login.xai_callback_state_missing' : 'auth_login.missing_state'
      );
      return;
    }
    updateProviderState(provider, {
      callbackSubmitting: true,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackValidation: undefined,
    });
    try {
      await oauthApi.submitCallback(provider, redirectUrl, attempt.signal);
      if (!attempt.isCurrent()) return;
      updateProviderState(provider, { callbackSubmitting: false, callbackStatus: 'success' });
      notify(provider, t('auth_login.oauth_callback_success'), 'success');
      // The backend only accepts callbacks for pending logins. If a failed status
      // request stopped polling, resume it so the card can report the outcome.
      const loginState = states[provider]?.state;
      if (loginState && !attempt.isPolling()) {
        updateProviderState(provider, { status: 'waiting', error: undefined, polling: true });
        startPolling(provider, loginState, attempt);
      }
    } catch (err: unknown) {
      if (!attempt.isCurrent()) return;
      const status = getErrorStatus(err);
      const message = getErrorMessage(err);
      const errorMessage =
        status === 404
          ? t('auth_login.oauth_callback_upgrade_hint', {
              defaultValue: 'Please update CLI Proxy API or check the connection.',
            })
          : message || undefined;
      updateProviderState(provider, {
        callbackSubmitting: false,
        callbackStatus: 'error',
        callbackError: errorMessage,
      });
      notify(
        provider,
        errorMessage
          ? `${t('auth_login.oauth_callback_error')} ${errorMessage}`
          : t('auth_login.oauth_callback_error'),
        'error'
      );
    }
  };

  /**
   * Closing the dialog dismisses the success page, and the tile returns to its initial state,
   * ready to sign in again.
   */
  const dismissSuccess = (provider: string) => {
    if (states[provider]?.status === 'success') resetProviderAttempt(provider);
  };

  return {
    states,
    addedCount,
    recordCredentialAdded,
    providerText,
    startAuth,
    cancelAuth,
    submitCallback,
    setCallbackInput,
    dismissSuccess,
  };
}
