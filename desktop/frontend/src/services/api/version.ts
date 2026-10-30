/**
 * Version API
 */

import { apiClient } from './client';

export const versionApi = {
  checkLatest: () => apiClient.get<Record<string, unknown>>('/server/latest-version'),
};
