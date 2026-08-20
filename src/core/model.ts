export type SessionMode = 'countdown' | 'stopwatch';

export type SessionStatus = 'running' | 'paused';

export interface ActiveSession {
  readonly mode: SessionMode;
  readonly status: SessionStatus;
  readonly startedAt: number;
  readonly accumulatedMs: number;
  readonly durationMs?: number;
}

export interface PersistedState {
  readonly version: 2;
  readonly session: ActiveSession | null;
}
