import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'ozdemir.timer-stopwatch';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

interface TestController {
  session(): unknown;
  startCountdown(durationMs: number): Promise<string>;
  startStopwatch(): Promise<string>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

const isTestController = (value: unknown): value is TestController =>
  isRecord(value) &&
  typeof value.session === 'function' &&
  typeof value.startCountdown === 'function' &&
  typeof value.startStopwatch === 'function' &&
  typeof value.pause === 'function' &&
  typeof value.resume === 'function' &&
  typeof value.reset === 'function' &&
  typeof value.stop === 'function';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension !== undefined, `Extension ${EXTENSION_ID} was not found.`);

  const activationResult: unknown = await extension.activate();
  assert.equal(extension.isActive, true, 'Extension did not activate.');
  assert.ok(
    isTestController(activationResult),
    'Extension activation did not return its test controller API.',
  );
  const controller = activationResult;
  await controller.stop();

  const manifest = extension.packageJSON as unknown;
  assert.ok(isRecord(manifest), 'Extension manifest was not an object.');
  assert.ok(isRecord(manifest.contributes), 'Manifest contributions were missing.');
  assert.ok(
    Array.isArray(manifest.contributes.commands),
    'Manifest commands were missing.',
  );

  const contributedCommands = manifest.contributes.commands
    .filter(isRecord)
    .map((command) => command.command)
    .filter((command): command is string => typeof command === 'string');
  assert.deepEqual(contributedCommands, [
    'timerStopwatch.showControls',
    'timerStopwatch.startCountdown',
    'timerStopwatch.startStopwatch',
    'timerStopwatch.testCompletionSound',
  ]);

  const registeredCommands = new Set(await vscode.commands.getCommands(true));
  for (const commandId of contributedCommands) {
    assert.ok(
      registeredCommands.has(commandId),
      `Command ${commandId} was not registered.`,
    );
  }

  assert.equal(
    'views' in manifest.contributes,
    false,
    'The status-bar-first extension should not contribute a view.',
  );

  assert.ok(
    isRecord(manifest.contributes.configuration),
    'Manifest configuration was missing.',
  );
  assert.ok(
    isRecord(manifest.contributes.configuration.properties),
    'Manifest configuration properties were missing.',
  );
  const properties = manifest.contributes.configuration.properties;
  assert.ok(
    isRecord(properties['timerStopwatch.showIdleLabel']),
    'Idle label setting was missing.',
  );
  assert.equal(
    properties['timerStopwatch.showIdleLabel'].default,
    true,
    'The idle Timer label should be visible by default.',
  );
  assert.ok(
    isRecord(properties['timerStopwatch.playCompletionSound']),
    'Completion sound setting was missing.',
  );
  assert.equal(
    properties['timerStopwatch.playCompletionSound'].default,
    true,
    'Completion sound should be enabled by default.',
  );
  assert.ok(
    isRecord(properties['timerStopwatch.showCompletionNotification']),
    'Completion notification setting was missing.',
  );
  assert.equal(
    properties['timerStopwatch.showCompletionNotification'].default,
    true,
    'Completion notifications should be enabled by default.',
  );
  assert.deepEqual(
    manifest.extensionKind,
    ['ui'],
    'The extension should run beside the desktop UI and audio device.',
  );
  assert.equal(
    'browser' in manifest,
    false,
    'The desktop-only extension should not advertise a browser entry point.',
  );
  assert.ok(isRecord(manifest.engines), 'Manifest engines were missing.');
  assert.equal(
    manifest.engines.vscode,
    '^1.125.0',
    'The supported VS Code floor changed unexpectedly.',
  );

  try {
    await vscode.commands.executeCommand('timerStopwatch.startStopwatch');
    const session = controller.session();
    assert.ok(isRecord(session), 'The stopwatch command did not start a session.');
    assert.equal(session.mode, 'stopwatch');
    assert.equal(session.status, 'running');
    assert.equal(
      'durationMs' in session,
      false,
      'A stopwatch session should not have a duration.',
    );
  } finally {
    await controller.stop();
  }

  await assert.rejects(controller.startCountdown(0), RangeError);
  assert.equal(await controller.startCountdown(60_000), 'started');
  assert.equal(await controller.startStopwatch(), 'busy');

  await controller.pause();
  let session = controller.session();
  assert.ok(isRecord(session));
  assert.equal(session.mode, 'countdown');
  assert.equal(session.status, 'paused');

  await controller.reset();
  session = controller.session();
  assert.ok(isRecord(session));
  assert.equal(session.status, 'paused');
  assert.equal(session.accumulatedMs, 0);

  await controller.resume();
  session = controller.session();
  assert.ok(isRecord(session));
  assert.equal(session.status, 'running');

  await controller.stop();
  assert.equal(controller.session(), undefined);
}
