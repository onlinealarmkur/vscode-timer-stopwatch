import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const integrationOutputDirectory = path.join(
  repositoryRoot,
  'dist',
  'integration',
);
const extensionTestsPath = path.join(
  integrationOutputDirectory,
  'index.js',
);

await mkdir(integrationOutputDirectory, { recursive: true });
await build({
  entryPoints: [path.join(repositoryRoot, 'tests', 'integration', 'index.ts')],
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: extensionTestsPath,
  logLevel: 'info',
});

await runTests({
  cachePath: path.join(repositoryRoot, '.vscode-test'),
  extensionDevelopmentPath: repositoryRoot,
  extensionTestsPath,
  launchArgs: ['--disable-extensions'],
  version: '1.125.0',
});
