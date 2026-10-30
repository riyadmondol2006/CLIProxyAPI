// Pure utilities shared by the block editors (the payload/rule parts were moved as-is from the
// old VisualConfigEditorBlocks, and split into their own file to avoid the react-refresh
// restriction on component files exporting non-components).

import type { useTranslation } from 'react-i18next';
import type {
  PayloadModelEntry,
  PayloadParamValidationErrorCode,
  VisualConfigValidationErrorCode,
} from '@/types/visualConfig';
import { VISUAL_CONFIG_PROTOCOL_OPTIONS } from '@/hooks/useVisualConfig';

export function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

export function buildProtocolOptions(
  t: ReturnType<typeof useTranslation>['t'],
  rules: Array<{ models: PayloadModelEntry[] }>
) {
  const options: Array<{ value: string; label: string }> = VISUAL_CONFIG_PROTOCOL_OPTIONS.map(
    (option) => ({
      value: option.value,
      label: t(option.labelKey, { defaultValue: option.defaultLabel }),
    })
  );
  const seen = new Set<string>(options.map((option) => option.value));

  for (const rule of rules) {
    for (const model of rule.models) {
      const protocol = model.protocol;
      if (!protocol || !protocol.trim() || seen.has(protocol)) continue;
      seen.add(protocol);
      options.push({ value: protocol, label: protocol });
    }
  }

  return options;
}

/**
 * Delay between lighting adjacent segments of the API key strength bar; all 4 segments lit =
 * 135ms + 160ms within a segment, so the whole group stays under 300ms
 */
export const SEGMENT_STAGGER_MS = 45;

/**
 * Start delay for filling a strength bar segment: only segments newly added this time are
 * queued; already-lit segments and turning off are never delayed.
 * So "Generate" lighting four segments at once plays as a sequential wave, while typing that
 * raises the strength by one segment is instant.
 */
export function segmentFillDelayMs(
  index: number,
  segments: number,
  previousSegments: number
): number {
  const filled = index < segments;
  if (!filled || index < previousSegments) return 0;
  return (index - Math.max(previousSegments, 0)) * SEGMENT_STAGGER_MS;
}
