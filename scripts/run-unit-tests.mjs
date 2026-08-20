import { spawn } from 'node:child_process';
import console from 'node:console';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const testsRoot = path.join(repositoryRoot, 'tests');
const integrationRoot = path.join(testsRoot, 'integration');

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });

  const testFiles = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entryPath !== integrationRoot) {
        testFiles.push(...await collectTestFiles(entryPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      testFiles.push(entryPath);
    }
  }

  return testFiles;
}

const testFiles = await collectTestFiles(testsRoot);
if (testFiles.length === 0) {
  console.error('No TypeScript unit test files found.');
  process.exitCode = 1;
} else {
  const coverageArguments = process.argv.includes('--coverage')
    ? [
        '--experimental-test-coverage',
        '--test-coverage-exclude=tests/**',
        '--test-coverage-lines=97',
        '--test-coverage-branches=89',
        '--test-coverage-functions=97',
      ]
    : [];
  const child = spawn(process.execPath, [
    ...coverageArguments,
    '--import',
    'tsx',
    '--test',
    ...testFiles,
  ], {
    cwd: repositoryRoot,
    shell: false,
    stdio: 'inherit',
  });
  const signalHandlers = new Map();

  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    const handler = () => {
      child.kill(signal);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
  };

  child.once('error', (error) => {
    removeSignalHandlers();
    console.error(error);
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    removeSignalHandlers();
    if (signal !== null) {
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code ?? 1;
    }
  });
}
