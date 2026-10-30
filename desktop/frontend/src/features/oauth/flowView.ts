import type { ProviderFlowState } from './hooks/useOAuthFlows';

export type FlowView = 'idle' | 'flow' | 'success' | 'failed';

/**
 * Dialog view: an authorization link exists (or is being generated) → steps view; a failure
 * after the link is no longer valid → failure view.
 * When polling hits a network failure the link is still there, so stay in the steps view: a
 * manual callback can still be submitted and polling resumed.
 */
export const resolveFlowView = (state: ProviderFlowState): FlowView => {
  if (state.status === 'success') return 'success';
  if (state.url || state.status === 'waiting') return 'flow';
  if (state.status === 'error') return 'failed';
  return 'idle';
};

/**
 * Splits the authorization link into host + the rest: the host is highlighted so users can
 * check the domain they are about to visit.
 */
export const splitAuthUrl = (url: string): { host: string; rest: string } => {
  try {
    const { host } = new URL(url);
    if (!host) return { host: '', rest: url };
    const hostEnd = url.indexOf(host) + host.length;
    return { host, rest: url.slice(hostEnd) };
  } catch {
    return { host: '', rest: url };
  }
};
