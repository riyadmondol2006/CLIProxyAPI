import type { ComponentType } from 'react';
import {
  IconCode,
  IconKey,
  IconNetwork,
  IconSatellite,
  IconScrollText,
  IconShield,
  IconSlidersHorizontal,
  type IconProps,
} from '@/components/ui/icons';
import type { VisualConfigFieldPath } from '@/types/visualConfig';
import type { VisualSectionId } from './searchIndex';

/** Edit mode: visual form or YAML source. */
export type ConfigEditorMode = 'visual' | 'source';

/** Top tabs: 'common' (frequently used, replaces the old simple mode) + 6 canonical sections. */
export type ConfigTabId = 'common' | VisualSectionId;

export const CONFIG_SECTION_IDS = [
  'connectivity',
  'network',
  'logging',
  'streaming',
  'advanced',
  'payload',
] as const satisfies readonly VisualSectionId[];

export const CONFIG_TAB_IDS: readonly ConfigTabId[] = ['common', ...CONFIG_SECTION_IDS];

/** Section numbers (01–06). The common tab is an alias view and takes no number. */
export const SECTION_INDEX_LABELS: Record<VisualSectionId, string> = {
  connectivity: '01',
  network: '02',
  logging: '03',
  streaming: '04',
  advanced: '05',
  payload: '06',
};

export const CONFIG_TAB_ICONS: Record<ConfigTabId, ComponentType<IconProps>> = {
  common: IconSlidersHorizontal,
  connectivity: IconKey,
  network: IconNetwork,
  logging: IconScrollText,
  streaming: IconSatellite,
  advanced: IconShield,
  payload: IconCode,
};

/**
 * The 6 fields of the common tab (the old simple mode); the render source is shared with the
 * canonical sections (fields/sharedFields.tsx).
 */
export const COMMON_FIELD_IDS = [
  'host',
  'port',
  'apiKeys',
  'proxyUrl',
  'debug',
  'loggingToFile',
] as const;

/**
 * Validation field paths owned by each section (the basis for bucketing tab error badges).
 * Payload validation does not use field paths; it is tracked separately by the
 * hasPayloadValidationErrors flag.
 */
export const SECTION_VALIDATION_FIELDS: Record<VisualSectionId, readonly VisualConfigFieldPath[]> =
  {
    connectivity: ['port', 'trustedProxies', 'discoveryServiceType'],
    network: [
      'requestRetry',
      'maxRetryCredentials',
      'maxRetryInterval',
      'authAutoRefreshWorkers',
      'transientErrorCooldownSeconds',
      'videoResultAuthCacheTTL',
    ],
    logging: ['errorLogsMaxFiles', 'logsMaxTotalSizeMb', 'redisUsageQueueRetentionSeconds'],
    streaming: [
      'streaming.keepaliveSeconds',
      'streaming.bootstrapRetries',
      'streaming.nonstreamKeepaliveInterval',
    ],
    advanced: [
      'claudeHeaderTimezone',
      'codexStreamBootstrapTimeout',
      'antigravityConnectionPoolIdleTimeout',
      'antigravityConnectionPoolMaxIdleConnsPerHost',
      'codexLiveMediaRelayMaxSessions',
      'codexLiveMediaRelayPublicIP',
      'codexLiveMediaRelayUDPPortMin',
      'codexLiveMediaRelayUDPPortMax',
      'codexLiveMediaRelayICEServers',
    ],
    payload: [],
  };

/**
 * fieldId → key in useVisualConfig dirtyFields (= VisualConfigValues leaf key; streaming uses
 * dotted leaves). Maps one-to-one to the search index; the three-way reconciliation is guarded
 * by tests/configFieldParity.test.ts, so adding or removing a field without updating any one
 * side (index / this table / section JSX) turns it red.
 */
export const FIELD_VALUE_KEYS: Record<string, readonly string[]> = {
  routingSessionAffinitySubagents: ['routingSessionAffinitySubagents'],
  saveCooldownStatus: ['saveCooldownStatus'],
  transientErrorCooldownSeconds: ['transientErrorCooldownSeconds'],
  videoResultAuthCacheTTL: ['videoResultAuthCacheTTL'],
  claudeHeaderTimezone: ['claudeHeaderTimezone'],
  claudeModelLevelCooling: ['claudeModelLevelCooling'],
  claudeDisableCloakMode: ['claudeDisableCloakMode'],
  claudeCodeDisableCloakingModelList: ['claudeCodeDisableCloakingModelList'],
  codexDisableCloaking: ['codexDisableCloaking'],
  codexModelLevelCooling: ['codexModelLevelCooling'],
  codexStreamBootstrapBuffering: ['codexStreamBootstrapBuffering'],
  codexStreamBootstrapTimeout: ['codexStreamBootstrapTimeout'],
  codexOptimizeMultiAgentV2: ['codexOptimizeMultiAgentV2'],
  codexOrphanDelegationCompatibility: ['codexOrphanDelegationCompatibility'],
  codexResponseSteering: ['codexResponseSteering'],
  antigravityConnectionPoolEnabled: ['antigravityConnectionPoolEnabled'],
  antigravityConnectionPoolIdleTimeout: ['antigravityConnectionPoolIdleTimeout'],
  antigravityConnectionPoolMaxIdleConnsPerHost: ['antigravityConnectionPoolMaxIdleConnsPerHost'],
  xaiInjectXSearch: ['xaiInjectXSearch'],
  codexLiveMediaRelayEnabled: ['codexLiveMediaRelayEnabled'],
  codexLiveMediaRelayMaxSessions: ['codexLiveMediaRelayMaxSessions'],
  codexLiveMediaRelayDisablePrivateRemoteIPs: ['codexLiveMediaRelayDisablePrivateRemoteIPs'],
  codexLiveMediaRelayPublicIP: ['codexLiveMediaRelayPublicIP'],
  codexLiveMediaRelayUDPPortMin: ['codexLiveMediaRelayUDPPortMin'],
  codexLiveMediaRelayUDPPortMax: ['codexLiveMediaRelayUDPPortMax'],
  codexLiveMediaRelayICEServers: ['codexLiveMediaRelayICEServers'],

  // ── connectivity ──────────────────────────────────────────────────────────
  githubToken: ['githubToken'],
  trustedProxies: ['trustedProxies'],
  discoveryEnabled: ['discoveryEnabled'],
  discoveryServiceName: ['discoveryServiceName'],
  discoveryServiceType: ['discoveryServiceType'],
  discoverySubtypes: ['discoverySubtypes'],
  discoveryInterfacesInclude: ['discoveryInterfacesInclude'],
  discoveryInterfacesExclude: ['discoveryInterfacesExclude'],
  discoveryAuthRequired: ['discoveryAuthRequired'],
  discoveryAdvertiseManagement: ['discoveryAdvertiseManagement'],
  host: ['host'],
  port: ['port'],
  authDir: ['authDir'],
  apiKeys: ['apiKeysText'],
  tlsEnable: ['tlsEnable'],
  tlsCert: ['tlsCert'],
  tlsKey: ['tlsKey'],
  rmAllowRemote: ['rmAllowRemote'],
  rmDisableControlPanel: ['rmDisableControlPanel'],
  rmDisableAutoUpdatePanel: ['rmDisableAutoUpdatePanel'],
  rmSecretKey: ['rmSecretKey'],
  rmPanelRepo: ['rmPanelRepo'],
  // ── network ───────────────────────────────────────────────────────────────
  proxyUrl: ['proxyUrl'],
  requestRetry: ['requestRetry'],
  maxRetryCredentials: ['maxRetryCredentials'],
  maxRetryInterval: ['maxRetryInterval'],
  authAutoRefreshWorkers: ['authAutoRefreshWorkers'],
  routingStrategy: ['routingStrategy'],
  disableImageGeneration: ['disableImageGeneration'],
  gptImage2BaseModel: ['gptImage2BaseModel'],
  routingSessionAffinityTTL: ['routingSessionAffinityTTL'],
  forceModelPrefix: ['forceModelPrefix'],
  passthroughHeaders: ['passthroughHeaders'],
  disableCooling: ['disableCooling'],
  routingSessionAffinity: ['routingSessionAffinity'],
  wsAuth: ['wsAuth'],
  // ── logging ───────────────────────────────────────────────────────────────
  debug: ['debug'],
  commercialMode: ['commercialMode'],
  loggingToFile: ['loggingToFile'],
  logsMaxTotalSizeMb: ['logsMaxTotalSizeMb'],
  errorLogsMaxFiles: ['errorLogsMaxFiles'],
  redisUsageQueueRetentionSeconds: ['redisUsageQueueRetentionSeconds'],
  usageStatisticsEnabled: ['usageStatisticsEnabled'],
  // ── streaming ─────────────────────────────────────────────────────────────
  streamingKeepaliveSeconds: ['streaming.keepaliveSeconds'],
  streamingBootstrapRetries: ['streaming.bootstrapRetries'],
  streamingNonstreamKeepalive: ['streaming.nonstreamKeepaliveInterval'],
  // ── advanced ──────────────────────────────────────────────────────────────
  quotaAntigravityCredits: ['quotaAntigravityCredits'],
  pluginsEnabled: ['pluginsEnabled'],
  pluginStoreSources: ['pluginStoreSources'],
  pluginStoreAuth: ['pluginStoreAuth'],
  antigravitySensitiveWords: ['antigravitySensitiveWords'],
  devinSensitiveWords: ['devinSensitiveWords'],
  antigravitySignatureCacheEnabled: ['antigravitySignatureCacheEnabled'],
  antigravitySignatureBypassStrict: ['antigravitySignatureBypassStrict'],
  claudeHeaderUserAgent: ['claudeHeaderUserAgent'],
  claudeHeaderPackageVersion: ['claudeHeaderPackageVersion'],
  claudeHeaderRuntimeVersion: ['claudeHeaderRuntimeVersion'],
  claudeHeaderOs: ['claudeHeaderOs'],
  claudeHeaderArch: ['claudeHeaderArch'],
  claudeHeaderTimeout: ['claudeHeaderTimeout'],
  claudeHeaderStabilizeDeviceProfile: ['claudeHeaderStabilizeDeviceProfile'],
  codexHeaderUserAgent: ['codexHeaderUserAgent'],
  codexHeaderBetaFeatures: ['codexHeaderBetaFeatures'],
  // ── payload ───────────────────────────────────────────────────────────────
  payloadDefaultRules: ['payloadDefaultRules'],
  payloadDefaultRawRules: ['payloadDefaultRawRules'],
  payloadOverrideRules: ['payloadOverrideRules'],
  payloadOverrideRawRules: ['payloadOverrideRawRules'],
  payloadFilterRules: ['payloadFilterRules'],
};

/**
 * DOM ids for tab / tabpanel: defined in one place, so ConfigTabs and the page-side panels use
 * the same function to build the aria links.
 */
export const configTabDomId = (id: ConfigTabId) => `config-tab-${id}`;
export const configPanelDomId = (id: ConfigTabId) => `config-panel-${id}`;

/**
 * localStorage keys: mode keeps the old key (same 'visual' | 'source' values); section is a new
 * key.
 */
export const CONFIG_MODE_STORAGE_KEY = 'config-management:tab';
export const CONFIG_SECTION_STORAGE_KEY = 'config-management:section';
/** Persistence key of the old "simple/full" dual mode; the mode axis is gone, so clear on mount. */
export const LEGACY_EDITOR_MODE_STORAGE_KEY = 'config-management:editor-mode';
