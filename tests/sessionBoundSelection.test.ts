import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  selectWhileSessionIsCurrent,
  type CancellationSourceLike,
  type DisposableLike,
} from '../src/ui/sessionBoundSelection.js';

interface Session {
  readonly id: number;
}

interface CancellationToken {
  readonly name: string;
}

class TestCancellationSource
implements CancellationSourceLike<CancellationToken> {
  public readonly token = { name: 'test-token' };
  public cancelCount = 0;
  public disposeCount = 0;

  public cancel(): void {
    this.cancelCount += 1;
  }

  public dispose(): void {
    this.disposeCount += 1;
  }
}

class SessionEvents {
  public current: Session | undefined;
  public subscriptionDisposeCount = 0;
  private readonly listeners = new Set<() => void>();

  public constructor(session: Session | undefined) {
    this.current = session;
  }

  public subscribe(listener: () => void): DisposableLike {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.subscriptionDisposeCount += 1;
        this.listeners.delete(listener);
      },
    };
  }

  public change(session: Session | undefined): void {
    this.current = session;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (error) => rejectPromise?.(error),
  };
}

describe('session-bound selection', () => {
  it('returns a selection while the captured session remains current', async () => {
    const session = { id: 1 };
    const events = new SessionEvents(session);
    const cancellation = new TestCancellationSource();
    let receivedToken: CancellationToken | undefined;

    const selected = await selectWhileSessionIsCurrent({
      expectedSession: session,
      currentSession: () => events.current,
      onDidChangeSession: (listener) => events.subscribe(listener),
      createCancellationSource: () => cancellation,
      select: async (token) => {
        receivedToken = token;
        return 'pause';
      },
    });

    assert.equal(selected, 'pause');
    assert.equal(receivedToken, cancellation.token);
    assert.equal(cancellation.cancelCount, 0);
    assert.equal(cancellation.disposeCount, 1);
    assert.equal(events.subscriptionDisposeCount, 1);
  });

  it('treats user cancellation as an ordinary absent selection', async () => {
    const session = { id: 1 };
    const events = new SessionEvents(session);
    const cancellation = new TestCancellationSource();

    const selected = await selectWhileSessionIsCurrent({
      expectedSession: session,
      currentSession: () => events.current,
      onDidChangeSession: (listener) => events.subscribe(listener),
      createCancellationSource: () => cancellation,
      select: async () => undefined,
    });

    assert.equal(selected, undefined);
    assert.equal(cancellation.cancelCount, 0);
    assert.equal(cancellation.disposeCount, 1);
    assert.equal(events.subscriptionDisposeCount, 1);
  });

  it('cancels an open selection and ignores its result after a session change', async () => {
    const session = { id: 1 };
    const events = new SessionEvents(session);
    const cancellation = new TestCancellationSource();
    const pendingSelection = deferred<string | undefined>();

    const result = selectWhileSessionIsCurrent({
      expectedSession: session,
      currentSession: () => events.current,
      onDidChangeSession: (listener) => events.subscribe(listener),
      createCancellationSource: () => cancellation,
      select: () => pendingSelection.promise,
    });

    events.change(undefined);
    assert.equal(cancellation.cancelCount, 1);

    pendingSelection.resolve('pause');
    assert.equal(await result, undefined);
    assert.equal(cancellation.disposeCount, 1);
    assert.equal(events.subscriptionDisposeCount, 1);
  });

  it('does not open a selection when the captured session is already stale', async () => {
    const capturedSession = { id: 1 };
    const events = new SessionEvents({ id: 2 });
    const cancellation = new TestCancellationSource();
    let selectionCalls = 0;

    const selected = await selectWhileSessionIsCurrent({
      expectedSession: capturedSession,
      currentSession: () => events.current,
      onDidChangeSession: (listener) => events.subscribe(listener),
      createCancellationSource: () => cancellation,
      select: async () => {
        selectionCalls += 1;
        return 'pause';
      },
    });

    assert.equal(selected, undefined);
    assert.equal(selectionCalls, 0);
    assert.equal(cancellation.cancelCount, 1);
    assert.equal(cancellation.disposeCount, 1);
    assert.equal(events.subscriptionDisposeCount, 1);
  });

  it('swallows only cancellation errors caused by a stale session', async () => {
    const session = { id: 1 };
    const events = new SessionEvents(session);
    const cancellation = new TestCancellationSource();
    const pendingSelection = deferred<string | undefined>();

    const result = selectWhileSessionIsCurrent({
      expectedSession: session,
      currentSession: () => events.current,
      onDidChangeSession: (listener) => events.subscribe(listener),
      createCancellationSource: () => cancellation,
      select: () => pendingSelection.promise,
    });

    events.change(undefined);
    pendingSelection.reject(new Error('cancelled'));

    assert.equal(await result, undefined);
    assert.equal(cancellation.cancelCount, 1);
    assert.equal(cancellation.disposeCount, 1);
    assert.equal(events.subscriptionDisposeCount, 1);
  });

  it('propagates unrelated selection errors after deterministic cleanup', async () => {
    const session = { id: 1 };
    const events = new SessionEvents(session);
    const cancellation = new TestCancellationSource();
    const selectionError = new Error('host failed');

    await assert.rejects(
      selectWhileSessionIsCurrent({
        expectedSession: session,
        currentSession: () => events.current,
        onDidChangeSession: (listener) => events.subscribe(listener),
        createCancellationSource: () => cancellation,
        select: async () => {
          throw selectionError;
        },
      }),
      selectionError,
    );

    assert.equal(cancellation.cancelCount, 0);
    assert.equal(cancellation.disposeCount, 1);
    assert.equal(events.subscriptionDisposeCount, 1);
  });
});
