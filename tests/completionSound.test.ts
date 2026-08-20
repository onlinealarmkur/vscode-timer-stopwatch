import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import {
  createCompletionBeepWav,
  playbackCommands,
  playFirstAvailable,
  runPlaybackCommand,
  SystemCompletionSound,
  type PlaybackCommand,
} from '../src/audio/completionSound.js';

describe('completion sound', () => {
  it('generates a valid original PCM WAV beep', () => {
    const wav = createCompletionBeepWav();

    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(wav.subarray(12, 16).toString('ascii'), 'fmt ');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 44_100);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.subarray(36, 40).toString('ascii'), 'data');
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    assert.ok(
      wav.subarray(44).some((sampleByte) => sampleByte !== 0),
      'Generated sound should contain an audible waveform.',
    );
    assert.equal(wav.length, 44 + 13_230 * 2);
    assert.equal(wav.readInt16LE(44), 0);
    assert.equal(wav.readInt16LE(wav.length - 2), 0);
    let peak = 0;
    for (let offset = 44; offset < wav.length; offset += 2) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
    }
    assert.ok(peak > 0 && peak <= Math.round(32_767 * 0.3));
  });

  it('uses fixed platform players without interpolating the sound path', () => {
    const soundPath = "/tmp/a user's beep.wav";

    assert.deepEqual(playbackCommands('darwin', soundPath), [
      { executable: '/usr/bin/afplay', arguments: [soundPath] },
    ]);
    const windows = playbackCommands('win32', soundPath, {
      SystemRoot: 'D:\\Windows',
    });
    assert.equal(
      windows[0]?.executable,
      'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    assert.equal(
      windows[0]?.arguments.some((argument) => argument.includes(soundPath)),
      false,
    );
    assert.equal(
      windows[0]?.environment?.TIMER_STOPWATCH_SOUND_FILE,
      soundPath,
    );
    assert.deepEqual(
      playbackCommands('linux', soundPath).map((command) => ({
        executable: command.executable,
        timeoutMs: command.timeoutMs,
      })),
      [
        { executable: '/usr/bin/paplay', timeoutMs: 2_000 },
        { executable: '/usr/bin/aplay', timeoutMs: 2_000 },
        { executable: '/usr/bin/ffplay', timeoutMs: 2_000 },
      ],
    );
    assert.deepEqual(playbackCommands('aix', soundPath), []);
  });

  it('falls back to the trusted Windows system directory', () => {
    const [command] = playbackCommands('win32', 'C:\\beep.wav', {
      SystemRoot: '.\\workspace',
    });

    assert.equal(
      command?.executable,
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );

    const [absoluteButUntrusted] = playbackCommands(
      'win32',
      'C:\\beep.wav',
      { SystemRoot: 'D:\\Tools' },
    );
    assert.equal(
      absoluteButUntrusted?.executable,
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
  });

  it('accepts only a drive-root Windows directory named Windows', () => {
    const executable = (environment: NodeJS.ProcessEnv): string | undefined =>
      playbackCommands('win32', 'C:\\beep.wav', environment)[0]?.executable;

    assert.equal(
      executable({ WINDIR: 'E:\\WINDOWS' }),
      'E:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    assert.equal(
      executable({ SystemRoot: 'D:\\Windows', WINDIR: 'E:\\Windows' }),
      'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    for (const SystemRoot of [
      '\\\\server\\Windows',
      'C:\\Tools\\Windows',
      'C:\\Windows\\..\\Tools',
    ]) {
      assert.equal(
        executable({ SystemRoot }),
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      );
    }
  });

  it('falls back to the next available player', async () => {
    const commands: PlaybackCommand[] = [
      { executable: 'first', arguments: [] },
      { executable: 'second', arguments: [] },
      { executable: 'third', arguments: [] },
    ];
    const attempted: string[] = [];

    await playFirstAvailable(commands, async (command) => {
      attempted.push(command.executable);
      if (command.executable === 'first') {
        throw new Error('missing');
      }
    });

    assert.deepEqual(attempted, ['first', 'second']);
  });

  it('reports missing players and preserves every failure', async () => {
    const paplayMissing = Object.assign(new Error('paplay missing'), {
      code: 'ENOENT',
    });
    const aplayMissing = Object.assign(new Error('aplay missing'), {
      code: 'ENOENT',
    });

    await assert.rejects(
      playFirstAvailable(
        [
          { executable: '/usr/bin/paplay', arguments: [] },
          { executable: '/usr/bin/aplay', arguments: [] },
        ],
        async (command) => {
          throw command.executable.endsWith('paplay')
            ? paplayMissing
            : aplayMissing;
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(
          error.message,
          'No supported completion-sound player is installed. Tried: paplay, aplay.',
        );
        assert.deepEqual(error.errors, [paplayMissing, aplayMissing]);
        return true;
      },
    );
  });

  it('reports the last meaningful player failure instead of a later missing player', async () => {
    const deviceFailure = Object.assign(
      new Error('audio device is unavailable'),
      { code: 'EIO' },
    );
    const missingFailure = Object.assign(new Error('ffplay missing'), {
      code: 'ENOENT',
    });
    const attempted: string[] = [];

    await assert.rejects(
      playFirstAvailable(
        [
          { executable: '/usr/bin/paplay', arguments: [] },
          { executable: '/usr/bin/ffplay', arguments: [] },
        ],
        async (command) => {
          attempted.push(command.executable);
          throw command.executable.endsWith('paplay')
            ? deviceFailure
            : missingFailure;
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(
          error.message,
          'Completion sound playback failed. Tried: paplay, ffplay. ' +
            'paplay reported: audio device is unavailable',
        );
        assert.deepEqual(error.errors, [deviceFailure, missingFailure]);
        return true;
      },
    );
    assert.deepEqual(attempted, ['/usr/bin/paplay', '/usr/bin/ffplay']);
  });

  it('reports an empty platform player configuration', async () => {
    await assert.rejects(
      playFirstAvailable([], async () => undefined),
      /No completion-sound player is configured for this operating system\./,
    );
  });

  it('creates and reuses the generated sound file', async () => {
    const storageDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'timer-stopwatch-sound-'),
    );
    const commands: PlaybackCommand[] = [];
    const sound = new SystemCompletionSound(
      storageDirectory,
      'darwin',
      async (command) => {
        commands.push(command);
      },
    );

    try {
      await sound.play();
      await sound.play();

      const soundPath = commands[0]?.arguments[0];
      assert.ok(soundPath !== undefined);
      const stored = await readFile(soundPath);
      assert.deepEqual(stored, createCompletionBeepWav());
      assert.equal(commands.length, 2);
      assert.equal(commands[1]?.arguments[0], soundPath);
      assert.deepEqual(
        (await readdir(storageDirectory)).filter((entry) =>
          entry.endsWith('.tmp'),
        ),
        [],
      );
    } finally {
      await rm(storageDirectory, { recursive: true, force: true });
    }
  });

  it('replaces a corrupt cached sound file atomically', async () => {
    const storageDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'timer-stopwatch-sound-'),
    );
    const sound = new SystemCompletionSound(
      storageDirectory,
      'darwin',
      async () => undefined,
    );

    try {
      await sound.play();
      const soundPath = path.join(
        storageDirectory,
        'completion-beep-v1.wav',
      );
      await writeFile(soundPath, Buffer.from('corrupt'));

      await sound.play();

      assert.deepEqual(await readFile(soundPath), createCompletionBeepWav());
      assert.deepEqual(
        (await readdir(storageDirectory)).filter((entry) =>
          entry.endsWith('.tmp'),
        ),
        [],
      );
    } finally {
      await rm(storageDirectory, { recursive: true, force: true });
    }
  });

  it('handles concurrent cache creation without leaving temporary files', async () => {
    const storageDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'timer-stopwatch-sound-'),
    );
    const first = new SystemCompletionSound(
      storageDirectory,
      'darwin',
      async () => undefined,
    );
    const second = new SystemCompletionSound(
      storageDirectory,
      'darwin',
      async () => undefined,
    );

    try {
      await Promise.all([first.play(), second.play()]);

      assert.deepEqual(
        await readFile(
          path.join(storageDirectory, 'completion-beep-v1.wav'),
        ),
        createCompletionBeepWav(),
      );
      assert.deepEqual(
        (await readdir(storageDirectory)).filter((entry) =>
          entry.endsWith('.tmp'),
        ),
        [],
      );
    } finally {
      await rm(storageDirectory, { recursive: true, force: true });
    }
  });

  it('cleans up its temporary file when the final cache path is unusable', async () => {
    const storageDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'timer-stopwatch-sound-'),
    );
    const finalPath = path.join(storageDirectory, 'completion-beep-v1.wav');
    await mkdir(finalPath);
    const sound = new SystemCompletionSound(
      storageDirectory,
      'darwin',
      async () => undefined,
    );

    try {
      await assert.rejects(sound.play());
      assert.deepEqual(
        (await readdir(storageDirectory)).filter((entry) =>
          entry.endsWith('.tmp'),
        ),
        [],
      );
    } finally {
      await rm(storageDirectory, { recursive: true, force: true });
    }
  });

  it('rejects unsupported and pre-aborted playback before touching storage', async () => {
    const storageDirectory = path.join(
      os.tmpdir(),
      `timer-stopwatch-missing-${process.pid}-${Date.now()}`,
    );
    let runnerCalls = 0;
    const unsupported = new SystemCompletionSound(
      storageDirectory,
      'aix',
      async () => {
        runnerCalls += 1;
      },
    );
    await assert.rejects(unsupported.play(), /not supported on aix/);
    await assert.rejects(access(storageDirectory));

    const controller = new AbortController();
    controller.abort();
    const aborted = new SystemCompletionSound(
      storageDirectory,
      'darwin',
      async () => {
        runnerCalls += 1;
      },
    );
    await assert.rejects(aborted.play(controller.signal), {
      name: 'AbortError',
    });
    await assert.rejects(access(storageDirectory));
    assert.equal(runnerCalls, 0);
  });

  it('passes the same abort signal to its playback runner', async () => {
    const storageDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'timer-stopwatch-sound-'),
    );
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const sound = new SystemCompletionSound(
      storageDirectory,
      'darwin',
      async (_command, signal) => {
        receivedSignal = signal;
      },
    );
    try {
      await sound.play(controller.signal);
      assert.equal(receivedSignal, controller.signal);
    } finally {
      await rm(storageDirectory, { recursive: true, force: true });
    }
  });

  it('runs a fixed executable with the requested environment', async () => {
    await runPlaybackCommand({
      executable: process.execPath,
      arguments: [
        '-e',
        "process.exit(process.env.TIMER_SOUND_RUNNER_TEST === 'ok' ? 0 : 1)",
      ],
      environment: { TIMER_SOUND_RUNNER_TEST: 'ok' },
    });
  });

  it('rejects a player that exits unsuccessfully or does not exist', async () => {
    await assert.rejects(
      runPlaybackCommand({
        executable: process.execPath,
        arguments: ['-e', 'process.exit(7)'],
      }),
    );
    await assert.rejects(
      runPlaybackCommand({
        executable: path.join(
          os.tmpdir(),
          'timer-stopwatch-player-does-not-exist',
        ),
        arguments: [],
      }),
    );
  });

  it('applies a command-specific playback timeout', async () => {
    await assert.rejects(
      playFirstAvailable(
        [
          {
            executable: process.execPath,
            arguments: ['-e', 'setInterval(() => undefined, 1_000)'],
            timeoutMs: 25,
          },
        ],
        runPlaybackCommand,
      ),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /node timed out after 0\.025 seconds\./u);
        assert.equal(error.errors.length, 1);
        return true;
      },
    );
  });

  it('terminates an active playback process when aborted', async () => {
    const controller = new AbortController();
    const playback = runPlaybackCommand(
      {
        executable: process.execPath,
        arguments: ['-e', 'setInterval(() => undefined, 1_000)'],
      },
      controller.signal,
    );
    controller.abort();

    await assert.rejects(playback, { name: 'AbortError' });
  });

  it(
    'resolves the trusted Windows PowerShell executable on Windows',
    { skip: process.platform !== 'win32' },
    async () => {
      const [command] = playbackCommands(
        'win32',
        'C:\\timer-test.wav',
      );
      assert.ok(command !== undefined);
      await access(command.executable);
    },
  );
});
