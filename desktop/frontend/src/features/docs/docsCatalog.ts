import gettingStarted from './content/getting-started.md?raw';
import accounts from './content/accounts.md?raw';
import providers from './content/providers.md?raw';
import connectApps from './content/connect-apps.md?raw';
import sharing from './content/sharing.md?raw';
import service from './content/service.md?raw';
import configuration from './content/configuration.md?raw';
import troubleshooting from './content/troubleshooting.md?raw';
import claudeUsage from './content/claude-usage.md?raw';
// Reference pages come straight from the repository so they never drift from the code.
import configExample from '../../../../../config.example.yaml?raw';
import managementApi from '../../../../../docs/management-api-v8.md?raw';
import { docTitle, type DocEntry } from './docsUtils';

const configReference = `# Config reference

Every option the proxy understands, with comments. Your own file is
\`~/.config/cliproxyapi/config.yaml\`; the same reference is installed at
\`/usr/share/cliproxyapi/config.example.yaml\`.

\`\`\`yaml
${configExample.trim()}
\`\`\`
`;

const guide = (id: string, markdown: string): DocEntry => ({
  id,
  group: 'guides',
  title: docTitle(markdown, id),
  markdown,
});

export const DOCS: DocEntry[] = [
  guide('getting-started', gettingStarted),
  guide('accounts', accounts),
  guide('providers', providers),
  guide('connect-apps', connectApps),
  guide('sharing', sharing),
  guide('service', service),
  guide('configuration', configuration),
  guide('claude-usage', claudeUsage),
  guide('troubleshooting', troubleshooting),
  {
    id: 'config-reference',
    group: 'reference',
    title: 'Config reference',
    markdown: configReference,
  },
  {
    id: 'management-api',
    group: 'reference',
    title: docTitle(managementApi, 'Management API'),
    markdown: managementApi,
  },
];
