import type { ActiveSession } from './model.js';

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }
}

export function elapsedMs(session: ActiveSession, now: number): number {
  const currentSegment =
    session.status === 'running' ? Math.max(0, now - session.startedAt) : 0;
  return session.accumulatedMs + currentSegment;
}

export function remainingMs(session: ActiveSession, now: number): number {
  if (session.mode !== 'countdown' || session.durationMs === undefined) {
    return 0;
  }
  return Math.max(0, session.durationMs - elapsedMs(session, now));
}

export function pauseSession(
  session: ActiveSession,
  now: number,
): ActiveSession {
  if (session.status === 'paused') {
    return session;
  }
  const elapsed = elapsedMs(session, now);
  if (
    session.mode === 'countdown' &&
    session.durationMs !== undefined &&
    elapsed >= session.durationMs
  ) {
    return session;
  }
  return {
    ...session,
    status: 'paused',
    startedAt: now,
    accumulatedMs: elapsed,
  };
}

export function resumeSession(
  session: ActiveSession,
  now: number,
): ActiveSession {
  if (session.status === 'running') {
    return session;
  }
  return { ...session, status: 'running', startedAt: now };
}

export function resetSession(
  session: ActiveSession,
  now: number,
): ActiveSession {
  return {
    ...session,
    status: 'paused',
    startedAt: now,
    accumulatedMs: 0,
  };
}

export interface IntervalDriver {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(interval: unknown): void;
}

const systemIntervalDriver: IntervalDriver = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (interval) => {
    clearInterval(interval as ReturnType<typeof setInterval>);
  },
};

export class UnifiedScheduler {
  private interval: { readonly handle: unknown } | undefined;
  private ticking = false;

  public constructor(
    private readonly clock: Clock,
    private readonly onTick: (now: number) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly intervalMs = 1_000,
    private readonly intervalDriver: IntervalDriver = systemIntervalDriver,
  ) {}

  public start(): void {
    if (this.interval !== undefined) {
      return;
    }
    this.interval = {
      handle: this.intervalDriver.setInterval(() => {
        void this.tick().catch((error: unknown) => {
          this.onError(error);
        });
      }, this.intervalMs),
    };
  }

  public async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      await this.onTick(this.clock.now());
    } finally {
      this.ticking = false;
    }
  }

  public stop(): void {
    if (this.interval === undefined) {
      return;
    }
    this.intervalDriver.clearInterval(this.interval.handle);
    this.interval = undefined;
  }

  public dispose(): void {
    this.stop();
  }
}
