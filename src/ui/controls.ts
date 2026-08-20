import type { ActiveSession } from '../core/model.js';

export type ControlAction =
  | 'startCountdown'
  | 'startStopwatch'
  | 'pause'
  | 'resume'
  | 'reset'
  | 'stop';

export interface ControlItem {
  readonly label: string;
  readonly action: ControlAction;
}

export function buildControlItems(
  session: ActiveSession | undefined,
): ControlItem[] {
  if (session === undefined) {
    return [
      {
        label: '$(clockface) Start timer',
        action: 'startCountdown',
      },
      {
        label: '$(watch) Start stopwatch',
        action: 'startStopwatch',
      },
    ];
  }

  return [
    session.status === 'running'
      ? { label: '$(debug-pause) Pause', action: 'pause' }
      : { label: '$(debug-start) Resume', action: 'resume' },
    { label: '$(debug-restart) Reset', action: 'reset' },
    { label: '$(debug-stop) Stop', action: 'stop' },
  ];
}
