import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  parseDuration,
} from '../src/core/parsing.js';

describe('duration parsing', () => {
  it('parses unit, clock, and plain-minute formats', () => {
    assert.equal(parseDuration('1h 30m'), 5_400_000);
    assert.equal(parseDuration('05:30'), 330_000);
    assert.equal(parseDuration('01:02:03'), 3_723_000);
    assert.equal(parseDuration('2.5m'), 150_000);
    assert.equal(parseDuration('15'), 900_000);
  });

  it('accepts the one-second minimum in every applicable format', () => {
    assert.equal(parseDuration('1s'), MIN_DURATION_MS);
    assert.equal(parseDuration('1.000s'), MIN_DURATION_MS);
    assert.equal(parseDuration('00:01'), MIN_DURATION_MS);
    assert.equal(parseDuration('0.016666666666666666m'), MIN_DURATION_MS);
    assert.equal(parseDuration('0.0002777777777777778h'), MIN_DURATION_MS);
    assert.equal(
      parseDuration('0.016666666666666666'),
      MIN_DURATION_MS,
    );
  });

  it('rejects zero and positive durations below one second', () => {
    for (const value of [
      '0',
      '0s',
      '00:00',
      '0.0005s',
      '0.5s',
      '0.999s',
      '0.016m',
      '0.0002h',
    ]) {
      assert.equal(parseDuration(value), undefined, value);
    }
  });

  it('rejects durations that do not resolve to a whole second', () => {
    for (const value of [
      '1.001s',
      '1.5s',
      '1m 0.5s',
      '0.0167m',
      '0.0005h',
      '1.234',
    ]) {
      assert.equal(parseDuration(value), undefined, value);
    }
  });

  it('accepts decimal units when the total resolves to whole seconds', () => {
    assert.equal(parseDuration('2.5m'), 150_000);
    assert.equal(parseDuration('2.05m'), 123_000);
    assert.equal(parseDuration('4.1m'), 246_000);
    assert.equal(parseDuration('1.25m'), 75_000);
    assert.equal(parseDuration('0.25h'), 900_000);
    assert.equal(parseDuration('0.07h'), 252_000);
    assert.equal(parseDuration('1.1h'), 3_960_000);
    assert.equal(parseDuration('0.5'), 30_000);
    assert.equal(parseDuration('1.5s 0.5s'), 2_000);
  });

  it('accepts each representation at the thirty-day boundary', () => {
    for (const value of [
      '30d',
      '720h',
      '43200m',
      '2592000s',
      '720:00:00',
    ]) {
      assert.equal(parseDuration(value), MAX_DURATION_MS, value);
    }
  });

  it('accepts the whole-second step below the maximum', () => {
    assert.equal(
      parseDuration(`${MAX_DURATION_MS / 1_000 - 1}s`),
      MAX_DURATION_MS - 1_000,
    );
  });

  it('rejects fractional and whole-second values beyond the maximum', () => {
    for (const value of [
      '2591999.5s',
      '2592000.001s',
      '2592001s',
      '30d 1s',
      '31d',
      '30.0001d',
      '720.0001h',
      '43200.0001m',
      '720:00:01',
    ]) {
      assert.equal(parseDuration(value), undefined, value);
    }
  });

  it('rejects malformed syntax', () => {
    for (const value of [
      '+1',
      '-1',
      '1e3',
      '.5m',
      '1.',
      '1..5m',
      '1::2',
      '00:60',
      '1:2:3:4',
      '1 hour',
      '1m garbage',
      'garbage 1m',
    ]) {
      assert.equal(parseDuration(value), undefined, value);
    }
  });

  it('normalizes case and surrounding whitespace', () => {
    assert.equal(parseDuration('  1H 30M  '), 5_400_000);
    assert.equal(parseDuration('1m30s'), 90_000);
  });

  it('never throws for deterministic fuzz input', () => {
    let seed = 0x5eed;
    const alphabet = '0123456789dhms:. +-_\tABC';
    for (let index = 0; index < 2_000; index += 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      const length = seed % 30;
      let value = '';
      for (let character = 0; character < length; character += 1) {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        value += alphabet.charAt(seed % alphabet.length);
      }
      const parsed = parseDuration(value);
      if (parsed !== undefined) {
        assert.ok(Number.isInteger(parsed));
        assert.ok(
          parsed >= MIN_DURATION_MS && parsed <= MAX_DURATION_MS,
        );
        assert.equal(parsed % 1_000, 0);
      }
    }
  });
});
