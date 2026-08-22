import type { ActiveSession, PersistedState } from './model.js';
import {
  MAX_DURATION_MS,
  MIN_DURATION_MS,
} from './parsing.js';
import type { DecodedState } from './persistence.js';
import {
  elapsedMs,
  pauseSession,
  resetSession,
  resumeSession,
  type Clock,
} from './session.js';

export interface StateRepository {
  save(state: PersistedState): Promise<void>;
}

export interface CompletionPresenter {
  present(session: ActiveSession, signal?: AbortSignal): Promise<void>;
}

export type CoordinatorErrorSource =
  | 'storage'
  | 'scheduler'
  | 'sound'
  | 'notification';

export type SessionStartResult = 'started' | 'busy' | 'disposed';

export interface CoordinatorEvents {
  sessionChanged(): void;
  tick(now: number): void;
  error(source: CoordinatorErrorSource, error: unknown): void;
}

export interface SchedulerControl {
  start(): void;
  stop(): void;
  dispose(): void;
}

export interface SchedulerFactory {
  create(
    onTick: (now: number) => Promise<void>,
    onError: (error: unknown) => void,
  ): SchedulerControl;
}

export interface SessionCoordinatorOptions {
  readonly session: ActiveSession | undefined;
  readonly clock: Clock;
  readonly repository: StateRepository;
  readonly presenter: CompletionPresenter;
  readonly events: CoordinatorEvents;
  readonly schedulerFactory: SchedulerFactory;
}

export type SessionCoordinatorCreateOptions = Omit<
  SessionCoordinatorOptions,
  'session'
>;

export class SessionCoordinator {
  private session: ActiveSession | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly completionAbortController = new AbortController();
  private readonly pendingPresentations = new Set<Promise<void>>();
  private readonly clock: Clock;
  private readonly repository: StateRepository;
  private readonly presenter: CompletionPresenter;
  private readonly events: CoordinatorEvents;
  private readonly scheduler: SchedulerControl;

  public static async create(
    decoded: DecodedState,
    options: SessionCoordinatorCreateOptions,
  ): Promise<SessionCoordinator> {
    if (decoded.shouldPersist) {
      try {
        await options.repository.save(decoded.state);
      } catch (error: unknown) {
        options.events.error('storage', error);
      }
    }
    return new SessionCoordinator({
      ...options,
      session: decoded.state.session ?? undefined,
    });
  }

  public constructor(options: SessionCoordinatorOptions) {
    this.session = options.session;
    this.clock = options.clock;
    this.repository = options.repository;
    this.presenter = options.presenter;
    this.events = options.events;
    this.scheduler = options.schedulerFactory.create(
      async (now) => {
        try {
          await this.processTick(now);
        } catch {
          // The mutation queue already reports process-tick failures.
        }
      },
      (error) => this.events.error('scheduler', error),
    );
  }

  public async start(): Promise<void> {
    this.synchronizeScheduler();
    try {
      await this.processTick(this.clock.now());
    } catch {
      // The mutation queue already reports startup reconciliation failures.
    }
  }

  public snapshot(): ActiveSession | undefined {
    return this.session;
  }

  public async startCountdown(
    durationMs: number,
  ): Promise<SessionStartResult> {
    if (
      !Number.isFinite(durationMs) ||
      !Number.isInteger(durationMs) ||
      durationMs < MIN_DURATION_MS ||
      durationMs > MAX_DURATION_MS ||
      durationMs % MIN_DURATION_MS !== 0
    ) {
      throw new RangeError('Countdown duration is outside the supported range.');
    }
    return this.startSession((now) => ({
      mode: 'countdown',
      status: 'running',
      startedAt: now,
      accumulatedMs: 0,
      durationMs,
    }));
  }

  public async startStopwatch(): Promise<SessionStartResult> {
    return this.startSession((now) => ({
      mode: 'stopwatch',
      status: 'running',
      startedAt: now,
      accumulatedMs: 0,
    }));
  }

  public async pause(expectedSession?: ActiveSession): Promise<void> {
    await this.update(
      (session) => pauseSession(session, this.clock.now()),
      expectedSession,
    );
  }

  public async resume(expectedSession?: ActiveSession): Promise<void> {
    await this.update(
      (session) => resumeSession(session, this.clock.now()),
      expectedSession,
    );
  }

  public async reset(expectedSession?: ActiveSession): Promise<void> {
    await this.update(
      (session) => resetSession(session, this.clock.now()),
      expectedSession,
    );
  }

  public async stop(expectedSession?: ActiveSession): Promise<void> {
    await this.replace(undefined, expectedSession);
  }

  public async processTick(now: number): Promise<void> {
    if (this.disposed) {
      return;
    }
    const completed = await this.enqueue(async () => {
      if (this.disposed) {
        return undefined;
      }
      const current = this.session;
      if (
        current?.mode === 'countdown' &&
        current.status === 'running' &&
        current.durationMs !== undefined &&
        elapsedMs(current, now) >= current.durationMs
      ) {
        await this.persist(undefined);
        if (this.isDisposed()) {
          await this.restoreCompletedSession(current);
          return undefined;
        }
        this.session = undefined;
        this.synchronizeScheduler();
        this.events.sessionChanged();
        this.events.tick(now);
        return current;
      }
      this.synchronizeScheduler();
      this.events.tick(now);
      return undefined;
    });

    if (completed === undefined) {
      return;
    }
    if (this.isDisposed()) {
      await this.enqueue(async () => {
        await this.restoreCompletedSession(completed);
      });
      return;
    }
    this.trackCompletion(completed);
  }

  private async update(
    transform: (session: ActiveSession) => ActiveSession,
    expectedSession?: ActiveSession,
  ): Promise<void> {
    await this.mutate(
      (session) =>
        session === undefined ? undefined : transform(session),
      expectedSession,
    );
  }

  private async replace(
    next: ActiveSession | undefined,
    expectedSession?: ActiveSession,
  ): Promise<void> {
    await this.mutate(() => next, expectedSession);
  }

  private async startSession(
    createSession: (now: number) => ActiveSession,
  ): Promise<SessionStartResult> {
    return this.enqueue(async () => {
      if (this.disposed) {
        return 'disposed';
      }
      if (this.session !== undefined) {
        return 'busy';
      }
      const next = createSession(this.clock.now());
      await this.persist(next);
      if (this.isDisposed()) {
        return 'disposed';
      }
      this.session = next;
      this.synchronizeScheduler();
      this.events.sessionChanged();
      this.events.tick(this.clock.now());
      return 'started';
    });
  }

  private async mutate(
    transform: (
      session: ActiveSession | undefined,
    ) => ActiveSession | undefined,
    expectedSession?: ActiveSession,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.enqueue(async () => {
      if (
        expectedSession !== undefined &&
        this.session !== expectedSession
      ) {
        return;
      }
      const next = transform(this.session);
      if (this.disposed || next === this.session) {
        return;
      }
      await this.persist(next);
      if (this.isDisposed()) {
        return;
      }
      this.session = next;
      this.synchronizeScheduler();
      this.events.sessionChanged();
      this.events.tick(this.clock.now());
    });
  }

  private synchronizeScheduler(): void {
    if (this.session?.status === 'running') {
      this.scheduler.start();
    } else {
      this.scheduler.stop();
    }
  }

  private isDisposed(): boolean {
    return this.disposed;
  }

  private async persist(session: ActiveSession | undefined): Promise<void> {
    await this.repository.save({ version: 2, session: session ?? null });
  }

  private async restoreCompletedSession(session: ActiveSession): Promise<void> {
    try {
      await this.persist(session);
    } catch {
      // Restoration during disposal is best-effort shutdown behavior.
    }
  }

  private async presentCompletion(session: ActiveSession): Promise<void> {
    try {
      await this.presenter.present(
        session,
        this.completionAbortController.signal,
      );
    } catch (error: unknown) {
      if (
        !this.disposed &&
        !this.completionAbortController.signal.aborted
      ) {
        this.events.error('notification', error);
      }
    }
  }

  private trackCompletion(session: ActiveSession): void {
    const pending = this.presentCompletion(session);
    this.pendingPresentations.add(pending);
    void pending.finally(() => {
      this.pendingPresentations.delete(pending);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      (error: unknown) => {
        if (!this.disposed) {
          this.events.error('storage', error);
        }
      },
    );
    return result;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.completionAbortController.abort();
    this.scheduler.dispose();
  }

  public async shutdown(): Promise<void> {
    this.dispose();
    let pending: Promise<void>;
    do {
      pending = this.mutationQueue;
      await pending;
      await Promise.resolve();
    } while (pending !== this.mutationQueue);
  }
}
