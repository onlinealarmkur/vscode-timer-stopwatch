export const START_ANOTHER_TIMER = 'Start another timer';
export const DONT_SHOW_AGAIN = "Don't show again";

export interface CompletionHost {
  soundEnabled(): boolean;
  playSound(): Promise<void>;
  reportSoundError(error: unknown): void;
  notificationEnabled(): boolean;
  show(message: string, ...actions: string[]): Promise<string | undefined>;
  startAnother(): Promise<void>;
  disableNotification(): Promise<void>;
  reportPreferenceError(error: unknown): void;
}

export async function presentCountdownCompletion(
  host: CompletionHost,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();

  const sound = host.soundEnabled()
    ? host.playSound().catch((error: unknown) => {
        if (signal?.aborted !== true) {
          host.reportSoundError(error);
        }
      })
    : Promise.resolve();

  const notification = host.notificationEnabled()
    ? host
        .show(
          'Countdown finished.',
          START_ANOTHER_TIMER,
          DONT_SHOW_AGAIN,
        )
        .then(async (selected) => {
          if (signal?.aborted === true) {
            return;
          }
          if (selected === START_ANOTHER_TIMER) {
            try {
              await host.startAnother();
            } catch {
              // The invoked command owns and reports its operational errors.
            }
          } else if (selected === DONT_SHOW_AGAIN) {
            try {
              await host.disableNotification();
            } catch (error: unknown) {
              host.reportPreferenceError(error);
            }
          }
        })
    : Promise.resolve();

  await Promise.all([sound, notification]);
}
