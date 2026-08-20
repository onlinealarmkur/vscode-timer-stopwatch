import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ActiveSession } from '../src/core/model.js';
import {
  elapsedMs,
  pauseSession,
  remainingMs,
  resetSession,
  resumeSession,
  UnifiedScheduler,
  SystemClock,
  type IntervalDriver,
} from '../src/core/session.js';

const countdown = (
  overrides: Partial<ActiveSession> = {},
): ActiveSession => ({
  mode: 'countdown',
  status: 'running',
  startedAt: 1_000,
  accumulatedMs: 0,
  durationMs: 60_000,
  ...overrides,
});

describe('session timing', () => {
  it('calculates elapsed and remaining countdown time', () => {
    const session = countdown({ accumulatedMs: 5_000 });
    assert.equal(elapsedMs(session, 11_000), 15_000);
    assert.equal(remainingMs(session, 11_000), 45_000);
  });

  it('does not add wall-clock time while paused', () => {
    const session = countdown({
      status: 'paused',
      accumulatedMs: 12_000,
    });
    assert.equal(elapsedMs(session, 100_000), 12_000);
    assert.equal(remainingMs(session, 100_000), 48_000);
  });

  it('clamps clock rollback and completed countdowns', () => {
    assert.equal(elapsedMs(countdown(), 500), 0);
    assert.equal(remainingMs(countdown({ accumulatedMs: 70_000 }), 1_000), 0);
  });

  it('pauses and resumes without losing accumulated time', () => {
    const paused = pauseSession(countdown(), 21_000);
    assert.equal(paused.status, 'paused');
    assert.equal(paused.accumulatedMs, 20_000);

    const resumed = resumeSession(paused, 50_000);
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.startedAt, 50_000);
    assert.equal(elapsedMs(resumed, 55_000), 25_000);
  });

  it('leaves an expired countdown running for completion processing', () => {
    const session = countdown();
    assert.equal(pauseSession(session, 61_000), session);
  });

  it('resets either mode to a paused zero value', () => {
    const reset = resetSession(
      countdown({ accumulatedMs: 30_000 }),
      80_000,
    );
    assert.equal(reset.status, 'paused');
    assert.equal(reset.startedAt, 80_000);
    assert.equal(reset.accumulatedMs, 0);
    assert.equal(reset.durationMs, 60_000);
  });

  it('keeps no-op transitions referentially stable', () => {
    const paused = countdown({ status: 'paused' });
    const running = countdown();
    assert.equal(pauseSession(paused, 50_000), paused);
    assert.equal(resumeSession(running, 50_000), running);
  });

  it('reports zero remaining time for a stopwatch', () => {
    assert.equal(
      remainingMs({
        mode: 'stopwatch',
        status: 'running',
        startedAt: 0,
        accumulatedMs: 0,
      }, 50_000),
      0,
    );
  });

  it('uses the system wall clock by default', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    const after = Date.now();
    assert.ok(now >= before && now <= after);
  });
});

interface RecordedInterval {
  readonly callback: () => void;
  readonly intervalMs: number;
}

class RecordingIntervalDriver implements IntervalDriver {
  public readonly intervals: RecordedInterval[] = [];
  public readonly cleared: unknown[] = [];

  public setInterval(callback: () => void, intervalMs: number): unknown {
    const interval = { callback, intervalMs };
    this.intervals.push(interval);
    return interval;
  }

  public clearInterval(interval: unknown): void {
    this.cleared.push(interval);
  }
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolvePromise = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('scheduler', () => {
  it('starts idempotently and stops its interval', () => {
    const driver = new RecordingIntervalDriver();
    const scheduler = new UnifiedScheduler(
      { now: () => 42 },
      async () => undefined,
      () => undefined,
      1_000,
      driver,
    );
    scheduler.start();
    scheduler.start();
    assert.equal(driver.intervals.length, 1);
    assert.equal(driver.intervals[0]?.intervalMs, 1_000);
    scheduler.stop();
    assert.equal(driver.cleared.length, 1);
    scheduler.stop();
    scheduler.dispose();
    assert.equal(driver.cleared.length, 1);

    scheduler.start();
    assert.equal(driver.intervals.length, 2);
    scheduler.dispose();
    assert.equal(driver.cleared.length, 2);
  });

  it('drops overlapping ticks and accepts a later tick', async () => {
    const pending = deferred();
    let callbackCount = 0;
    const callbackOrder: string[] = [];
    const scheduler = new UnifiedScheduler(
      { now: () => 42 },
      async () => {
        callbackCount += 1;
        const callbackNumber = callbackCount;
        callbackOrder.push(`start ${callbackNumber}`);
        if (callbackCount === 1) {
          await pending.promise;
        }
        callbackOrder.push(`finish ${callbackNumber}`);
      },
      () => undefined,
    );

    const firstTick = scheduler.tick();
    assert.equal(callbackCount, 1);
    await scheduler.tick();
    assert.equal(callbackCount, 1);
    assert.deepEqual(callbackOrder, ['start 1']);

    pending.resolve();
    await firstTick;
    await scheduler.tick();
    assert.equal(callbackCount, 2);
    assert.deepEqual(callbackOrder, [
      'start 1',
      'finish 1',
      'start 2',
      'finish 2',
    ]);
  });

  it('accepts a later tick after a callback rejects', async () => {
    const expected = new Error('tick failed');
    let callbackCount = 0;
    const scheduler = new UnifiedScheduler(
      { now: () => 42 },
      async () => {
        callbackCount += 1;
        if (callbackCount === 1) {
          throw expected;
        }
      },
      () => undefined,
    );

    await assert.rejects(scheduler.tick(), (error: unknown) => {
      assert.equal(error, expected);
      return true;
    });
    await scheduler.tick();
    assert.equal(callbackCount, 2);
  });

  it('routes interval failures to the error callback', async () => {
    const driver = new RecordingIntervalDriver();
    const expected = new Error('tick failed');
    const errors: unknown[] = [];
    const scheduler = new UnifiedScheduler(
      { now: () => 42 },
      async () => {
        throw expected;
      },
      (error) => errors.push(error),
      1_000,
      driver,
    );
    scheduler.start();
    driver.intervals[0]?.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(errors, [expected]);
  });
});
