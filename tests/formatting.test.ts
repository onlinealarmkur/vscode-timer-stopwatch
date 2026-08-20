import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActiveSession } from '../src/core/model.js';
import {
  formatClock,
  formatStatusBar,
} from '../src/core/formatting.js';

const countdown = (
  overrides: Partial<ActiveSession> = {},
): ActiveSession => ({
  mode: 'countdown',
  status: 'running',
  startedAt: 0,
  accumulatedMs: 0,
  durationMs: 305_000,
  ...overrides,
});

describe('time formatting', () => {
  it('formats minute and multi-hour clocks', () => {
    assert.equal(formatClock(305_000), '5:05');
    assert.equal(formatClock(3_900_000), '1:05:00');
    assert.equal(formatClock(93_600_000), '26:00:00');
  });

  it('rounds countdowns up but elapsed time down', () => {
    assert.equal(formatClock(1_001, true), '0:02');
    assert.equal(formatClock(1_999), '0:01');
  });

  it('clamps negative and non-finite values to zero', () => {
    for (const value of [-1, Number.NaN, Infinity, -Infinity]) {
      assert.equal(formatClock(value), '0:00');
    }
    assert.equal(formatClock(-Infinity, true), '0:00');
  });

  it('formats exact unit boundaries and the maximum duration', () => {
    assert.equal(formatClock(999), '0:00');
    assert.equal(formatClock(1_000), '0:01');
    assert.equal(formatClock(59_999), '0:59');
    assert.equal(formatClock(60_000), '1:00');
    assert.equal(formatClock(3_599_999), '59:59');
    assert.equal(formatClock(3_600_000), '1:00:00');
    assert.equal(formatClock(30 * 24 * 60 * 60 * 1_000), '720:00:00');
  });
});

describe('status bar formatting', () => {
  it('shows an idle entry point', () => {
    assert.deepEqual(formatStatusBar(undefined, 0), {
      text: '$(clockface) Timer',
      tooltip: 'Timer & Stopwatch. Select to start.',
    });
    assert.deepEqual(formatStatusBar(undefined, 0, false), {
      text: '$(clockface)',
      tooltip: 'Timer & Stopwatch. Select to start.',
    });
  });

  it('shows remaining countdown time', () => {
    const presentation = formatStatusBar(countdown(), 5_000);
    assert.equal(presentation.text, '$(clockface) 5:00');
    assert.equal(presentation.tooltip, 'Countdown. Select for controls.');
  });

  it('distinguishes paused and elapsed stopwatch time', () => {
    const presentation = formatStatusBar(
      {
        mode: 'stopwatch',
        status: 'paused',
        startedAt: 0,
        accumulatedMs: 65_000,
      },
      500_000,
    );
    assert.equal(presentation.text, '$(debug-pause) 1:05');
    assert.match(presentation.tooltip, /Stopwatch paused/);
  });

  it('distinguishes paused countdowns and running stopwatches', () => {
    assert.deepEqual(
      formatStatusBar(
        countdown({ status: 'paused', accumulatedMs: 5_000 }),
        500_000,
      ),
      {
        text: '$(debug-pause) 5:00',
        tooltip: 'Countdown paused. Select for controls.',
      },
    );
    assert.deepEqual(
      formatStatusBar(
        {
          mode: 'stopwatch',
          status: 'running',
          startedAt: 1_000,
          accumulatedMs: 1_000,
        },
        65_000,
      ),
      {
        text: '$(watch) 1:05',
        tooltip: 'Stopwatch. Select for controls.',
      },
    );
  });

  it('uses different icons for running countdowns and stopwatches', () => {
    const countdownPresentation = formatStatusBar(countdown(), 0);
    const stopwatchPresentation = formatStatusBar(
      {
        mode: 'stopwatch',
        status: 'running',
        startedAt: 0,
        accumulatedMs: 0,
      },
      0,
    );

    assert.match(countdownPresentation.text, /^\$\(clockface\)/u);
    assert.match(stopwatchPresentation.text, /^\$\(watch\)/u);
    assert.notEqual(
      countdownPresentation.text.split(' ')[0],
      stopwatchPresentation.text.split(' ')[0],
    );
  });
});
