const normalize = (version: string | null | undefined): string =>
  String(version ?? '')
    .trim()
    .replace(/^v/i, '');

const isRealVersion = (version: string): boolean =>
  version !== '' && version !== 'dev' && version !== 'unknown';

/**
 * True when the installed app and the running service come from different builds, which
 * happens after a package update until the service restarts. Dev builds never match, so
 * they are ignored.
 */
export const needsServiceRestart = (
  appVersion: string | null | undefined,
  serviceVersion: string | null | undefined
): boolean => {
  const app = normalize(appVersion);
  const service = normalize(serviceVersion);
  return isRealVersion(app) && isRealVersion(service) && app !== service;
};
