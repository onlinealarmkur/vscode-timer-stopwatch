import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ManualSoundTest,
  type ManualSoundTestHost,
} from '../src/audio/manualSoundTest.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function recordingHost(
  play: ManualSoundTestHost['play'],
): ManualSoundTestHost & {
  readonly errors: unknown[];
  successes: number;
} {
  const host = {
    errors: [] as unknown[],
    successes: 0,
    play,
    recordSuccess: () => {
      host.successes += 1;
    },
    reportError: (error: unknown) => {
      host.errors.push(error);
    },
  };
  return host;
}

describe('manual completion sound test', () => {
  it('records successful playback and passes a live abort signal', async () => {
    let receivedSignal: AbortSignal | undefined;
    const host = recordingHost(async (signal) => {
      receivedSignal = signal;
    });
    const soundTest = new ManualSoundTest(host);

    await soundTest.run();

    assert.equal(receivedSignal?.aborted, false);
    assert.equal(host.successes, 1);
    assert.deepEqual(host.errors, []);
  });

  it('coalesces overlapping runs and permits a later test', async () => {
    const firstPlayback = deferred();
    let playCalls = 0;
    const host = recordingHost(async () => {
      playCalls += 1;
      if (playCalls === 1) {
        await firstPlayback.promise;
      }
    });
    const soundTest = new ManualSoundTest(host);

    const first = soundTest.run();
    const overlapping = soundTest.run();
    assert.equal(first, overlapping);
    await Promise.resolve();
    assert.equal(playCalls, 1);

    firstPlayback.resolve();
    await Promise.all([first, overlapping]);
    await soundTest.run();

    assert.equal(playCalls, 2);
    assert.equal(host.successes, 2);
  });

  it('reports playback failures without rejecting the command', async () => {
    const failure = new Error('player unavailable');
    const host = recordingHost(async () => {
      throw failure;
    });
    const soundTest = new ManualSoundTest(host);

    await soundTest.run();

    assert.equal(host.successes, 0);
    assert.deepEqual(host.errors, [failure]);
  });

  it('suppresses abort errors', async () => {
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    const host = recordingHost(async () => {
      throw abortError;
    });
    const soundTest = new ManualSoundTest(host);

    await soundTest.run();

    assert.equal(host.successes, 0);
    assert.deepEqual(host.errors, []);
  });

  it('aborts active playback on disposal and ignores later runs', async () => {
    const playback = deferred();
    let receivedSignal: AbortSignal | undefined;
    let playCalls = 0;
    const host = recordingHost(async (signal) => {
      playCalls += 1;
      receivedSignal = signal;
      await playback.promise;
    });
    const soundTest = new ManualSoundTest(host);
    const running = soundTest.run();
    await Promise.resolve();

    soundTest.dispose();
    assert.equal(receivedSignal?.aborted, true);
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    playback.reject(abortError);
    await running;
    await soundTest.run();

    assert.equal(playCalls, 1);
    assert.equal(host.successes, 0);
    assert.deepEqual(host.errors, []);
  });

  it('does not begin playback when disposed before its first turn', async () => {
    let playCalls = 0;
    const host = recordingHost(async () => {
      playCalls += 1;
    });
    const soundTest = new ManualSoundTest(host);

    const running = soundTest.run();
    soundTest.dispose();
    await running;

    assert.equal(playCalls, 0);
    assert.equal(host.successes, 0);
    assert.deepEqual(host.errors, []);
  });
});
