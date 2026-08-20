import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorReporter } from '../src/ui/errorReporter.js';

describe('error reporter', () => {
  it('throttles consecutive storage errors', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.report('storage', new Error('disk unavailable'));
    reporter.report('storage', new Error('still unavailable'));

    assert.deepEqual(messages, [
      'Timer & Stopwatch could not update its saved state. disk unavailable',
    ]);
  });

  it('resets the storage throttle after a successful save', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.report('storage', new Error('first outage'));
    reporter.recordStorageSuccess();
    reporter.report('storage', new Error('second outage'));
    reporter.report('storage', new Error('second outage continues'));

    assert.deepEqual(messages, [
      'Timer & Stopwatch could not update its saved state. first outage',
      'Timer & Stopwatch could not update its saved state. second outage',
    ]);
  });

  it('never suppresses scheduler errors', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.report('scheduler', new Error('first failure'));
    reporter.report('scheduler', new Error('second failure'));

    assert.deepEqual(messages, [
      'Timer & Stopwatch stopped updating unexpectedly. first failure',
      'Timer & Stopwatch stopped updating unexpectedly. second failure',
    ]);
  });

  it('never suppresses notification errors', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.report('notification', new Error('first failure'));
    reporter.report('notification', new Error('second failure'));

    assert.deepEqual(messages, [
      'Timer & Stopwatch could not show its completion notification. first failure',
      'Timer & Stopwatch could not show its completion notification. second failure',
    ]);
  });

  it('throttles sound errors until playback succeeds', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.report('sound', new Error('first player failure'));
    reporter.report('sound', new Error('same outage'));
    reporter.recordSoundSuccess();
    reporter.report('sound', new Error('later player failure'));

    assert.deepEqual(messages, [
      'Timer & Stopwatch could not play its completion sound. first player failure',
      'Timer & Stopwatch could not play its completion sound. later player failure',
    ]);
  });

  it('always reports user-initiated sound test failures', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.report('sound', new Error('automatic player failure'));
    reporter.reportUserInitiatedSoundError(new Error('first test failure'));
    reporter.reportUserInitiatedSoundError(new Error('second test failure'));
    reporter.report('sound', new Error('later automatic failure'));

    assert.deepEqual(messages, [
      'Timer & Stopwatch could not play its completion sound. automatic player failure',
      'Timer & Stopwatch could not play its completion sound. first test failure',
      'Timer & Stopwatch could not play its completion sound. second test failure',
    ]);
  });

  it('reports preference failures with an accurate message', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.reportCompletionPreferenceError(
      new Error('settings are read-only'),
    );

    assert.deepEqual(messages, [
      'Timer & Stopwatch could not save its notification preference. settings are read-only',
    ]);
  });

  it('uses the current message prefix for each source', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.report('storage', undefined);
    reporter.report('scheduler', undefined);
    reporter.report('sound', undefined);
    reporter.report('notification', undefined);

    assert.deepEqual(messages, [
      'Timer & Stopwatch could not update its saved state.',
      'Timer & Stopwatch stopped updating unexpectedly.',
      'Timer & Stopwatch could not play its completion sound.',
      'Timer & Stopwatch could not show its completion notification.',
    ]);
  });

  it('includes Error messages and omits detail for non-Error values', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.report('scheduler', new Error('scheduler detail'));
    reporter.report('notification', 'notification detail');

    assert.deepEqual(messages, [
      'Timer & Stopwatch stopped updating unexpectedly. scheduler detail',
      'Timer & Stopwatch could not show its completion notification.',
    ]);
  });

  it('allows storage success to be recorded before any failure', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.recordStorageSuccess();
    reporter.report('storage', new Error('later failure'));

    assert.deepEqual(messages, [
      'Timer & Stopwatch could not update its saved state. later failure',
    ]);
  });

  it('allows sound success to be recorded before any failure', () => {
    const messages: string[] = [];
    const reporter = new ErrorReporter((message) => messages.push(message));

    reporter.recordSoundSuccess();
    reporter.report('sound', new Error('later failure'));

    assert.deepEqual(messages, [
      'Timer & Stopwatch could not play its completion sound. later failure',
    ]);
  });
});
