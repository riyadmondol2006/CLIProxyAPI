// Single render source for the 6 high-frequency fields: SectionCommon (the common tab) and the
// canonical sections share these components, so the two renderings structurally cannot drift
// apart (the old simple mode achieved the same with shared JSX constants).
// Note: only the active tab is mounted, so setting row DOM ids are never duplicated.

import { useTranslation } from 'react-i18next';
import type { VisualConfigValues } from '@/types/visualConfig';
import { SPONSORS } from '../../sponsors';
import { ApiKeysCardEditor } from '../blocks/ApiKeysCardEditor';
import { SettingCell, SettingList, TextSetting, ToggleSetting } from './FieldPrimitives';
import fieldStyles from './Field.module.scss';

export type SharedFieldProps = {
  values: VisualConfigValues;
  disabled: boolean;
  onChange: (patch: Partial<VisualConfigValues>) => void;
  /**
   * Passed through to the setting row as is. SettingList only looks at its direct children's
   * props to lay out the two columns, so "span the full row" must be set at the call site (or
   * injected by SettingList for orphan rows) and cannot be hidden inside the component.
   */
  wide?: boolean;
};

export function HostField({ values, disabled, onChange, wide }: SharedFieldProps) {
  const { t } = useTranslation();
  return (
    <TextSetting
      fieldId="host"
      wide={wide}
      label={t('config_management.visual.sections.server.host')}
      placeholder="0.0.0.0"
      value={values.host}
      onChange={(host) => onChange({ host })}
      disabled={disabled}
    />
  );
}

export function PortField({
  values,
  disabled,
  onChange,
  error,
  wide,
}: SharedFieldProps & { error?: string }) {
  const { t } = useTranslation();
  return (
    <TextSetting
      fieldId="port"
      wide={wide}
      label={t('config_management.visual.sections.server.port')}
      type="number"
      size="sm"
      placeholder="8317"
      value={values.port}
      onChange={(port) => onChange({ port })}
      disabled={disabled}
      error={error}
    />
  );
}

export function ProxyUrlField({ values, disabled, onChange, wide }: SharedFieldProps) {
  const { t } = useTranslation();
  // Proxy URLs are long, so the call site passes wide to take the whole row; the description
  // slot holds a sponsor link (data in sponsors.ts; nothing is rendered when it is empty).
  const sponsor = SPONSORS[0];
  return (
    <TextSetting
      fieldId="proxyUrl"
      wide={wide}
      size="lg"
      label={t('config_management.visual.sections.network.proxy_url')}
      description={
        sponsor ? (
          <>
            {t('config_management.visual.sections.network.proxy_url_sponsor_hint')}{' '}
            <a
              className={fieldStyles.fieldSponsorLink}
              href={sponsor.url}
              target="_blank"
              rel="noopener noreferrer sponsored"
            >
              {sponsor.logo ? (
                <img className={fieldStyles.fieldSponsorLogo} src={sponsor.logo} alt="" />
              ) : null}
              {sponsor.name}
            </a>
          </>
        ) : undefined
      }
      placeholder="socks5://user:pass@127.0.0.1:1080/"
      value={values.proxyUrl}
      onChange={(proxyUrl) => onChange({ proxyUrl })}
      disabled={disabled}
    />
  );
}

export function ApiKeysField({ values, disabled, onChange }: SharedFieldProps) {
  return (
    <SettingList>
      <SettingCell fieldId="apiKeys">
        <ApiKeysCardEditor
          value={values.apiKeysText}
          disabled={disabled}
          onChange={(apiKeysText) => onChange({ apiKeysText })}
        />
      </SettingCell>
    </SettingList>
  );
}

export function DebugToggle({ values, disabled, onChange, wide }: SharedFieldProps) {
  const { t } = useTranslation();
  return (
    <ToggleSetting
      fieldId="debug"
      wide={wide}
      label={t('config_management.visual.sections.system.debug')}
      description={t('config_management.visual.sections.system.debug_desc')}
      checked={values.debug}
      disabled={disabled}
      onChange={(debug) => onChange({ debug })}
    />
  );
}

export function LoggingToFileToggle({ values, disabled, onChange, wide }: SharedFieldProps) {
  const { t } = useTranslation();
  return (
    <ToggleSetting
      fieldId="loggingToFile"
      wide={wide}
      label={t('config_management.visual.sections.system.logging_to_file')}
      description={t('config_management.visual.sections.system.logging_to_file_desc')}
      checked={values.loggingToFile}
      disabled={disabled}
      onChange={(loggingToFile) => onChange({ loggingToFile })}
    />
  );
}
