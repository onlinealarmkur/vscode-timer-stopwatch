import * as vscode from 'vscode';
import type { TimerStopwatchController } from '../controller.js';
import {
  StatusBarBinding,
  type StatusBarPreferences,
  type StatusBarSink,
} from './statusBarBinding.js';

const SHOW_IDLE_LABEL_SETTING = 'timerStopwatch.showIdleLabel';

export class TimerStopwatchStatusBar implements vscode.Disposable {
  private readonly binding: StatusBarBinding;

  public constructor(controller: TimerStopwatchController) {
    const item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    const sink: StatusBarSink = {
      configure: (name, command) => {
        item.name = name;
        item.command = command;
      },
      render: (presentation) => {
        item.text = presentation.text;
        item.tooltip = presentation.tooltip;
      },
      show: () => item.show(),
      dispose: () => item.dispose(),
    };
    const preferences: StatusBarPreferences = {
      showIdleLabel: () =>
        vscode.workspace
          .getConfiguration('timerStopwatch')
          .get('showIdleLabel', true),
      onDidChange: (listener) =>
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(SHOW_IDLE_LABEL_SETTING)) {
            listener();
          }
        }),
    };

    this.binding = new StatusBarBinding(
      controller,
      sink,
      Date.now,
      preferences,
    );
  }

  public dispose(): void {
    this.binding.dispose();
  }
}
