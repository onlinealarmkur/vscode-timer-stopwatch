import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SessionStartResult } from '../src/core/coordinator.js';
import type { ActiveSession } from '../src/core/model.js';
import type { ControlItem } from '../src/ui/controls.js';
import {
  promptForCountdown,
  showControls,
  startStopwatch,
  type MenuController,
  type MenuHost,
} from '../src/ui/menuFlow.js';
import type {
  CancellationSourceLike,
  DisposableLike,
} from '../src/ui/sessionBoundSelection.js';

interface Token {
  readonly name: string;
}

class TestCancellationSource implements CancellationSourceLike<Token> {
  public readonly token: Token = { name: 'token' };
  public cancelCount = 0;
  public disposeCount = 0;

  public cancel(): void {
    this.cancelCount += 1;
  }

  public dispose(): void {
    this.disposeCount += 1;
  }
}

interface MutationCall {
  readonly action: 'pause' | 'resume' | 'reset' | 'stop';
  readonly expected: ActiveSession | undefined;
}

class FakeController implements MenuController {
  public currentSession: ActiveSession | undefined;
  public startCountdownCalls: number[] = [];
  public startStopwatchCalls = 0;
  public mutationCalls: MutationCall[] = [];
  public startCountdownResult: SessionStartResult = 'started';
  public startStopwatchResult: SessionStartResult = 'started';
  /**
   * When set alongside startCountdownResult === 'busy', simulates a
   * concurrently created session becoming visible the moment startCountdown
   * reports that the coordinator was already busy.
   */
  public busySession: ActiveSession | undefined;
  private readonly listeners = new Set<() => void>();

  public constructor(session: ActiveSession | undefined) {
    this.currentSession = session;
  }

  public session(): ActiveSession | undefined {
    return this.currentSession;
  }

  public async startCountdown(
    durationMs: number,
  ): Promise<SessionStartResult> {
    this.startCountdownCalls.push(durationMs);
    if (this.startCountdownResult === 'busy') {
      this.currentSession = this.busySession;
    }
    return this.startCountdownResult;
  }

  public async startStopwatch(): Promise<SessionStartResult> {
    this.startStopwatchCalls += 1;
    return this.startStopwatchResult;
  }

  public async pause(expected?: ActiveSession): Promise<void> {
    this.mutationCalls.push({ action: 'pause', expected });
  }

  public async resume(expected?: ActiveSession): Promise<void> {
    this.mutationCalls.push({ action: 'resume', expected });
  }

  public async reset(expected?: ActiveSession): Promise<void> {
    this.mutationCalls.push({ action: 'reset', expected });
  }

  public async stop(expected?: ActiveSession): Promise<void> {
    this.mutationCalls.push({ action: 'stop', expected });
  }

  public onDidChangeSession(listener: () => void): DisposableLike {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  public fireSessionChange(next: ActiveSession | undefined): void {
    this.currentSession = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

class FakeHost implements MenuHost<Token> {
  public quickPickAnswers: (ControlItem | undefined)[] = [];
  public quickPickCalls: { items: ControlItem[]; token: Token }[] = [];
  public durationAnswers: (string | undefined)[] = [];
  public durationCalls = 0;
  public lastCancellationSource: TestCancellationSource | undefined;
  private pendingQuickPick:
    | { resolve: (value: ControlItem | undefined) => void }
    | undefined;

  public showQuickPick(
    items: ControlItem[],
    token: Token,
  ): PromiseLike<ControlItem | undefined> {
    this.quickPickCalls.push({ items, token });
    if (this.quickPickAnswers.length > 0) {
      return Promise.resolve(this.quickPickAnswers.shift());
    }
    const pending = deferred<ControlItem | undefined>();
    this.pendingQuickPick = { resolve: pending.resolve };
    return pending.promise;
  }

  public resolvePendingQuickPick(item: ControlItem | undefined): void {
    this.pendingQuickPick?.resolve(item);
    this.pendingQuickPick = undefined;
  }

  public showDurationInput(): PromiseLike<string | undefined> {
    this.durationCalls += 1;
    return Promise.resolve(this.durationAnswers.shift());
  }

  public createCancellationSource(): CancellationSourceLike<Token> {
    const source = new TestCancellationSource();
    this.lastCancellationSource = source;
    return source;
  }
}

const countdownSession = (): ActiveSession => ({
  mode: 'countdown',
  status: 'running',
  startedAt: 1_000,
  accumulatedMs: 0,
  durationMs: 60_000,
});

const stopwatchSession = (): ActiveSession => ({
  mode: 'stopwatch',
  status: 'running',
  startedAt: 1_000,
  accumulatedMs: 0,
});

describe('menu flow', () => {
  it('idle: picking start timer then entering a duration starts a countdown', async () => {
    const controller = new FakeController(undefined);
    const host = new FakeHost();
    host.quickPickAnswers = [
      { label: '$(clockface) Start timer', action: 'startCountdown' },
    ];
    host.durationAnswers = ['10m'];

    await showControls(controller, host);

    assert.deepEqual(controller.startCountdownCalls, [600_000]);
    assert.equal(controller.startStopwatchCalls, 0);
    assert.deepEqual(controller.mutationCalls, []);
  });

  it('idle: a session appears while the menu is open, the pick resolves cancelled, and nothing is dispatched', async () => {
    const controller = new FakeController(undefined);
    const host = new FakeHost();

    const resultPromise = showControls(controller, host);

    // Another trigger starts a session while the quick pick is still open.
    controller.fireSessionChange(countdownSession());
    assert.equal(host.lastCancellationSource?.cancelCount, 1);

    // The host eventually settles (as VS Code does on cancellation), but the
    // result must be discarded because the menu is stale.
    host.resolvePendingQuickPick({ label: 'Stop', action: 'stop' });
    await resultPromise;

    assert.deepEqual(controller.mutationCalls, []);
    assert.equal(controller.startCountdownCalls.length, 0);
    assert.equal(controller.startStopwatchCalls, 0);
  });

  it('active: dispatches pause with the original session object as expected', async () => {
    const session = countdownSession();
    const controller = new FakeController(session);
    const host = new FakeHost();
    host.quickPickAnswers = [{ label: '$(debug-pause) Pause', action: 'pause' }];

    await showControls(controller, host);

    assert.equal(controller.mutationCalls.length, 1);
    assert.equal(controller.mutationCalls[0]?.action, 'pause');
    assert.equal(controller.mutationCalls[0]?.expected, session);
  });

  it('active: dispatches resume with the original session object as expected', async () => {
    const session = stopwatchSession();
    const controller = new FakeController(session);
    const host = new FakeHost();
    host.quickPickAnswers = [{ label: '$(debug-start) Resume', action: 'resume' }];

    await showControls(controller, host);

    assert.equal(controller.mutationCalls.length, 1);
    assert.equal(controller.mutationCalls[0]?.action, 'resume');
    assert.equal(controller.mutationCalls[0]?.expected, session);
  });

  it('active: dispatches reset with the original session object as expected', async () => {
    const session = countdownSession();
    const controller = new FakeController(session);
    const host = new FakeHost();
    host.quickPickAnswers = [{ label: '$(debug-restart) Reset', action: 'reset' }];

    await showControls(controller, host);

    assert.equal(controller.mutationCalls.length, 1);
    assert.equal(controller.mutationCalls[0]?.action, 'reset');
    assert.equal(controller.mutationCalls[0]?.expected, session);
  });

  it('active: dispatches stop with the original session object as expected', async () => {
    const session = countdownSession();
    const controller = new FakeController(session);
    const host = new FakeHost();
    host.quickPickAnswers = [{ label: '$(debug-stop) Stop', action: 'stop' }];

    await showControls(controller, host);

    assert.equal(controller.mutationCalls.length, 1);
    assert.equal(controller.mutationCalls[0]?.action, 'stop');
    assert.equal(controller.mutationCalls[0]?.expected, session);
  });

  it('active: the session changes mid-pick, so no mutation is dispatched (stale-menu guard)', async () => {
    const session = countdownSession();
    const controller = new FakeController(session);
    const host = new FakeHost();

    const resultPromise = showControls(controller, host);

    controller.fireSessionChange(stopwatchSession());
    assert.equal(host.lastCancellationSource?.cancelCount, 1);

    host.resolvePendingQuickPick({ label: 'Stop', action: 'stop' });
    await resultPromise;

    assert.deepEqual(controller.mutationCalls, []);
  });

  it('promptForCountdown while busy shows active controls instead of an input box', async () => {
    const session = countdownSession();
    const controller = new FakeController(session);
    const host = new FakeHost();
    host.quickPickAnswers = [{ label: '$(debug-stop) Stop', action: 'stop' }];

    await promptForCountdown(controller, host);

    assert.equal(host.durationCalls, 0);
    assert.equal(host.quickPickCalls.length, 1);
    assert.equal(controller.mutationCalls.length, 1);
    assert.equal(controller.mutationCalls[0]?.action, 'stop');
    assert.equal(controller.mutationCalls[0]?.expected, session);
  });

  it('cancelling the duration input starts nothing', async () => {
    const controller = new FakeController(undefined);
    const host = new FakeHost();
    host.durationAnswers = [undefined];

    await promptForCountdown(controller, host);

    assert.equal(host.durationCalls, 1);
    assert.equal(host.quickPickCalls.length, 0);
    assert.equal(controller.startCountdownCalls.length, 0);
  });

  it('startCountdown reporting busy shows active controls (handleStartResult path)', async () => {
    const controller = new FakeController(undefined);
    controller.startCountdownResult = 'busy';
    controller.busySession = countdownSession();
    const host = new FakeHost();
    host.durationAnswers = ['10m'];
    host.quickPickAnswers = [{ label: '$(debug-stop) Stop', action: 'stop' }];

    await promptForCountdown(controller, host);

    assert.deepEqual(controller.startCountdownCalls, [600_000]);
    assert.equal(host.quickPickCalls.length, 1);
    assert.equal(controller.mutationCalls.length, 1);
    assert.equal(controller.mutationCalls[0]?.action, 'stop');
    assert.equal(controller.mutationCalls[0]?.expected, controller.busySession);
  });

  it('idle: starting a stopwatch calls startStopwatch once', async () => {
    const controller = new FakeController(undefined);
    const host = new FakeHost();

    await startStopwatch(controller, host);

    assert.equal(controller.startStopwatchCalls, 1);
    assert.equal(controller.startCountdownCalls.length, 0);
    assert.equal(host.quickPickCalls.length, 0);
  });
});
