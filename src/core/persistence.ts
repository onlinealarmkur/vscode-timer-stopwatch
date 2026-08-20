import type {
  ActiveSession,
  PersistedState,
  SessionMode,
  SessionStatus,
} from './model.js';
import {
  MAX_DURATION_MS,
  MIN_DURATION_MS,
} from './parsing.js';

export const STATE_KEY = 'timerStopwatch.state';

export interface DecodedState {
  readonly state: PersistedState;
  readonly shouldPersist: boolean;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const isMode = (value: unknown): value is SessionMode =>
  value === 'countdown' || value === 'stopwatch';

const isStatus = (value: unknown): value is SessionStatus =>
  value === 'running' || value === 'paused';

function decodeSession(value: unknown, now: number): ActiveSession | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const mode = value.mode;
  const status = value.status;
  const startedAt = finiteNumber(value.startedAt);
  const accumulatedMs = finiteNumber(value.accumulatedMs);
  const durationMs = finiteNumber(value.durationMs);
  if (
    !isMode(mode) ||
    !isStatus(status) ||
    startedAt === undefined ||
    accumulatedMs === undefined ||
    startedAt < 0 ||
    accumulatedMs < 0 ||
    (mode === 'countdown' &&
      (durationMs === undefined ||
        !Number.isInteger(durationMs) ||
        durationMs < MIN_DURATION_MS ||
        durationMs > MAX_DURATION_MS ||
        durationMs % MIN_DURATION_MS !== 0 ||
        (status === 'paused' && accumulatedMs >= durationMs))) ||
    (mode === 'stopwatch' && durationMs !== undefined)
  ) {
    return undefined;
  }
  const clampedStartedAt = Math.min(startedAt, now);
  return mode === 'countdown'
    ? { mode, status, startedAt: clampedStartedAt, accumulatedMs, durationMs }
    : { mode, status, startedAt: clampedStartedAt, accumulatedMs };
}

function encodedExactly(raw: unknown, state: PersistedState): boolean {
  try {
    return JSON.stringify(raw) === JSON.stringify(state);
  } catch {
    return false;
  }
}

export function decodePersistedState(raw: unknown, now: number): DecodedState {
  if (isRecord(raw) && raw.version === 2) {
    if (raw.session === null) {
      const state: PersistedState = { version: 2, session: null };
      return { state, shouldPersist: !encodedExactly(raw, state) };
    }
    const session = decodeSession(raw.session, now);
    if (session !== undefined) {
      const state: PersistedState = { version: 2, session };
      return { state, shouldPersist: !encodedExactly(raw, state) };
    }
  }

  return {
    state: { version: 2, session: null },
    shouldPersist: raw !== undefined,
  };
}
