import { useTranslation } from 'react-i18next';
import { CONFIG_TAB_ICONS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { getValidationMessage } from '../blocks/shared';
import { SectionCard } from '../SectionCard';
import { SettingList } from '../fields/FieldPrimitives';
import {
  ApiKeysField,
  DebugToggle,
  HostField,
  LoggingToFileToggle,
  PortField,
  ProxyUrlField,
} from '../fields/sharedFields';

const Icon = CONFIG_TAB_ICONS.common;

/**
 * "Common" tab: the 6 high-frequency fields from the old simple mode, as an alias view (it takes
 * no section number). It shares its render source with the canonical sections (sharedFields),
 * and its data is the same single useVisualConfig state.
 */
export function SectionCommon({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const portError = getValidationMessage(t, validationErrors?.port);
  const fieldProps = { values, disabled, onChange };

  return (
    <SectionCard
      icon={<Icon size={16} />}
      title={t('config_management.visual.sections.common.title')}
      description={t('config_management.visual.sections.common.description')}
      animateIn={animateIn}
    >
      <SettingList>
        <HostField {...fieldProps} />
        <PortField {...fieldProps} error={portError} />
        <ProxyUrlField {...fieldProps} wide />
      </SettingList>

      <ApiKeysField {...fieldProps} />

      <SettingList>
        <DebugToggle {...fieldProps} />
        <LoggingToFileToggle {...fieldProps} />
      </SettingList>
    </SectionCard>
  );
}
