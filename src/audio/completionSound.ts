import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SOUND_FILE_NAME = 'completion-beep-v1.wav';
const DEFAULT_PLAYBACK_TIMEOUT_MS = 10_000;
const LINUX_PLAYER_TIMEOUT_MS = 2_000;
const WINDOWS_SOUND_PATH_VARIABLE = 'TIMER_STOPWATCH_SOUND_FILE';
const WINDOWS_PLAY_COMMAND =
  '$player = New-Object System.Media.SoundPlayer($env:TIMER_STOPWATCH_SOUND_FILE); ' +
  '$player.Load(); $player.PlaySync()';

export interface CompletionSound {
  play(signal?: AbortSignal): Promise<void>;
}

export interface PlaybackCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export type PlaybackCommandRunner = (
  command: PlaybackCommand,
  signal?: AbortSignal,
) => Promise<void>;

export function createCompletionBeepWav(): Buffer {
  const sampleRate = 44_100;
  const durationSeconds = 0.3;
  const frequencyHz = 880;
  const amplitude = 0.3;
  const fadeSeconds = 0.015;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const fadeSamples = Math.floor(sampleRate * fadeSeconds);
  for (let index = 0; index < sampleCount; index += 1) {
    const fadeIn = Math.min(1, index / fadeSamples);
    const fadeOut = Math.min(1, (sampleCount - index - 1) / fadeSamples);
    const envelope = Math.min(fadeIn, fadeOut);
    const sample =
      Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate) *
      amplitude *
      envelope;
    buffer.writeInt16LE(
      Math.round(sample * 32_767),
      44 + index * bytesPerSample,
    );
  }

  return buffer;
}

export function playbackCommands(
  platform: NodeJS.Platform,
  soundPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): readonly PlaybackCommand[] {
  if (platform === 'darwin') {
    return [{ executable: '/usr/bin/afplay', arguments: [soundPath] }];
  }
  if (platform === 'win32') {
    const configuredWindowsDirectory =
      environment.SystemRoot ?? environment.WINDIR;
    const normalizedWindowsDirectory =
      configuredWindowsDirectory === undefined
        ? undefined
        : path.win32.normalize(configuredWindowsDirectory);
    const windowsDirectory =
      normalizedWindowsDirectory !== undefined &&
      /^[A-Za-z]:[\\/]/u.test(normalizedWindowsDirectory) &&
      path.win32.basename(normalizedWindowsDirectory).toLowerCase() ===
        'windows' &&
      path.win32.dirname(normalizedWindowsDirectory).toLowerCase() ===
        path.win32.parse(normalizedWindowsDirectory).root.toLowerCase()
        ? normalizedWindowsDirectory
        : 'C:\\Windows';
    return [
      {
        executable: path.win32.join(
          windowsDirectory,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        ),
        arguments: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          WINDOWS_PLAY_COMMAND,
        ],
        environment: {
          [WINDOWS_SOUND_PATH_VARIABLE]: soundPath,
        },
      },
    ];
  }
  if (platform === 'linux') {
    return [
      {
        executable: '/usr/bin/paplay',
        arguments: [soundPath],
        timeoutMs: LINUX_PLAYER_TIMEOUT_MS,
      },
      {
        executable: '/usr/bin/aplay',
        arguments: ['-q', soundPath],
        timeoutMs: LINUX_PLAYER_TIMEOUT_MS,
      },
      {
        executable: '/usr/bin/ffplay',
        arguments: [
          '-nodisp',
          '-autoexit',
          '-loglevel',
          'quiet',
          soundPath,
        ],
        timeoutMs: LINUX_PLAYER_TIMEOUT_MS,
      },
    ];
  }
  return [];
}

const errorCode = (error: unknown): string | undefined => {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    typeof error.code !== 'string'
  ) {
    return undefined;
  }
  return error.code;
};

const wasKilled = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'killed' in error &&
  error.killed === true;

const playerName = (executable: string): string => {
  const basename = executable.includes('\\')
    ? path.win32.basename(executable)
    : path.basename(executable);
  return basename.replace(/\.exe$/iu, '');
};

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message.replace(/\s+/gu, ' ').trim()
    : 'unknown error';

function playbackFailure(
  commands: readonly PlaybackCommand[],
  failures: readonly unknown[],
): Error {
  if (commands.length === 0) {
    return new Error(
      'No completion-sound player is configured for this operating system.',
    );
  }

  const attemptedPlayers = commands.map((command) =>
    playerName(command.executable),
  );
  const attempted = attemptedPlayers.join(', ');
  if (failures.every((error) => errorCode(error) === 'ENOENT')) {
    return new AggregateError(
      failures,
      `No supported completion-sound player is installed. Tried: ${attempted}.`,
    );
  }

  let diagnosticIndex = failures.length - 1;
  while (
    diagnosticIndex > 0 &&
    errorCode(failures[diagnosticIndex]) === 'ENOENT'
  ) {
    diagnosticIndex -= 1;
  }
  const command = commands[diagnosticIndex];
  const failure = failures[diagnosticIndex];
  const player =
    attemptedPlayers[diagnosticIndex] ?? 'completion-sound player';
  const detail =
    command !== undefined && wasKilled(failure)
      ? `${player} timed out after ${
          (command.timeoutMs ?? DEFAULT_PLAYBACK_TIMEOUT_MS) / 1_000
        } seconds.`
      : `${player} reported: ${errorMessage(failure)}`;
  return new AggregateError(
    failures,
    `Completion sound playback failed. Tried: ${attempted}. ${detail}`,
  );
}

export async function playFirstAvailable(
  commands: readonly PlaybackCommand[],
  run: PlaybackCommandRunner,
  signal?: AbortSignal,
): Promise<void> {
  const failures: unknown[] = [];
  for (const command of commands) {
    signal?.throwIfAborted();
    try {
      await run(command, signal);
      return;
    } catch (error: unknown) {
      if (signal?.aborted === true) {
        throw error;
      }
      failures.push(error);
    }
  }
  throw playbackFailure(commands, failures);
}

export const runPlaybackCommand: PlaybackCommandRunner = async (
  command,
  signal,
) => {
  await new Promise<void>((resolve, reject) => {
    execFile(
      command.executable,
      [...command.arguments],
      {
        env:
          command.environment === undefined
            ? process.env
            : { ...process.env, ...command.environment },
        timeout: command.timeoutMs ?? DEFAULT_PLAYBACK_TIMEOUT_MS,
        windowsHide: true,
        signal,
      },
      (error) => {
        if (error === null) {
          resolve();
        } else {
          reject(
            error instanceof Error
              ? error
              : new Error('Completion sound player failed.'),
          );
        }
      },
    );
  });
};

export class SystemCompletionSound implements CompletionSound {
  public constructor(
    private readonly storageDirectory: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly run: PlaybackCommandRunner = runPlaybackCommand,
  ) {}

  public async play(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const soundPath = path.join(this.storageDirectory, SOUND_FILE_NAME);
    const commands = playbackCommands(this.platform, soundPath);
    if (commands.length === 0) {
      throw new Error(
        `Completion sound is not supported on ${this.platform}.`,
      );
    }
    await this.ensureSoundFile(soundPath);
    signal?.throwIfAborted();
    await playFirstAvailable(commands, this.run, signal);
  }

  private async ensureSoundFile(soundPath: string): Promise<void> {
    const expected = createCompletionBeepWav();
    try {
      if ((await readFile(soundPath)).equals(expected)) {
        return;
      }
    } catch {
      // Missing and unreadable cache entries are regenerated below.
    }

    await mkdir(this.storageDirectory, { recursive: true });
    const temporaryPath = `${soundPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, expected, { flag: 'wx' });
      await rename(temporaryPath, soundPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
