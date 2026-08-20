import {
  formatStatusBar,
  type StatusBarPresentation,
} from '../core/formatting.js';
import type { ActiveSession } from '../core/model.js';

export interface StatusBarDisposable {
  dispose(): void;
}

export type StatusBarEvent<T> = (
  listener: (event: T) => void,
) => StatusBarDisposable;

export interface StatusBarController {
  session(): ActiveSession | undefined;
  readonly onDidChangeSession: StatusBarEvent<void>;
  readonly onDidTick: StatusBarEvent<number>;
}

export interface StatusBarSink {
  configure(name: string, command: string): void;
  render(presentation: StatusBarPresentation): void;
  show(): void;
  dispose(): void;
}

export interface StatusBarPreferences {
  showIdleLabel(): boolean;
  readonly onDidChange: StatusBarEvent<void>;
}

export class StatusBarBinding implements StatusBarDisposable {
  private readonly subscriptions: readonly StatusBarDisposable[];
  private lastPresentation: StatusBarPresentation | undefined;

  public constructor(
    private readonly controller: StatusBarController,
    private readonly sink: StatusBarSink,
    private readonly currentTime: () => number = Date.now,
    private readonly preferences?: StatusBarPreferences,
  ) {
    sink.configure('Timer & Stopwatch', 'timerStopwatch.showControls');
    this.subscriptions = [
      controller.onDidChangeSession(() => this.render(currentTime())),
      controller.onDidTick((now) => this.render(now)),
      ...(preferences === undefined
        ? []
        : [preferences.onDidChange(() => this.render(currentTime()))]),
    ];
    this.render(currentTime());
    sink.show();
  }

  private render(now: number): void {
    const presentation = formatStatusBar(
      this.controller.session(),
      now,
      this.preferences?.showIdleLabel() ?? true,
    );
    if (
      this.lastPresentation?.text === presentation.text &&
      this.lastPresentation.tooltip === presentation.tooltip
    ) {
      return;
    }
    this.lastPresentation = presentation;
    this.sink.render(presentation);
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.sink.dispose();
  }
}
