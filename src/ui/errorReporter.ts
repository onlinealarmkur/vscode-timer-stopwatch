import type { CoordinatorErrorSource } from '../core/coordinator.js';

const ERROR_MESSAGES: Record<CoordinatorErrorSource, string> = {
  storage: 'Timer & Stopwatch could not update its saved state.',
  scheduler: 'Timer & Stopwatch stopped updating unexpectedly.',
  sound: 'Timer & Stopwatch could not play its completion sound.',
  notification:
    'Timer & Stopwatch could not show its completion notification.',
};

function errorDetail(error: unknown): string {
  return error instanceof Error ? ` ${error.message}` : '';
}

export class ErrorReporter {
  private reportedStorageError = false;
  private reportedSoundError = false;

  public constructor(
    private readonly messageSink: (message: string) => unknown,
  ) {}

  public report(source: CoordinatorErrorSource, error: unknown): void {
    if (source === 'storage') {
      if (this.reportedStorageError) {
        return;
      }
      this.reportedStorageError = true;
    } else if (source === 'sound') {
      if (this.reportedSoundError) {
        return;
      }
      this.reportedSoundError = true;
    }

    void this.messageSink(`${ERROR_MESSAGES[source]}${errorDetail(error)}`);
  }

  public recordStorageSuccess(): void {
    this.reportedStorageError = false;
  }

  public recordSoundSuccess(): void {
    this.reportedSoundError = false;
  }

  public reportUserInitiatedSoundError(error: unknown): void {
    this.reportedSoundError = false;
    this.report('sound', error);
  }

  public reportCompletionPreferenceError(error: unknown): void {
    void this.messageSink(
      `Timer & Stopwatch could not save its notification preference.${errorDetail(error)}`,
    );
  }
}
