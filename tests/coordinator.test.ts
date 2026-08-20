import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SessionCoordinator,
  type CompletionPresenter,
  type CoordinatorErrorSource,
  type CoordinatorEvents,
  type SchedulerControl,
  type SchedulerFactory,
  type StateRepository,
} from '../src/core/coordinator.js';
import type { ActiveSession, PersistedState } from '../src/core/model.js';
import {
  MAX_DURATION_MS,
  MIN_DURATION_MS,
} from '../src/core/parsing.js';
import type { DecodedState } from '../src/core/persistence.js';
import type { Clock } from '../src/core/session.js';

class MutableClock implements Clock {
  public constructor(public current: number) {}

  public now(): number {
    return this.current;
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

class RecordingRepository implements StateRepository {
  public readonly states: PersistedState[] = [];
  public nextSave: Deferred | undefined;
  public failure: Error | undefined;

  public async save(state: PersistedState): Promise<void> {
    this.states.push(state);
    const failure = this.failure;
    const nextSave = this.nextSave;
    this.nextSave = undefined;
    await nextSave?.promise;
    if (failure !== undefined) {
      throw failure;
    }
  }
}

class RecordingPresenter implements CompletionPresenter {
  public readonly sessions: ActiveSession[] = [];
  public readonly signals: (AbortSignal | undefined)[] = [];
  public nextPresentation: Deferred | undefined;
  public failure: Error | undefined;

  public async present(
    session: ActiveSession,
    signal?: AbortSignal,
  ): Promise<void> {
    this.sessions.push(session);
    this.signals.push(signal);
    const nextPresentation = this.nextPresentation;
    this.nextPresentation = undefined;
    await nextPresentation?.promise;
    if (this.failure !== undefined) {
      throw this.failure;
    }
  }
}

interface RecordedError {
  readonly source: CoordinatorErrorSource;
  readonly error: unknown;
}

class RecordingEvents implements CoordinatorEvents {
  public changes = 0;
  public readonly ticks: number[] = [];
  public readonly errors: RecordedError[] = [];
  public afterTick: (() => void) | undefined;

  public sessionChanged(): void {
    this.changes += 1;
  }

  public tick(now: number): void {
    this.ticks.push(now);
    this.afterTick?.();
  }

  public error(source: CoordinatorErrorSource, error: unknown): void {
    this.errors.push({ source, error });
  }
}

class RecordingScheduler implements SchedulerControl {
  public running = false;
  public starts = 0;
  public stops = 0;
  public disposals = 0;

  public start(): void {
    this.starts += 1;
    this.running = true;
  }

  public stop(): void {
    this.stops += 1;
    this.running = false;
  }

  public dispose(): void {
    this.disposals += 1;
    this.running = false;
  }
}

class RecordingSchedulerFactory implements SchedulerFactory {
  public readonly control = new RecordingScheduler();
  private onTick: ((now: number) => Promise<void>) | undefined;
  private onError: ((error: unknown) => void) | undefined;

  public create(
    onTick: (now: number) => Promise<void>,
    onError: (error: unknown) => void,
  ): SchedulerControl {
    this.onTick = onTick;
    this.onError = onError;
    return this.control;
  }

  public async tick(now: number): Promise<void> {
    await this.onTick?.(now);
  }

  public fail(error: unknown): void {
    this.onError?.(error);
  }
}

interface Harness {
  readonly coordinator: SessionCoordinator;
  readonly clock: MutableClock;
  readonly repository: RecordingRepository;
  readonly presenter: RecordingPresenter;
  readonly events: RecordingEvents;
  readonly scheduler: RecordingSchedulerFactory;
}

function harness(session?: ActiveSession): Harness {
  const clock = new MutableClock(1_000);
  const repository = new RecordingRepository();
  const presenter = new RecordingPresenter();
  const events = new RecordingEvents();
  const scheduler = new RecordingSchedulerFactory();
  const coordinator = new SessionCoordinator({
    session,
    clock,
    repository,
    presenter,
    events,
    schedulerFactory: scheduler,
  });
  return { coordinator, clock, repository, presenter, events, scheduler };
}

async function createdHarness(
  decoded: DecodedState,
  repositoryFailure?: Error,
): Promise<Harness> {
  const clock = new MutableClock(1_000);
  const repository = new RecordingRepository();
  const presenter = new RecordingPresenter();
  const events = new RecordingEvents();
  const scheduler = new RecordingSchedulerFactory();
  repository.failure = repositoryFailure;
  const coordinator = await SessionCoordinator.create(decoded, {
    clock,
    repository,
    presenter,
    events,
    schedulerFactory: scheduler,
  });
  return { coordinator, clock, repository, presenter, events, scheduler };
}

describe('session coordinator', () => {
  it('preserves decoded state when its canonical rewrite fails', async () => {
    const current: ActiveSession = {
      mode: 'countdown',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
      durationMs: 60_000,
    };
    const expected = new Error('storage unavailable');
    const state = await createdHarness(
      {
        state: { version: 2, session: current },
        shouldPersist: true,
      },
      expected,
    );

    await state.coordinator.start();

    assert.equal(state.coordinator.snapshot(), current);
    assert.equal(state.scheduler.control.running, true);
    assert.deepEqual(state.repository.states, [
      { version: 2, session: current },
    ]);
    assert.deepEqual(state.events.errors, [
      { source: 'storage', error: expected },
    ]);
  });

  it('remains usable after an empty canonical rewrite fails', async () => {
    const expected = new Error('storage unavailable');
    const state = await createdHarness(
      {
        state: { version: 2, session: null },
        shouldPersist: true,
      },
      expected,
    );

    state.repository.failure = undefined;
    await state.coordinator.start();
    assert.equal(state.scheduler.control.running, false);
    assert.equal(state.scheduler.control.starts, 0);

    await state.coordinator.startStopwatch();

    assert.deepEqual(state.coordinator.snapshot(), {
      mode: 'stopwatch',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
    });
    assert.deepEqual(state.repository.states.at(-1), {
      version: 2,
      session: {
        mode: 'stopwatch',
        status: 'running',
        startedAt: 1_000,
        accumulatedMs: 0,
      },
    });
    assert.deepEqual(state.events.errors, [
      { source: 'storage', error: expected },
    ]);
  });

  it('persists and starts a countdown', async () => {
    const state = harness();
    const result = await state.coordinator.startCountdown(60_000);

    assert.equal(result, 'started');
    assert.deepEqual(state.coordinator.snapshot(), {
      mode: 'countdown',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
      durationMs: 60_000,
    });
    assert.equal(state.repository.states.length, 1);
    assert.equal(state.scheduler.control.running, true);
    assert.equal(state.events.changes, 1);
  });

  it('rejects invalid countdown durations without side effects', async () => {
    const state = harness();
    for (const duration of [
      Number.NaN,
      Infinity,
      -Infinity,
      -1,
      0,
      1,
      MIN_DURATION_MS - 1,
      MIN_DURATION_MS + 1,
      1_500,
      MAX_DURATION_MS + 1,
    ]) {
      await assert.rejects(
        state.coordinator.startCountdown(duration),
        RangeError,
      );
    }
    assert.equal(state.coordinator.snapshot(), undefined);
    assert.deepEqual(state.repository.states, []);
    assert.equal(state.scheduler.control.starts, 0);
    assert.equal(state.events.changes, 0);
    assert.deepEqual(state.events.ticks, []);
  });

  it('starts a stopwatch without a countdown duration', async () => {
    const state = harness();
    const result = await state.coordinator.startStopwatch();

    assert.equal(result, 'started');
    assert.deepEqual(state.coordinator.snapshot(), {
      mode: 'stopwatch',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
    });
  });

  it('declines a start while another session is active without side effects', async () => {
    const current: ActiveSession = {
      mode: 'stopwatch',
      status: 'running',
      startedAt: 500,
      accumulatedMs: 0,
    };
    const state = harness(current);

    const result = await state.coordinator.startCountdown(60_000);

    assert.equal(result, 'busy');
    assert.equal(state.coordinator.snapshot(), current);
    assert.equal(state.repository.states.length, 0);
    assert.equal(state.events.changes, 0);
    assert.deepEqual(state.events.ticks, []);
    assert.deepEqual(state.events.errors, []);
  });

  it('pauses, resumes, resets, and stops the current session', async () => {
    const state = harness();
    await state.coordinator.startStopwatch();
    state.clock.current = 11_000;
    await state.coordinator.pause();
    assert.equal(state.coordinator.snapshot()?.status, 'paused');
    assert.equal(state.coordinator.snapshot()?.accumulatedMs, 10_000);
    assert.equal(state.scheduler.control.running, false);

    state.clock.current = 20_000;
    await state.coordinator.resume();
    assert.equal(state.coordinator.snapshot()?.startedAt, 20_000);
    assert.equal(state.scheduler.control.running, true);

    state.clock.current = 25_000;
    await state.coordinator.reset();
    assert.equal(state.coordinator.snapshot()?.status, 'paused');
    assert.equal(state.coordinator.snapshot()?.accumulatedMs, 0);

    await state.coordinator.stop();
    assert.equal(state.coordinator.snapshot(), undefined);
    assert.deepEqual(state.repository.states.at(-1), {
      version: 2,
      session: null,
    });
  });

  it('treats lifecycle actions while idle as no-ops', async () => {
    const state = harness();
    await state.coordinator.pause();
    await state.coordinator.resume();
    await state.coordinator.reset();
    await state.coordinator.stop();

    assert.equal(state.coordinator.snapshot(), undefined);
    assert.deepEqual(state.repository.states, []);
    assert.equal(state.events.changes, 0);
    assert.deepEqual(state.events.ticks, []);
  });

  it('rejects stale queued lifecycle actions after a replacement starts', async () => {
    const cases: readonly {
      readonly action: 'pause' | 'resume' | 'reset' | 'stop';
      readonly prepareReplacement?: (state: Harness) => Promise<void>;
      readonly apply: (
        coordinator: SessionCoordinator,
        expectedSession: ActiveSession,
      ) => Promise<void>;
    }[] = [
      {
        action: 'pause',
        apply: (coordinator, expectedSession) =>
          coordinator.pause(expectedSession),
      },
      {
        action: 'resume',
        prepareReplacement: async (state) => {
          await state.coordinator.pause();
        },
        apply: (coordinator, expectedSession) =>
          coordinator.resume(expectedSession),
      },
      {
        action: 'reset',
        apply: (coordinator, expectedSession) =>
          coordinator.reset(expectedSession),
      },
      {
        action: 'stop',
        apply: (coordinator, expectedSession) =>
          coordinator.stop(expectedSession),
      },
    ];

    for (const testCase of cases) {
      const state = harness();
      assert.equal(await state.coordinator.startStopwatch(), 'started');
      const original = state.coordinator.snapshot();
      assert.ok(original !== undefined);

      const pending = deferred();
      state.repository.nextSave = pending;
      const stopping = state.coordinator.stop();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(state.coordinator.snapshot(), original);

      state.clock.current = 2_000;
      const startingReplacement = state.coordinator.startStopwatch();
      const preparingReplacement =
        testCase.prepareReplacement?.(state) ?? Promise.resolve();
      const applyingStaleAction = testCase.apply(
        state.coordinator,
        original,
      );

      assert.equal(state.coordinator.snapshot(), original);
      pending.resolve();
      await stopping;
      assert.equal(await startingReplacement, 'started');
      await preparingReplacement;
      await applyingStaleAction;

      const expectedMutationCount =
        testCase.prepareReplacement === undefined ? 3 : 4;
      const replacement =
        state.repository.states[expectedMutationCount - 1]?.session;
      assert.ok(replacement !== null && replacement !== undefined);
      assert.equal(
        state.coordinator.snapshot(),
        replacement,
        `${testCase.action} changed the replacement session`,
      );
      assert.equal(
        state.repository.states.length,
        expectedMutationCount,
        `${testCase.action} added persistence`,
      );
      assert.equal(
        state.events.changes,
        expectedMutationCount,
        `${testCase.action} emitted a change`,
      );
      assert.equal(
        state.events.ticks.length,
        expectedMutationCount,
        `${testCase.action} emitted a tick`,
      );
    }
  });

  it('clears and presents a completed countdown exactly once', async () => {
    const state = harness();
    await state.coordinator.startCountdown(10_000);
    await state.scheduler.tick(11_000);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.coordinator.snapshot(), undefined);
    assert.equal(state.presenter.sessions.length, 1);
    assert.equal(state.scheduler.control.running, false);
    assert.deepEqual(state.repository.states.at(-1), {
      version: 2,
      session: null,
    });

    await state.scheduler.tick(20_000);
    assert.equal(state.presenter.sessions.length, 1);
  });

  it('aborts an active completion presentation on disposal', async () => {
    const state = harness();
    await state.coordinator.startCountdown(10_000);
    await state.scheduler.tick(11_000);
    await new Promise((resolve) => setImmediate(resolve));

    const signal = state.presenter.signals[0];
    assert.ok(signal !== undefined);
    assert.equal(signal.aborted, false);

    state.coordinator.dispose();

    assert.equal(signal.aborted, true);
    assert.deepEqual(state.events.errors, []);
  });

  it('suppresses a late presentation failure after disposal', async () => {
    const state = harness();
    const pending = deferred();
    const expected = new Error('notification closed');
    state.presenter.nextPresentation = pending;
    state.presenter.failure = expected;
    await state.coordinator.startCountdown(10_000);
    await state.scheduler.tick(11_000);
    await new Promise((resolve) => setImmediate(resolve));

    state.coordinator.dispose();
    pending.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(state.events.errors, []);
  });

  it('restores a completed countdown when disposed while its clear is pending', async () => {
    const state = harness();
    await state.coordinator.startCountdown(10_000);
    const completed = state.coordinator.snapshot();
    assert.ok(completed !== undefined);
    const changesBeforeCompletion = state.events.changes;
    const ticksBeforeCompletion = [...state.events.ticks];
    const pending = deferred();
    state.repository.nextSave = pending;

    const ticking = state.scheduler.tick(11_000);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(state.repository.states.at(-1), {
      version: 2,
      session: null,
    });
    state.coordinator.dispose();
    pending.resolve();
    await ticking;
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(state.repository.states, [
      { version: 2, session: completed },
      { version: 2, session: null },
      { version: 2, session: completed },
    ]);
    assert.deepEqual(state.presenter.sessions, []);
    assert.equal(state.events.changes, changesBeforeCompletion);
    assert.deepEqual(state.events.ticks, ticksBeforeCompletion);
    assert.deepEqual(state.events.errors, []);
    assert.equal(state.scheduler.control.running, false);
    assert.equal(state.scheduler.control.disposals, 1);

    const restored = state.repository.states.at(-1)?.session;
    assert.ok(restored !== null && restored !== undefined);
    const restarted = harness(restored);
    restarted.clock.current = 20_000;

    await restarted.coordinator.start();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(restarted.coordinator.snapshot(), undefined);
    assert.deepEqual(restarted.repository.states, [
      { version: 2, session: null },
    ]);
    assert.deepEqual(restarted.presenter.sessions, [completed]);

    await restarted.scheduler.tick(30_000);
    assert.deepEqual(restarted.presenter.sessions, [completed]);
  });

  it('restores a completed countdown when disposed before presentation', async () => {
    const current: ActiveSession = {
      mode: 'countdown',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
      durationMs: 10_000,
    };
    const state = harness(current);
    state.events.afterTick = () => state.coordinator.dispose();

    await state.scheduler.tick(11_000);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.coordinator.snapshot(), undefined);
    assert.deepEqual(state.repository.states, [
      { version: 2, session: null },
      { version: 2, session: current },
    ]);
    assert.deepEqual(state.presenter.sessions, []);
    assert.equal(state.events.changes, 1);
    assert.deepEqual(state.events.ticks, [11_000]);
    assert.deepEqual(state.events.errors, []);
    assert.equal(state.scheduler.control.running, false);
    assert.equal(state.scheduler.control.disposals, 1);
  });

  it('ignores a completion restore failure during disposal', async () => {
    const current: ActiveSession = {
      mode: 'countdown',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
      durationMs: 10_000,
    };
    const state = harness(current);
    const pending = deferred();
    state.repository.nextSave = pending;
    const ticking = state.coordinator.processTick(11_000);
    await new Promise((resolve) => setImmediate(resolve));
    const expected = new Error('storage unavailable');
    state.repository.failure = expected;
    state.coordinator.dispose();
    pending.resolve();

    await assert.doesNotReject(ticking);

    assert.deepEqual(state.repository.states, [
      { version: 2, session: null },
      { version: 2, session: current },
    ]);
    assert.deepEqual(state.presenter.sessions, []);
    assert.deepEqual(state.events.errors, []);
    assert.equal(state.scheduler.control.running, false);
    assert.equal(state.scheduler.control.disposals, 1);
  });

  it('keeps a restored paused countdown idle on startup', async () => {
    const state = harness({
      mode: 'countdown',
      status: 'paused',
      startedAt: 1_000,
      accumulatedMs: 9_000,
      durationMs: 10_000,
    });
    state.clock.current = 100_000;
    await state.coordinator.start();
    assert.equal(state.coordinator.snapshot()?.status, 'paused');
    assert.equal(state.presenter.sessions.length, 0);
    assert.equal(state.scheduler.control.running, false);
    assert.equal(state.scheduler.control.starts, 0);
    assert.equal(state.repository.states.length, 0);
  });

  it('completes an expired restored countdown on startup', async () => {
    const state = harness({
      mode: 'countdown',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
      durationMs: 10_000,
    });
    state.clock.current = 20_000;
    await state.coordinator.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.coordinator.snapshot(), undefined);
    assert.equal(state.presenter.sessions.length, 1);
  });

  it('keeps retry scheduling when startup cannot clear an expired countdown', async () => {
    const current: ActiveSession = {
      mode: 'countdown',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
      durationMs: 10_000,
    };
    const state = harness(current);
    const expected = new Error('storage unavailable');
    state.clock.current = 20_000;
    state.repository.failure = expected;

    await state.coordinator.start();

    assert.equal(state.coordinator.snapshot(), current);
    assert.equal(state.scheduler.control.running, true);
    assert.equal(state.presenter.sessions.length, 0);
    assert.deepEqual(state.events.errors, [
      { source: 'storage', error: expected },
    ]);
  });

  it('retries an expired startup clear without duplicate presentation', async () => {
    const current: ActiveSession = {
      mode: 'countdown',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
      durationMs: 10_000,
    };
    const state = harness(current);
    const expected = new Error('storage unavailable');
    state.clock.current = 20_000;
    state.repository.failure = expected;
    await state.coordinator.start();

    state.repository.failure = undefined;
    await state.scheduler.tick(20_001);

    assert.equal(state.coordinator.snapshot(), undefined);
    assert.equal(state.scheduler.control.running, false);
    assert.deepEqual(state.repository.states, [
      { version: 2, session: null },
      { version: 2, session: null },
    ]);
    assert.deepEqual(state.presenter.sessions, [current]);
    assert.deepEqual(state.events.errors, [
      { source: 'storage', error: expected },
    ]);

    await state.scheduler.tick(30_000);
    assert.deepEqual(state.presenter.sessions, [current]);
    assert.equal(state.repository.states.length, 2);
  });

  it('keeps state unchanged and reports persistence failures', async () => {
    const state = harness();
    const expected = new Error('storage unavailable');
    state.repository.failure = expected;
    await assert.rejects(
      state.coordinator.startStopwatch(),
      (error: unknown) => {
        assert.equal(error, expected);
        return true;
      },
    );
    assert.equal(state.coordinator.snapshot(), undefined);
    assert.equal(state.events.errors.length, 1);
    assert.equal(state.events.errors[0]?.source, 'storage');
    assert.equal(state.events.errors[0]?.error, expected);
  });

  it('allows a queued start after an earlier start fails to persist', async () => {
    const state = harness();
    const expected = new Error('storage unavailable');
    const pending = deferred();
    state.repository.failure = expected;
    state.repository.nextSave = pending;

    const first = state.coordinator.startStopwatch();
    await new Promise((resolve) => setImmediate(resolve));
    state.repository.failure = undefined;
    state.clock.current = 2_000;
    const second = state.coordinator.startCountdown(60_000);
    const firstRejected = assert.rejects(
      first,
      (error: unknown) => {
        assert.equal(error, expected);
        return true;
      },
    );
    pending.resolve();

    await firstRejected;
    assert.equal(await second, 'started');
    assert.deepEqual(state.coordinator.snapshot(), {
      mode: 'countdown',
      status: 'running',
      startedAt: 2_000,
      accumulatedMs: 0,
      durationMs: 60_000,
    });
    assert.equal(state.events.errors.length, 1);
    assert.equal(state.events.errors[0]?.source, 'storage');
    assert.equal(state.events.errors[0]?.error, expected);
  });

  it('forwards scheduler failures', () => {
    const state = harness();
    const expected = new Error('scheduler failed');
    state.scheduler.fail(expected);
    assert.equal(state.events.errors.length, 1);
    assert.equal(state.events.errors[0]?.source, 'scheduler');
    assert.equal(state.events.errors[0]?.error, expected);
  });

  it('reports presenter failures without restoring a completed countdown', async () => {
    const state = harness();
    const expected = new Error('notification failed');
    state.presenter.failure = expected;

    await state.coordinator.startCountdown(10_000);
    await state.scheduler.tick(11_000);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(state.coordinator.snapshot(), undefined);
    assert.deepEqual(state.repository.states.at(-1), {
      version: 2,
      session: null,
    });
    assert.equal(state.events.errors.length, 1);
    assert.equal(state.events.errors[0]?.source, 'notification');
    assert.equal(state.events.errors[0]?.error, expected);
  });

  it('reports scheduled persistence failures once without clearing the countdown', async () => {
    const current: ActiveSession = {
      mode: 'countdown',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
      durationMs: 10_000,
    };
    const state = harness(current);
    const expected = new Error('storage unavailable');
    state.repository.failure = expected;

    await state.scheduler.tick(11_000);

    assert.equal(state.coordinator.snapshot(), current);
    assert.equal(state.presenter.sessions.length, 0);
    assert.equal(state.events.errors.length, 1);
    assert.equal(state.events.errors[0]?.source, 'storage');
    assert.equal(state.events.errors[0]?.error, expected);
  });

  it('persists queued mutations in invocation order', async () => {
    const state = harness();
    const pending = deferred();
    state.repository.nextSave = pending;

    const starting = state.coordinator.startStopwatch();
    await new Promise((resolve) => setImmediate(resolve));
    state.clock.current = 11_000;
    const pausing = state.coordinator.pause();
    pending.resolve();
    await Promise.all([starting, pausing]);

    assert.deepEqual(state.repository.states, [
      {
        version: 2,
        session: {
          mode: 'stopwatch',
          status: 'running',
          startedAt: 1_000,
          accumulatedMs: 0,
        },
      },
      {
        version: 2,
        session: {
          mode: 'stopwatch',
          status: 'paused',
          startedAt: 11_000,
          accumulatedMs: 10_000,
        },
      },
    ]);
    assert.deepEqual(state.coordinator.snapshot(), {
      mode: 'stopwatch',
      status: 'paused',
      startedAt: 11_000,
      accumulatedMs: 10_000,
    });
  });

  it('admits only the first of two overlapping starts', async () => {
    const state = harness();
    const pending = deferred();
    state.repository.nextSave = pending;

    const first = state.coordinator.startCountdown(60_000);
    await new Promise((resolve) => setImmediate(resolve));
    state.clock.current = 2_000;
    const second = state.coordinator.startStopwatch();
    pending.resolve();

    assert.deepEqual(await Promise.all([first, second]), ['started', 'busy']);
    assert.deepEqual(state.repository.states, [
      {
        version: 2,
        session: {
          mode: 'countdown',
          status: 'running',
          startedAt: 1_000,
          accumulatedMs: 0,
          durationMs: 60_000,
        },
      },
    ]);
    assert.deepEqual(state.coordinator.snapshot(), {
      mode: 'countdown',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
      durationMs: 60_000,
    });
    assert.equal(state.events.changes, 1);
    assert.deepEqual(state.events.ticks, [2_000]);
  });

  it('returns disposed for a start invoked after disposal', async () => {
    const state = harness();
    state.coordinator.dispose();

    const result = await state.coordinator.startStopwatch();

    assert.equal(result, 'disposed');
    assert.equal(state.coordinator.snapshot(), undefined);
    assert.equal(state.repository.states.length, 0);
    assert.equal(state.events.changes, 0);
    assert.deepEqual(state.events.ticks, []);
  });

  it('ignores ticks and repeated disposal after disposal', async () => {
    const state = harness();
    state.coordinator.dispose();
    state.coordinator.dispose();
    await state.coordinator.processTick(5_000);

    assert.equal(state.scheduler.control.disposals, 1);
    assert.deepEqual(state.repository.states, []);
    assert.deepEqual(state.events.ticks, []);
    assert.deepEqual(state.events.errors, []);
  });

  it('does not publish queued changes after disposal', async () => {
    const state = harness();
    const pending = deferred();
    state.repository.nextSave = pending;
    const starting = state.coordinator.startStopwatch();
    await new Promise((resolve) => setImmediate(resolve));
    state.coordinator.dispose();
    pending.resolve();
    assert.equal(await starting, 'disposed');

    assert.equal(state.coordinator.snapshot(), undefined);
    assert.equal(state.events.changes, 0);
    assert.equal(state.scheduler.control.running, false);
    assert.equal(state.scheduler.control.disposals, 1);
  });
});
