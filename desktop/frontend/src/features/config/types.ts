import type { VisualConfigValidationErrors, VisualConfigValues } from '@/types/visualConfig';

/**
 * Shared signature of section components: form values controlled by useVisualConfig + a
 * patch-style onChange.
 */
export type ConfigSectionProps = {
  values: VisualConfigValues;
  validationErrors?: VisualConfigValidationErrors;
  disabled: boolean;
  /** True only for the first-load entrance (captured on page mount); tab switches don't replay. */
  animateIn?: boolean;
  onChange: (patch: Partial<VisualConfigValues>) => void;
};
