import * as vscode from 'vscode';
import type { CompletionSound } from './audio/completionSound.js';
import { ManualSoundTest } from './audio/manualSoundTest.js';
import {
  SessionCoordinator,
  type SessionStartResult,
} from './core/coordinator.js';
import type { ActiveSession } from './core/model.js';
import { decodePersistedState, STATE_KEY } from './core/persistence.js';
import {
  SystemClock,
  UnifiedScheduler,
  type Clock,
} from './core/session.js';
import { presentCountdownCompletion } from './ui/completion.js';
import { completionNotificationUpdateTarget } from './ui/completionPreference.js';
import { ErrorReporter } from './ui/errorReporter.js';

export class TimerStopwatchController implements vscode.Disposable {
  public readonly onDidChangeSession: vscode.Event<void>;
  public readonly onDidTick: vscode.Event<number>;

  private constructor(
    private readonly coordinator: SessionCoordinator,
    private readonly sessionChangeEmitter: vscode.EventEmitter<void>,
    private readonly tickEmitter: vscode.EventEmitter<number>,
    private readonly manualSoundTest: ManualSoundTest,
  ) {
    this.onDidChangeSession = sessionChangeEmitter.event;
    this.onDidTick = tickEmitter.event;
  }

  private disposed = false;

  public static async create(
    storage: vscode.Memento,
    completionSound: CompletionSound,
    clock: Clock = new SystemClock(),
  ): Promise<TimerStopwatchController> {
    const sessionChangeEmitter = new vscode.EventEmitter<void>();
    const tickEmitter = new vscode.EventEmitter<number>();
    const errorReporter = new ErrorReporter((message) =>
      vscode.window.showErrorMessage(message),
    );
    const decoded = decodePersistedState(
      storage.get<unknown>(STATE_KEY),
      clock.now(),
    );
    const coordinator = await SessionCoordinator.create(decoded, {
      clock,
      repository: {
        save: async (state) => {
          await storage.update(STATE_KEY, state);
          errorReporter.recordStorageSuccess();
        },
      },
      presenter: {
        present: async (_session, signal) => {
          await presentCountdownCompletion({
            soundEnabled: () =>
              vscode.workspace
                .getConfiguration('timerStopwatch')
                .get('playCompletionSound', true),
            playSound: async () => {
              await completionSound.play(signal);
              errorReporter.recordSoundSuccess();
            },
            reportSoundError: (error) => errorReporter.report('sound', error),
            notificationEnabled: () =>
              vscode.workspace
                .getConfiguration('timerStopwatch')
                .get('showCompletionNotification', true),
            show: async (message, ...actions) =>
              vscode.window.showInformationMessage(message, ...actions),
            startAnother: async () => {
              await vscode.commands.executeCommand(
                'timerStopwatch.startCountdown',
              );
            },
            disableNotification: async () => {
              const configuration =
                vscode.workspace.getConfiguration('timerStopwatch');
              const target = completionNotificationUpdateTarget(
                configuration.inspect<boolean>(
                  'showCompletionNotification',
                ),
              );
              await configuration.update(
                'showCompletionNotification',
                false,
                target === 'workspace'
                  ? vscode.ConfigurationTarget.Workspace
                  : vscode.ConfigurationTarget.Global,
              );
            },
            reportPreferenceError: (error) =>
              errorReporter.reportCompletionPreferenceError(error),
          });
        },
      },
      events: {
        sessionChanged: () => sessionChangeEmitter.fire(),
        tick: (now) => tickEmitter.fire(now),
        error: (source, error) => errorReporter.report(source, error),
      },
      schedulerFactory: {
        create: (onTick, onError) =>
          new UnifiedScheduler(clock, onTick, onError),
      },
    });
    const manualSoundTest = new ManualSoundTest({
      play: async (signal) => completionSound.play(signal),
      recordSuccess: () => errorReporter.recordSoundSuccess(),
      reportError: (error) =>
        errorReporter.reportUserInitiatedSoundError(error),
    });
    return new TimerStopwatchController(
      coordinator,
      sessionChangeEmitter,
      tickEmitter,
      manualSoundTest,
    );
  }

  public async start(): Promise<void> {
    await this.coordinator.start();
  }

  public session(): ActiveSession | undefined {
    return this.coordinator.snapshot();
  }

  public startCountdown(durationMs: number): Promise<SessionStartResult> {
    return this.coordinator.startCountdown(durationMs);
  }

  public startStopwatch(): Promise<SessionStartResult> {
    return this.coordinator.startStopwatch();
  }

  public async testCompletionSound(): Promise<void> {
    await this.manualSoundTest.run();
  }

  public async pause(expectedSession?: ActiveSession): Promise<void> {
    await this.coordinator.pause(expectedSession);
  }

  public async resume(expectedSession?: ActiveSession): Promise<void> {
    await this.coordinator.resume(expectedSession);
  }

  public async reset(expectedSession?: ActiveSession): Promise<void> {
    await this.coordinator.reset(expectedSession);
  }

  public async stop(expectedSession?: ActiveSession): Promise<void> {
    await this.coordinator.stop(expectedSession);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.coordinator.dispose();
    this.manualSoundTest.dispose();
    this.sessionChangeEmitter.dispose();
    this.tickEmitter.dispose();
  }

  public async shutdown(): Promise<void> {
    this.dispose();
    await this.coordinator.shutdown();
  }
}
