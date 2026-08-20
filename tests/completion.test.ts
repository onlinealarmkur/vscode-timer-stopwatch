import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DONT_SHOW_AGAIN,
  presentCountdownCompletion,
  START_ANOTHER_TIMER,
  type CompletionHost,
} from '../src/ui/completion.js';

function recordingHost(options: {
  readonly soundEnabled?: boolean;
  readonly notificationEnabled?: boolean;
  readonly soundError?: Error;
  readonly notificationError?: Error;
  readonly startAnotherError?: Error;
  readonly disableNotificationError?: Error;
  readonly selected?: string;
} = {}) {
  const calls: string[] = [];
  const messages: string[] = [];
  const actions: string[][] = [];
  const soundErrors: unknown[] = [];
  const preferenceErrors: unknown[] = [];
  const host: CompletionHost = {
    soundEnabled: () => options.soundEnabled ?? true,
    playSound: async () => {
      calls.push('playSound');
      if (options.soundError !== undefined) {
        throw options.soundError;
      }
    },
    reportSoundError: (error) => {
      calls.push('reportSoundError');
      soundErrors.push(error);
    },
    notificationEnabled: () => options.notificationEnabled ?? true,
    show: async (message, ...items) => {
      calls.push('show');
      if (options.notificationError !== undefined) {
        throw options.notificationError;
      }
      messages.push(message);
      actions.push(items);
      return options.selected;
    },
    startAnother: async () => {
      calls.push('startAnother');
      if (options.startAnotherError !== undefined) {
        throw options.startAnotherError;
      }
    },
    disableNotification: async () => {
      calls.push('disableNotification');
      if (options.disableNotificationError !== undefined) {
        throw options.disableNotificationError;
      }
    },
    reportPreferenceError: (error) => {
      calls.push('reportPreferenceError');
      preferenceErrors.push(error);
    },
  };
  return {
    actions,
    calls,
    host,
    messages,
    preferenceErrors,
    soundErrors,
  };
}

describe('countdown completion', () => {
  it('does nothing when sound and notifications are disabled', async () => {
    const recording = recordingHost({
      soundEnabled: false,
      notificationEnabled: false,
    });

    await presentCountdownCompletion(recording.host);

    assert.deepEqual(recording.calls, []);
  });

  it('plays sound independently when notifications are disabled', async () => {
    const recording = recordingHost({ notificationEnabled: false });

    await presentCountdownCompletion(recording.host);

    assert.deepEqual(recording.calls, ['playSound']);
  });

  it('shows one concise notification with restart and opt-out actions', async () => {
    const recording = recordingHost({ soundEnabled: false });

    await presentCountdownCompletion(recording.host);

    assert.deepEqual(recording.calls, ['show']);
    assert.deepEqual(recording.messages, ['Countdown finished.']);
    assert.deepEqual(recording.actions, [
      [START_ANOTHER_TIMER, DONT_SHOW_AGAIN],
    ]);
  });

  it('reports sound failure and still shows the notification', async () => {
    const soundError = new Error('player unavailable');
    const recording = recordingHost({ soundError });

    await presentCountdownCompletion(recording.host);

    assert.deepEqual(recording.calls, [
      'playSound',
      'show',
      'reportSoundError',
    ]);
    assert.deepEqual(recording.soundErrors, [soundError]);
  });

  it('shows the notification before pending sound playback settles', async () => {
    let finishSound = (): void => undefined;
    const sound = new Promise<void>((resolve) => {
      finishSound = resolve;
    });
    const calls: string[] = [];
    const host: CompletionHost = {
      soundEnabled: () => true,
      playSound: async () => {
        calls.push('playSound');
        await sound;
      },
      reportSoundError: () => {
        calls.push('reportSoundError');
      },
      notificationEnabled: () => true,
      show: async () => {
        calls.push('show');
        return undefined;
      },
      startAnother: async () => {
        calls.push('startAnother');
      },
      disableNotification: async () => {
        calls.push('disableNotification');
      },
      reportPreferenceError: () => {
        calls.push('reportPreferenceError');
      },
    };

    const presentation = presentCountdownCompletion(host);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(calls, ['playSound', 'show']);
    finishSound();
    await presentation;
  });

  it('does not report aborted sound or start another timer after disposal', async () => {
    const controller = new AbortController();
    const soundError = new Error('aborted player');
    const recording = recordingHost({
      soundError,
      selected: START_ANOTHER_TIMER,
    });
    controller.abort();

    await assert.rejects(
      presentCountdownCompletion(recording.host, controller.signal),
      { name: 'AbortError' },
    );

    assert.deepEqual(recording.calls, []);
    assert.deepEqual(recording.soundErrors, []);
  });

  it('starts another timer only when the action is selected', async () => {
    const recording = recordingHost({ selected: START_ANOTHER_TIMER });

    await presentCountdownCompletion(recording.host);

    assert.deepEqual(recording.calls, [
      'playSound',
      'show',
      'startAnother',
    ]);
  });

  it('disables future notifications only when the opt-out action is selected', async () => {
    const recording = recordingHost({ selected: DONT_SHOW_AGAIN });

    await presentCountdownCompletion(recording.host);

    assert.deepEqual(recording.calls, [
      'playSound',
      'show',
      'disableNotification',
    ]);
  });

  it('takes no action when the notification is dismissed', async () => {
    const recording = recordingHost({ selected: undefined });

    await presentCountdownCompletion(recording.host);

    assert.deepEqual(recording.calls, ['playSound', 'show']);
  });

  it('propagates only a failure to display the notification', async () => {
    const notificationError = new Error('notification unavailable');
    await assert.rejects(
      presentCountdownCompletion(
        recordingHost({ notificationError }).host,
      ),
      notificationError,
    );

    const restartError = new Error('input failed');
    const restart = recordingHost({
      selected: START_ANOTHER_TIMER,
      startAnotherError: restartError,
    });
    await presentCountdownCompletion(restart.host);
    assert.deepEqual(restart.calls, [
      'playSound',
      'show',
      'startAnother',
    ]);
  });

  it('reports an opt-out failure without reclassifying it', async () => {
    const preferenceError = new Error('settings are read-only');
    const recording = recordingHost({
      selected: DONT_SHOW_AGAIN,
      disableNotificationError: preferenceError,
    });

    await presentCountdownCompletion(recording.host);

    assert.deepEqual(recording.calls, [
      'playSound',
      'show',
      'disableNotification',
      'reportPreferenceError',
    ]);
    assert.deepEqual(recording.preferenceErrors, [preferenceError]);
  });

  it('does not restart when disposal occurs while a notification is open', async () => {
    const controller = new AbortController();
    let resolveSelection!: (value: string) => void;
    const selection = new Promise<string>((resolve) => {
      resolveSelection = resolve;
    });
    const calls: string[] = [];
    const host: CompletionHost = {
      soundEnabled: () => false,
      playSound: async () => undefined,
      reportSoundError: () => undefined,
      notificationEnabled: () => true,
      show: async () => {
        calls.push('show');
        return selection;
      },
      startAnother: async () => {
        calls.push('startAnother');
      },
      disableNotification: async () => {
        calls.push('disableNotification');
      },
      reportPreferenceError: () => {
        calls.push('reportPreferenceError');
      },
    };

    const presenting = presentCountdownCompletion(host, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    resolveSelection(START_ANOTHER_TIMER);
    await presenting;

    assert.deepEqual(calls, ['show']);
  });
});
