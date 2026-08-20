export interface ManualSoundTestHost {
  play(signal: AbortSignal): Promise<void>;
  recordSuccess(): void;
  reportError(error: unknown): void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function wasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export class ManualSoundTest {
  private readonly abortController = new AbortController();
  private pending: Promise<void> | undefined;
  private disposed = false;

  public constructor(private readonly host: ManualSoundTestHost) {}

  public run(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.pending !== undefined) {
      return this.pending;
    }

    this.pending = this.perform(this.abortController.signal);
    return this.pending;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.abortController.abort();
  }

  private async perform(signal: AbortSignal): Promise<void> {
    // Defer playback until run() has stored the shared promise.
    await Promise.resolve();
    if (wasAborted(signal)) {
      this.pending = undefined;
      return;
    }

    try {
      await this.host.play(signal);
      if (!wasAborted(signal)) {
        this.host.recordSuccess();
      }
    } catch (error: unknown) {
      if (!wasAborted(signal) && !isAbortError(error)) {
        this.host.reportError(error);
      }
    } finally {
      this.pending = undefined;
    }
  }
}
