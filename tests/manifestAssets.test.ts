import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = process.cwd();

const readRepositoryFile = async (relativePath: string): Promise<Buffer> =>
  readFile(path.join(repositoryRoot, relativePath));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readPngDimensions = (contents: Buffer): readonly [number, number] => {
  assert.deepEqual(
    contents.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'Expected a valid PNG signature.',
  );
  return [contents.readUInt32BE(16), contents.readUInt32BE(20)];
};

describe('publish assets and manifest identity', () => {
  it('uses the final Marketplace identity and brand metadata', async () => {
    const manifest = JSON.parse(
      await readRepositoryFile('package.json').then((value) =>
        value.toString('utf8'),
      ),
    ) as unknown;
    assert.ok(isRecord(manifest));
    assert.equal(manifest.name, 'timer-stopwatch');
    assert.equal(manifest.displayName, 'Timer & Stopwatch');
    assert.equal(manifest.publisher, 'ozdemir');
    assert.equal(manifest.author, 'Burak Ozdemir');
    assert.equal(manifest.icon, 'resources/icon.png');
    assert.deepEqual(manifest.repository, {
      type: 'git',
      url: 'https://github.com/onlinealarmkur/vscode-timer-stopwatch',
    });
    assert.deepEqual(manifest.bugs, {
      url: 'https://github.com/onlinealarmkur/vscode-timer-stopwatch/issues',
    });
    assert.ok(isRecord(manifest.engines));
    assert.ok(isRecord(manifest.devDependencies));
    assert.equal(
      manifest.engines.vscode,
      `^${String(manifest.devDependencies['@types/vscode'])}`,
      'The VS Code runtime floor and compile-time API types must stay aligned.',
    );
    assert.equal(
      manifest.description,
      'Run countdown timers and stopwatches from the VS Code status bar.',
    );
    assert.deepEqual(manifest.categories, ['Other']);
    assert.deepEqual(manifest.keywords, [
      'timer',
      'countdown',
      'stopwatch',
      'status bar',
      'productivity',
      'time management',
      'notification',
    ]);
  });

  it('keeps website promotion out of the README', async () => {
    const readme = (await readRepositoryFile('README.md')).toString('utf8');
    const manifest = JSON.parse(
      await readRepositoryFile('package.json').then((value) =>
        value.toString('utf8'),
      ),
    ) as unknown;

    assert.ok(isRecord(manifest));
    assert.match(readme, /^# Timer & Stopwatch for VS Code$/mu);
    assert.match(
      readme,
      /Run countdowns and track elapsed time without leaving VS Code\. The remaining or elapsed time stays visible in the status bar while you work, and VS Code saves the session locally\./u,
    );
    assert.doesNotMatch(readme, /Online Timer|Online Alarm Kur|onlinealarmkur\.com/u);
    assert.equal(manifest.homepage, 'https://onlinealarmkur.com/timer/en/');
  });

  it('uses only native VS Code product icons', async () => {
    const manifest = JSON.parse(
      await readRepositoryFile('package.json').then((value) =>
        value.toString('utf8'),
      ),
    ) as unknown;
    assert.ok(isRecord(manifest));
    assert.ok(isRecord(manifest.contributes));
    assert.equal(manifest.contributes.icons, undefined);
    assert.ok(Array.isArray(manifest.contributes.commands));

    const commandIcons = new Map<string, unknown>();
    for (const command of manifest.contributes.commands as unknown[]) {
      assert.ok(isRecord(command));
      const commandId = command.command;
      assert.ok(typeof commandId === 'string');
      commandIcons.set(commandId, command.icon);
    }
    assert.equal(
      commandIcons.get('timerStopwatch.startCountdown'),
      '$(clockface)',
    );
    assert.equal(commandIcons.get('timerStopwatch.startStopwatch'), '$(watch)');
  });

  it('keeps a high-resolution Marketplace icon and an exact 128 px variant', async () => {
    const [marketplaceWidth, marketplaceHeight] = readPngDimensions(
      await readRepositoryFile('resources/icon.png'),
    );
    assert.ok(marketplaceWidth >= 128);
    assert.ok(marketplaceHeight >= 128);

    const [previewWidth, previewHeight] = readPngDimensions(
      await readRepositoryFile('resources/icon-128.png'),
    );
    assert.deepEqual([previewWidth, previewHeight], [128, 128]);
  });

  it('keeps the GitHub social preview at the recommended size and file limit', async () => {
    const socialPreview = await readRepositoryFile(
      '.github/social-media-preview.png',
    );
    assert.deepEqual(readPngDimensions(socialPreview), [1280, 640]);
    assert.ok(
      socialPreview.byteLength < 1_000_000,
      'GitHub social previews must be smaller than 1 MB.',
    );
  });

  it('keeps both Marketplace screenshots valid, referenced, and out of the VSIX', async () => {
    const readme = (await readRepositoryFile('README.md')).toString('utf8');
    const vscodeIgnore = (
      await readRepositoryFile('.vscodeignore')
    ).toString('utf8');
    const screenshots = [
      'resources/marketplace-countdown.png',
      'resources/marketplace-stopwatch.png',
    ];

    for (const screenshot of screenshots) {
      assert.ok(
        readme.includes(`](${screenshot})`),
        `README must reference ${screenshot}.`,
      );
      assert.deepEqual(
        readPngDimensions(await readRepositoryFile(screenshot)),
        [1440, 900],
      );
      assert.equal(
        vscodeIgnore.includes(`!${screenshot}`),
        false,
        `${screenshot} must remain excluded from the VSIX.`,
      );
    }
  });
});
