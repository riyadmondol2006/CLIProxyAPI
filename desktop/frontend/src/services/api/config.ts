/**
 * Config-related API
 */

import { apiClient } from './client';
import type { Config } from '@/types';
import { normalizeConfigResponse } from './transformers';

export const configApi = {
  /**
   * Get the config (with field normalization)
   */
  async getConfig(): Promise<Config> {
    const raw = await apiClient.get('/config');
    return normalizeConfigResponse(raw);
  },

  /**
   * Request log toggle
   */
  updateRequestLog: (enabled: boolean) =>
    apiClient.put('/config/observability/logs/request-log', enabled),
};
