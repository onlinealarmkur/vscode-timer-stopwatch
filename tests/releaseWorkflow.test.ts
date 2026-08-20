import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import path from 'node:path';
import process from 'node:process';

const releaseWorkflowPath = path.join(
  process.cwd(),
  '.github',
  'workflows',
  'release.yml',
);
const ciWorkflowPath = path.join(
  process.cwd(),
  '.github',
  'workflows',
  'ci.yml',
);

const normalizeNewlines = (value: string): string =>
  value.replace(/\r\n?/gu, '\n');

const readReleaseWorkflow = async (): Promise<string> =>
  normalizeNewlines(await readFile(releaseWorkflowPath, 'utf8'));

const readCiWorkflow = async (): Promise<string> =>
  normalizeNewlines(await readFile(ciWorkflowPath, 'utf8'));

describe('release workflow', () => {
  it('normalizes Windows line endings before validation', () => {
    assert.equal(normalizeNewlines('first\r\nsecond\rthird'), 'first\nsecond\nthird');
  });

  it('uses numeric tags and immutable official action pins', async () => {
    const workflow = await readReleaseWorkflow();
    assert.match(workflow, /tags:\n\s+- "\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"/u);

    const usesLines = workflow.match(/^\s*uses:\s*.+$/gmu) ?? [];
    assert.equal(usesLines.length, 5);
    for (const usesLine of usesLines) {
      assert.match(
        usesLine,
        /^\s*uses:\s*actions\/[a-z-]+@[0-9a-f]{40}\s+#\s+v\d+\.\d+\.\d+$/u,
      );
    }
  });

  it('builds, tests, attests, and installs the exact VSIX', async () => {
    const workflow = await readReleaseWorkflow();
    for (const command of [
      'npm ci',
      'npm audit --audit-level=high',
      'npm run check',
      'npm run test:coverage',
      'xvfb-run -a npm run test:integration',
      'npm run package:vsix',
      '--install-extension "$vsix"',
      'actions/attest@',
    ]) {
      assert.ok(workflow.includes(command), `Missing release guard: ${command}`);
    }

    const allowlist = Array.from(
      workflow.matchAll(/printf '%s\\n' '([^']+)'/gu),
      (match) => match[1],
    ).sort();
    assert.deepEqual(allowlist, [
      '[Content_Types].xml',
      'extension.vsixmanifest',
      'extension/LICENSE.txt',
      'extension/dist/extension.js',
      'extension/package.json',
      'extension/readme.md',
      'extension/resources/icon.png',
    ].sort());
  });

  it('uses the Marketplace package identity for every VSIX handoff', async () => {
    const releaseWorkflow = await readReleaseWorkflow();
    const ciWorkflow = await readCiWorkflow();

    for (const expected of [
      'timer-stopwatch-${GITHUB_REF_NAME}.vsix',
      'timer-stopwatch-${{ github.ref_name }}.vsix',
      'ozdemir.timer-stopwatch@${GITHUB_REF_NAME}',
    ]) {
      assert.ok(
        releaseWorkflow.includes(expected),
        `Release workflow is missing the package identity: ${expected}`,
      );
    }
    assert.ok(ciWorkflow.includes('name: timer-stopwatch-vsix'));
    assert.ok(ciWorkflow.includes('path: timer-stopwatch-*.vsix'));
    assert.doesNotMatch(
      `${releaseWorkflow}\n${ciWorkflow}`,
      /(?:^|[\s"/])timer-(?:\*|\$\{|[0-9])/u,
    );
  });

  it('publishes only a byte-verified GitHub release', async () => {
    const workflow = await readReleaseWorkflow();
    for (const releaseGuard of [
      'gh release create "$tag"',
      '--draft',
      '--verify-tag',
      'gh release upload "$tag"',
      'cmp --silent -- "$asset_path" "$remote_path"',
      'gh release edit "$tag"',
      '--draft=false',
    ]) {
      assert.ok(
        workflow.includes(releaseGuard),
        `Missing release publication guard: ${releaseGuard}`,
      );
    }
    assert.doesNotMatch(workflow, /vsce\s+publish|VSCE_PAT|AZURE_DEVOPS_EXT_PAT/u);
  });
});
