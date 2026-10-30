import type { RecentRequestBucket } from '@/utils/recentRequests';

/** Minutes covered by each stats bucket (fixed by the backend at 10 minutes × 20 buckets) */
export const TRAFFIC_BUCKET_MINUTES = 10;

/** Aggregated overall traffic window */
export interface TrafficWindow {
  buckets: RecentRequestBucket[];
  totalSuccess: number;
  totalFailure: number;
  total: number;
  /** 0–100; null when there are no requests in the window */
  successRate: number | null;
  /** Max requests in a single bucket, used for the chart's y-axis */
  peakTotal: number;
  /** Index of the peak bucket; -1 means no data */
  peakIndex: number;
  /** Window span (minutes) */
  windowMinutes: number;
}

/** Traffic slice for a single provider */
export interface ProviderTraffic {
  id: string;
  credentials: number;
  success: number;
  failure: number;
  total: number;
  successRate: number | null;
  buckets: RecentRequestBucket[];
}

/** Credential health */
export interface CredentialHealth {
  total: number;
  active: number;
  disabled: number;
  unavailable: number;
  /** Credential counts grouped by provider type, sorted by count descending */
  byType: Array<{ type: string; count: number }>;
}

/** Raw values for the top count cards */
export interface DashboardCounts {
  managementKeys: number | null;
  providerKeys: number | null;
  credentials: number | null;
  models: number | null;
}
