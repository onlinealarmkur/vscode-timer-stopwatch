import * as vscode from 'vscode';
import { SystemCompletionSound } from './audio/completionSound.js';
import { TimerStopwatchController } from './controller.js';
import {
  promptForCountdown,
  showControls,
  startStopwatch,
} from './ui/input.js';
import { TimerStopwatchStatusBar } from './ui/statusBar.js';

let activeController: TimerStopwatchController | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<TimerStopwatchController | undefined> {
  const completionSound = new SystemCompletionSound(
    context.globalStorageUri.fsPath,
  );
  const controller = await TimerStopwatchController.create(
    context.workspaceState,
    completionSound,
  );
  activeController = controller;
  const statusBar = new TimerStopwatchStatusBar(controller);

  context.subscriptions.push(
    controller,
    statusBar,
    vscode.commands.registerCommand('timerStopwatch.showControls', async () => {
      await showControls(controller);
    }),
    vscode.commands.registerCommand('timerStopwatch.startCountdown', async () => {
      await promptForCountdown(controller);
    }),
    vscode.commands.registerCommand('timerStopwatch.startStopwatch', async () => {
      await startStopwatch(controller);
    }),
    vscode.commands.registerCommand(
      'timerStopwatch.testCompletionSound',
      async () => {
        await controller.testCompletionSound();
      },
    ),
  );

  await controller.start();
  return context.extensionMode === vscode.ExtensionMode.Test
    ? controller
    : undefined;
}

export async function deactivate(): Promise<void> {
  const controller = activeController;
  activeController = undefined;
  await controller?.shutdown();
}
