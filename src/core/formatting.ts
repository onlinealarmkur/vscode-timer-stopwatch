import type { ActiveSession } from './model.js';
import { elapsedMs, remainingMs } from './session.js';

export interface StatusBarPresentation {
  readonly text: string;
  readonly tooltip: string;
  readonly accessibilityLabel: string;
}

const pad = (value: number): string => value.toString().padStart(2, '0');

const secondsFromMilliseconds = (
  milliseconds: number,
  roundUp: boolean,
): number => {
  const safeMilliseconds = Number.isFinite(milliseconds)
    ? milliseconds
    : 0;
  return Math.max(
    0,
    roundUp
      ? Math.ceil(safeMilliseconds / 1_000)
      : Math.floor(safeMilliseconds / 1_000),
  );
};

const formatAccessibleDuration = (
  milliseconds: number,
  roundUp = false,
): string => {
  const totalSeconds = secondsFromMilliseconds(milliseconds, roundUp);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  }

  return parts.join(', ');
};

export function formatClock(milliseconds: number, roundUp = false): string {
  const seconds = secondsFromMilliseconds(milliseconds, roundUp);
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
      accessibilityLabel: 'Timer and Stopwatch, ready.',
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
      accessibilityLabel: `${paused ? 'Countdown paused' : 'Countdown'}, ${formatAccessibleDuration(remainingMs(session, now), true)} remaining.`,
    };
  }

  const elapsed = formatClock(elapsedMs(session, now));
  return {
    text: `${icon} ${elapsed}`,
    tooltip: paused
      ? 'Stopwatch paused. Select for controls.'
      : 'Stopwatch. Select for controls.',
    accessibilityLabel: `${paused ? 'Stopwatch paused' : 'Stopwatch'}, ${formatAccessibleDuration(elapsedMs(session, now))} elapsed.`,
  };
}
