import type { ActiveSession } from './model.js';
import { elapsedMs, remainingMs } from './session.js';

export interface StatusBarPresentation {
  readonly text: string;
  readonly tooltip: string;
}

const pad = (value: number): string => value.toString().padStart(2, '0');

export function formatClock(milliseconds: number, roundUp = false): string {
  const safeMilliseconds = Number.isFinite(milliseconds)
    ? milliseconds
    : 0;
  const seconds = Math.max(
    0,
    roundUp
      ? Math.ceil(safeMilliseconds / 1_000)
      : Math.floor(safeMilliseconds / 1_000),
  );
  const displaySeconds = seconds % 60;
  const totalMinutes = Math.floor(seconds / 60);
  const displayMinutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${hours}:${pad(displayMinutes)}:${pad(displaySeconds)}`
    : `${displayMinutes}:${pad(displaySeconds)}`;
}

export function formatStatusBar(
  session: ActiveSession | undefined,
  now: number,
  showIdleLabel = true,
): StatusBarPresentation {
  if (session === undefined) {
    return {
      text: showIdleLabel ? '$(clockface) Timer' : '$(clockface)',
      tooltip: 'Timer & Stopwatch. Select to start.',
    };
  }

  const paused = session.status === 'paused';
  const icon = paused
    ? '$(debug-pause)'
    : session.mode === 'countdown'
      ? '$(clockface)'
      : '$(watch)';
  if (session.mode === 'countdown') {
    const remaining = formatClock(remainingMs(session, now), true);
    return {
      text: `${icon} ${remaining}`,
      tooltip: paused
        ? 'Countdown paused. Select for controls.'
        : 'Countdown. Select for controls.',
    };
  }

  const elapsed = formatClock(elapsedMs(session, now));
  return {
    text: `${icon} ${elapsed}`,
    tooltip: paused
      ? 'Stopwatch paused. Select for controls.'
      : 'Stopwatch. Select for controls.',
  };
}
