import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import * as vscode from 'vscode';
import { TimerStopwatchController } from '../../src/controller.js';
import type { PersistedState } from '../../src/core/model.js';
import { STATE_KEY } from '../../src/core/persistence.js';
import {
  DONT_SHOW_AGAIN,
  START_ANOTHER_TIMER,
} from '../../src/ui/completion.js';

class MemoryStorage implements vscode.Memento {
  private readonly values = new Map<string, unknown>([[STATE_KEY, {
    version: 2,
    session: {
      mode: 'countdown',
      status: 'running',
      startedAt: 0,
      accumulatedMs: 0,
      durationMs: 1_000,
    },
  } satisfies PersistedState]]);

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Match the VS Code Memento overload.
  public get<T>(key: string): T | undefined;
  public get<T>(key: string, defaultValue: T): T;
  public get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? this.values.get(key) as T : defaultValue;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

export async function testCompletionLifecycle(): Promise<void> {
  for (const action of [START_ANOTHER_TIMER, DONT_SHOW_AGAIN]) {
    for (const disposeBeforeAction of [false, true]) {
      const notification = deferred<string | undefined>();
      let playbackSignal: AbortSignal | undefined;
      let controller: TimerStopwatchController | undefined;
      const configuration = { ...vscode.workspace.getConfiguration('timerStopwatch') };
      assert.equal(configuration.get('playCompletionSound', true), true);
      assert.equal(configuration.get('showCompletionNotification', true), true);

      // Keep native API boundaries observable without showing dialogs or
      // changing settings in the extension-host test profile.
      const preference = mock.method(configuration, 'update', async () => undefined);
      mock.method(vscode.workspace, 'getConfiguration', () => configuration);
      const command = mock.method(vscode.commands, 'executeCommand', async () => undefined);
      const error = mock.method(vscode.window, 'showErrorMessage', async () => undefined);
      const show = mock.method(vscode.window, 'showInformationMessage', () => notification.promise);

      try {
        controller = await TimerStopwatchController.create(
          new MemoryStorage(),
          {
            play: (signal) => {
              assert.ok(signal !== undefined);
              playbackSignal = signal;
              if (!disposeBeforeAction) {
                return Promise.resolve();
              }
              return new Promise<void>((_resolve, reject) => {
                signal.addEventListener('abort', () => {
                  reject(new Error('Playback cancelled during shutdown.'));
                }, { once: true });
              });
            },
          },
          { now: () => 2_000 },
        );
        await controller.start();
        assert.equal(controller.session(), undefined);
        assert.equal(show.mock.callCount(), 1);
        assert.deepEqual(show.mock.calls[0]?.arguments, [
          'Countdown finished.', START_ANOTHER_TIMER, DONT_SHOW_AGAIN,
        ]);
        assert.equal(playbackSignal?.aborted, false);

        if (disposeBeforeAction) {
          await controller.shutdown();
          assert.equal(playbackSignal?.aborted, true);
        }
        notification.resolve(action);
        await setImmediate();

        assert.equal(error.mock.callCount(), 0, 'Shutdown cancellation is not a sound error.');
        assert.equal(
          command.mock.callCount(),
          !disposeBeforeAction && action === START_ANOTHER_TIMER ? 1 : 0,
          'Only a live controller may start another timer.',
        );
        assert.equal(
          preference.mock.callCount(),
          !disposeBeforeAction && action === DONT_SHOW_AGAIN ? 1 : 0,
          'Only a live controller may change notification preferences.',
        );
        if (!disposeBeforeAction && action === START_ANOTHER_TIMER) {
          assert.deepEqual(command.mock.calls[0]?.arguments, ['timerStopwatch.startCountdown']);
        }
        if (!disposeBeforeAction && action === DONT_SHOW_AGAIN) {
          assert.deepEqual(preference.mock.calls[0]?.arguments, [
            'showCompletionNotification', false, vscode.ConfigurationTarget.Global,
          ]);
        }
      } finally {
        await controller?.shutdown();
        notification.resolve(undefined);
        await setImmediate();
        mock.restoreAll();
      }
    }
  }
}
