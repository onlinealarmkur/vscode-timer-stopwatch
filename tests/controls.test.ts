import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActiveSession } from '../src/core/model.js';
import { buildControlItems } from '../src/ui/controls.js';

const runningCountdown: ActiveSession = {
  mode: 'countdown',
  status: 'running',
  startedAt: 0,
  accumulatedMs: 0,
  durationMs: 60_000,
};

const pausedStopwatch: ActiveSession = {
  mode: 'stopwatch',
  status: 'paused',
  startedAt: 0,
  accumulatedMs: 5_000,
};

describe('control items', () => {
  it('builds the idle action sequence', () => {
    const items = buildControlItems(undefined);

    assert.deepEqual(items.map((item) => item.action), [
      'startCountdown',
      'startStopwatch',
    ]);
    assert.equal(items[0]?.label, '$(clockface) Start timer');
    assert.equal(items[1]?.label, '$(watch) Start stopwatch');
  });

  it('builds the running countdown action sequence', () => {
    const items = buildControlItems(runningCountdown);

    assert.deepEqual(items.map((item) => item.action), [
      'pause',
      'reset',
      'stop',
    ]);
    assert.equal(items[0]?.label, '$(debug-pause) Pause');
    assert.equal(items[1]?.label, '$(debug-restart) Reset');
    assert.equal(items[2]?.label, '$(debug-stop) Stop');
  });

  it('builds the paused stopwatch action sequence', () => {
    const items = buildControlItems(pausedStopwatch);

    assert.deepEqual(items.map((item) => item.action), [
      'resume',
      'reset',
      'stop',
    ]);
    assert.equal(items[0]?.label, '$(debug-start) Resume');
  });
});
