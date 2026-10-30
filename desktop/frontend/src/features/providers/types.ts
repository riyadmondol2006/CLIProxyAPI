/**
 * AI provider Workbench view model (normalizes each brand's heterogeneous config)
 */

import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { ThinkingLevel } from './thinkingLevels';
import type { RuntimePolicyDraft } from './runtimePolicy';
import type { ModelOptionsInput } from './modelOptions';
import type { ProviderBehaviorOptions } from '@/types/provider';

export type ProviderBrand =
  | 'gemini'
  | 'interactions'
  | 'codex'
  | 'meta'
  | 'xai'
  | 'claude'
  | 'vertex'
  | 'openaiCompatibility'
  | 'apikeyFun'
  | 'fennoAI'
  | 'qiniuCloud'
  | 'kimi';

export type SponsorProviderBrand = 'apikeyFun' | 'fennoAI' | 'qiniuCloud' | 'kimi';

export const PROVIDER_SORT_BY_VALUES = ['name', 'priority', 'recent-success'] as const;
export type ProviderSortBy = (typeof PROVIDER_SORT_BY_VALUES)[number];

export const SORT_DIR_VALUES = ['asc', 'desc'] as const;
export type SortDir = (typeof SORT_DIR_VALUES)[number];

export type ProviderResourceSelector =
  | { brand: 'gemini'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'interactions'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'codex'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'meta'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'xai'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'claude'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'vertex'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'openaiCompatibility'; name: string; index: number }
  | {
      brand: 'apikeyFun';
      openaiIndices: number[];
      claudeIndices: number[];
      codexIndices: number[];
      geminiIndices: number[];
    }
  | {
      brand: 'fennoAI';
      openaiIndices: number[];
      claudeIndices: number[];
      codexIndices: number[];
      geminiIndices: number[];
    }
  | {
      brand: 'qiniuCloud';
      openaiIndices: number[];
      claudeIndices: number[];
      codexIndices: number[];
      geminiIndices: number[];
    }
  | {
      brand: 'kimi';
      openaiIndices: number[];
      claudeIndices: number[];
      codexIndices: number[];
      geminiIndices: number[];
    };

export interface ProviderResourceFlags {
  cloakEnabled?: boolean;
  claudeCodeCliProfile?: boolean;
  websockets?: boolean;
  protocols?: string[];
}

export interface ProviderResource {
  /** Stable id, used as the React key and for selection checks */
  id: string;
  brand: ProviderBrand;
  /** Index in the original array */
  originalIndex: number;
  /** Display name for the table's key column (OpenAI = name, others = null) */
  name: string | null;
  /** Fallback display text (masked API key or fallback) */
  identifier: string;
  /** Masked apiKey preview, for display */
  apiKeyPreview: string | null;
  /** Real apiKey used for the selector; null for OpenAI because it has multiple keys */
  apiKey: string | null;
  authIndex: string | null;
  baseUrl: string | null;
  proxyUrl: string | null;
  prefix: string | null;
  modelCount: number;
  /** Deduplicated model names, for filtering/search */
  models: string[];
  /** Priority used for sorting; 0 when not configured */
  priority: number;
  headerCount: number;
  excludedModelCount: number;
  /** Only meaningful for OpenAI; other brands don't display this field but keep it */
  apiKeyEntryCount: number;
  /** Whether it's disabled (each brand has its own rules for this) */
  disabled: boolean;
  /** Extra capability flags */
  flags: ProviderResourceFlags;
  /** Selector used for delete/update */
  selector: ProviderResourceSelector;
  /** Original raw config, used to initialize the Sheet form */
  raw: unknown;
}

export interface ProviderGroup {
  id: ProviderBrand;
  resources: ProviderResource[];
}

export interface ProviderSnapshot {
  fetchedAt: string;
  groups: ProviderGroup[];
}

export interface SponsorProviderRaw {
  openai: Array<{ config: OpenAIProviderConfig; index: number }>;
  claude: Array<{ config: ProviderKeyConfig; index: number }>;
  codex: Array<{ config: ProviderKeyConfig; index: number }>;
  gemini: Array<{ config: GeminiKeyConfig; index: number }>;
}

/**
 * Shared Sheet form values.
 * Gemini/Codex/Claude/Vertex/OpenAI share the base fields, and each enables its own advanced
 * section.
 */
export interface ModelEntryInput extends ModelOptionsInput {
  /** Only used by the OAuth alias editor. */
  fork?: boolean;
  sourceIndex?: number | null;
  name: string;
  alias?: string;
  priority?: number;
  image?: boolean;
  /** Original backend value, preserved until the standard-level selector is changed. */
  thinkingJson?: string;
  thinkingLevels?: ThinkingLevel[];
  thinkingLevelsTouched?: boolean;
}

export type SponsorProtocol = 'openai' | 'codex' | 'claude' | 'gemini';

export interface SponsorKeyEntryInput extends ProviderBehaviorOptions {
  protocol: SponsorProtocol;
  apiKey: string;
  existingApiKey?: string;
  baseUrl: string;
  proxyUrl: string;
  prefix: string;
  disabled: boolean;
  disableCooling?: boolean;
  runtimePolicy?: RuntimePolicyDraft;
  priority?: number;
  weight?: number;
  models: ModelEntryInput[];
}

export interface ApiKeyEntryInput {
  sourceIndex?: number;
  apiKey: string;
  existingApiKey?: string;
  proxyUrl: string;
  weight?: number;
  authIndex?: string;
}

export interface CloakInput {
  mode: string;
  strictMode: boolean;
  sensitiveWordsText: string;
  cacheUserId: boolean;
}

export interface ProviderEntryFormInput extends ProviderBehaviorOptions {
  /** For OpenAI, only passed via apiKeyEntries on create */
  apiKey: string;
  /** Required for OpenAI; not shown for other brands */
  name: string;
  baseUrl: string;
  proxyUrl: string;
  prefix: string;
  disabled: boolean;
  disableCooling?: boolean;
  runtimePolicy?: RuntimePolicyDraft;
  priority?: number;
  weight?: number;

  /** Advanced collapsible section */
  models: ModelEntryInput[];
  headers: Array<{ key: string; value: string }>;
  excludedModelsText: string;

  /** Codex only */
  websockets?: boolean;
  /** Claude only */
  cloak?: CloakInput;
  fingerprintProfile?: string;
  /** Temporary selection for connectivity tests only; never persisted in backend config. */
  testModel?: string;
  apiKeyEntries?: ApiKeyEntryInput[];
  /** APIKEY.FUN stores one grouped key per platform protocol. */
  sponsorKeyEntries?: SponsorKeyEntryInput[];
}
