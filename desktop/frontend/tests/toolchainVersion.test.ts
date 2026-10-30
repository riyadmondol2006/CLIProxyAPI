import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const readProjectFile = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const packageJson = JSON.parse(readProjectFile('package.json')) as { packageManager: string };
const bunVersion = packageJson.packageManager.match(/^bun@(\d+\.\d+\.\d+)$/)?.[1];

describe('Bun toolchain version', () => {
  test('pins an exact Bun release', () => {
    expect(bunVersion).toBeDefined();
  });

  test('the package workflow uses the pinned Bun release', () => {
    expect(readProjectFile('../../.github/workflows/packages.yml')).toContain(
      `bun-version: '${bunVersion}'`
    );
  });

  test('README documents the pinned Bun release', () => {
    expect(readProjectFile('README.md')).toContain(`**Bun ${bunVersion}**`);
  });

  test('repository guidance documents the pinned Bun release', () => {
    expect(readProjectFile('AGENTS.md')).toContain(`\`bun@${bunVersion}\``);
  });
});
