import * as vscode from 'vscode';
import type { TimerStopwatchController } from '../controller.js';
import { parseDuration } from '../core/parsing.js';
import {
  promptForCountdown as promptForCountdownFlow,
  showControls as showControlsFlow,
  startStopwatch as startStopwatchFlow,
  type MenuHost,
} from './menuFlow.js';

function createHost(): MenuHost<vscode.CancellationToken> {
  return {
    showQuickPick: (items, token) =>
      vscode.window.showQuickPick(items, {
        title: 'Timer & Stopwatch',
        placeHolder: 'Choose an action',
      }, token),
    showDurationInput: () =>
      vscode.window.showInputBox({
        title: 'Start timer',
        prompt: 'Enter a duration',
        placeHolder: '25m, 1h 30m, or 05:00',
        validateInput: (value) =>
          parseDuration(value) === undefined
            ? 'Enter a whole-second duration from 1 second to 30 days, such as 10m or 01:30:00.'
            : undefined,
      }),
    createCancellationSource: () => new vscode.CancellationTokenSource(),
  };
}

export async function promptForCountdown(
  controller: TimerStopwatchController,
): Promise<void> {
  await promptForCountdownFlow(controller, createHost());
}

export async function startStopwatch(
  controller: TimerStopwatchController,
): Promise<void> {
  await startStopwatchFlow(controller, createHost());
}

export async function showControls(
  controller: TimerStopwatchController,
): Promise<void> {
  await showControlsFlow(controller, createHost());
}
