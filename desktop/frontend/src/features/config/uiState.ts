// Pure-function layer for config page UI state: state machine, badge bucketing, dirty-field
// ownership, localStorage reads. All side-effect free, covered by tests/configUiState.test.ts.

import type { VisualConfigValidationErrors } from '@/types/visualConfig';
import {
  COMMON_FIELD_IDS,
  CONFIG_SECTION_IDS,
  CONFIG_TAB_IDS,
  FIELD_VALUE_KEYS,
  SECTION_VALIDATION_FIELDS,
  type ConfigEditorMode,
  type ConfigTabId,
} from './constants';
import { CONFIG_FIELD_SEARCH_INDEX, type VisualSectionId } from './searchIndex';

/** Total config items exposed by the visual editor (the "N settings" in the header meta row). */
export const CONFIG_FIELD_COUNT = CONFIG_FIELD_SEARCH_INDEX.length;

/** Reverse lookup from leaf value key (= useVisualConfig dirtyFields key) → fieldId. */
const VALUE_KEY_TO_FIELD_ID: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [fieldId, valueKeys] of Object.entries(FIELD_VALUE_KEYS)) {
    for (const valueKey of valueKeys) map.set(valueKey, fieldId);
  }
  return map;
})();

const FIELD_ID_TO_SECTION: ReadonlyMap<string, VisualSectionId> = new Map(
  CONFIG_FIELD_SEARCH_INDEX.map((entry) => [entry.fieldId, entry.sectionId])
);

const COMMON_FIELD_ID_SET: ReadonlySet<string> = new Set<string>(COMMON_FIELD_IDS);

/** Leaf value keys for fields the common tab renders (for attributing validation errors to it). */
const COMMON_VALUE_KEYS: ReadonlySet<string> = new Set(
  COMMON_FIELD_IDS.flatMap((fieldId) => [...(FIELD_VALUE_KEYS[fieldId] ?? [])])
);

/**
 * Dirty field set → tabs whose dirty dot lights up. Common fields light up both common and their
 * canonical section (both render them).
 */
export function resolveDirtyTabs(dirtyFields: ReadonlySet<string>): ReadonlySet<ConfigTabId> {
  const tabs = new Set<ConfigTabId>();
  for (const valueKey of dirtyFields) {
    const fieldId = VALUE_KEY_TO_FIELD_ID.get(valueKey);
    if (!fieldId) continue;
    const sectionId = FIELD_ID_TO_SECTION.get(fieldId);
    if (sectionId) tabs.add(sectionId);
    if (COMMON_FIELD_ID_SET.has(fieldId)) tabs.add('common');
  }
  return tabs;
}

/** Validation error count per tab (error badge). Payload validation counts as 1 via a flag. */
export function countSectionErrors(
  validationErrors: VisualConfigValidationErrors | undefined,
  hasPayloadValidationErrors: boolean
): Record<ConfigTabId, number> {
  const counts = Object.fromEntries(CONFIG_TAB_IDS.map((tabId) => [tabId, 0])) as Record<
    ConfigTabId,
    number
  >;
  for (const sectionId of CONFIG_SECTION_IDS) {
    counts[sectionId] = SECTION_VALIDATION_FIELDS[sectionId].reduce(
      (total, field) => total + (validationErrors?.[field] ? 1 : 0),
      0
    );
  }
  if (hasPayloadValidationErrors) counts.payload += 1;
  counts.common = Object.entries(validationErrors ?? {}).reduce(
    (total, [field, error]) => total + (error && COMMON_VALUE_KEYS.has(field) ? 1 : 0),
    0
  );
  return counts;
}

/** Total validation errors on the page (header meta row). */
export function countTotalErrors(
  validationErrors: VisualConfigValidationErrors | undefined,
  hasPayloadValidationErrors: boolean
): number {
  const fieldErrors = Object.values(validationErrors ?? {}).filter(Boolean).length;
  return fieldErrors + (hasPayloadValidationErrors ? 1 : 0);
}

export type ConfigStatusKey =
  | 'disconnected'
  | 'loading'
  | 'load_failed'
  | 'yaml_error'
  | 'validation_blocked'
  | 'saving'
  | 'dirty'
  | 'synced';

export type ConfigStatusTone = 'error' | 'warning' | 'busy' | 'muted' | 'ok';

export type ConfigStatus = {
  key: ConfigStatusKey;
  /** i18n key for the full status text. */
  labelKey: string;
  /**
   * i18n key for the short mobile text. The short key for validation_blocked lives at the top
   * level of config_management (a fix for a historical path bug).
   */
  shortLabelKey: string;
  tone: ConfigStatusTone;
};

export type ConfigStatusInput = {
  disconnected: boolean;
  loading: boolean;
  loadFailed: boolean;
  yamlError: boolean;
  validationBlocked: boolean;
  saving: boolean;
  dirty: boolean;
};

/**
 * State machine for the floating save bar / status text. Priority runs top to bottom, matching
 * the branch order of the old page's getStatusText.
 */
export function resolveStatus(input: ConfigStatusInput): ConfigStatus {
  if (input.disconnected) {
    return {
      key: 'disconnected',
      labelKey: 'config_management.status_disconnected',
      shortLabelKey: 'config_management.status_disconnected_short',
      tone: 'muted',
    };
  }
  if (input.loading) {
    return {
      key: 'loading',
      labelKey: 'config_management.status_loading',
      shortLabelKey: 'config_management.status_loading_short',
      tone: 'busy',
    };
  }
  if (input.loadFailed) {
    return {
      key: 'load_failed',
      labelKey: 'config_management.status_load_failed',
      shortLabelKey: 'config_management.status_load_failed_short',
      tone: 'error',
    };
  }
  if (input.yamlError) {
    return {
      key: 'yaml_error',
      labelKey: 'config_management.visual_mode_unavailable',
      shortLabelKey: 'config_management.visual_mode_unavailable_short',
      tone: 'error',
    };
  }
  if (input.validationBlocked) {
    return {
      key: 'validation_blocked',
      labelKey: 'config_management.visual.validation.validation_blocked',
      shortLabelKey: 'config_management.validation_blocked_short',
      tone: 'error',
    };
  }
  if (input.saving) {
    return {
      key: 'saving',
      labelKey: 'config_management.status_saving',
      shortLabelKey: 'config_management.status_saving_short',
      tone: 'busy',
    };
  }
  if (input.dirty) {
    return {
      key: 'dirty',
      labelKey: 'config_management.status_dirty',
      shortLabelKey: 'config_management.status_dirty_short',
      tone: 'warning',
    };
  }
  return {
    key: 'synced',
    labelKey: 'config_management.status_loaded',
    shortLabelKey: 'config_management.status_loaded_short',
    tone: 'ok',
  };
}

export type HeaderMetaSegment = {
  key: 'fields' | ConfigStatusKey | 'dirty_source' | 'errors';
  labelKey: string;
  count?: number;
  tone: 'muted' | 'warning' | 'error' | 'ok';
};

export type HeaderMetaInput = {
  fieldCount: number;
  status: ConfigStatus;
  dirtyCount: number;
  sourceDirty: boolean;
  errorCount: number;
};

/**
 * The header ▍mono meta row consumes the page state machine directly, so the Header and save
 * bar don't each derive connection/loading state. The field total is always shown; blocking
 * states take priority, and editing states add the unsaved and validation error counts.
 */
export function buildHeaderMeta(input: HeaderMetaInput): HeaderMetaSegment[] {
  const segments: HeaderMetaSegment[] = [
    {
      key: 'fields',
      labelKey: 'config_management.meta_fields',
      count: input.fieldCount,
      tone: 'muted',
    },
  ];
  const { status } = input;

  if (
    status.key === 'disconnected' ||
    status.key === 'loading' ||
    status.key === 'load_failed' ||
    status.key === 'saving'
  ) {
    segments.push({
      key: status.key,
      labelKey: status.labelKey,
      tone: status.tone === 'busy' ? 'muted' : status.tone,
    });
    return segments;
  }
  if (status.key === 'yaml_error') {
    segments.push({
      key: status.key,
      labelKey: status.shortLabelKey,
      tone: 'error',
    });
  }
  if (input.sourceDirty) {
    segments.push({
      key: 'dirty_source',
      labelKey: 'config_management.meta_dirty_source',
      tone: 'warning',
    });
  } else if (input.dirtyCount > 0) {
    segments.push({
      key: 'dirty',
      labelKey: 'config_management.meta_dirty',
      count: input.dirtyCount,
      tone: 'warning',
    });
  }
  if (input.errorCount > 0) {
    segments.push({
      key: 'errors',
      labelKey: 'config_management.meta_errors',
      count: input.errorCount,
      tone: 'error',
    });
  }
  if (status.key === 'synced') {
    segments.push({ key: status.key, labelKey: 'config_management.meta_synced', tone: 'ok' });
  }
  return segments;
}

/** localStorage reads: invalid/stale values fall back to defaults. */
export function readSavedMode(raw: string | null): ConfigEditorMode {
  return raw === 'source' ? 'source' : 'visual';
}

export function readSavedSection(raw: string | null): ConfigTabId {
  return raw !== null && (CONFIG_TAB_IDS as readonly string[]).includes(raw)
    ? (raw as ConfigTabId)
    : 'common';
}
