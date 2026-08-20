import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodePersistedState } from '../src/core/persistence.js';

const NOW = 1_000_000;

describe('persistence', () => {
  it('loads a running countdown', () => {
    const raw = {
      version: 2,
      session: {
        mode: 'countdown',
        status: 'running',
        startedAt: 1_000,
        accumulatedMs: 5_000,
        durationMs: 60_000,
      },
    };
    const decoded = decodePersistedState(raw, NOW);
    assert.deepEqual(decoded.state, raw);
    assert.equal(decoded.shouldPersist, false);
  });

  it('loads a paused stopwatch without a duration', () => {
    const decoded = decodePersistedState(
      {
        version: 2,
        session: {
          mode: 'stopwatch',
          status: 'paused',
          startedAt: 1_000,
          accumulatedMs: 65_000,
        },
      },
      NOW,
    );
    assert.equal(decoded.state.session?.mode, 'stopwatch');
    assert.equal(decoded.state.session?.accumulatedMs, 65_000);
    assert.equal(decoded.shouldPersist, false);
  });

  it('normalizes extra fields and requests persistence', () => {
    const decoded = decodePersistedState(
      {
        version: 2,
        obsolete: true,
        session: {
          mode: 'stopwatch',
          status: 'running',
          startedAt: 1_000,
          accumulatedMs: 0,
          label: 'obsolete',
        },
      },
      NOW,
    );
    assert.deepEqual(decoded.state, {
      version: 2,
      session: {
        mode: 'stopwatch',
        status: 'running',
        startedAt: 1_000,
        accumulatedMs: 0,
      },
    });
    assert.equal(decoded.shouldPersist, true);
  });

  it('recognizes the exact empty state without rewriting it', () => {
    assert.deepEqual(
      decodePersistedState({ version: 2, session: null }, NOW),
      {
        state: { version: 2, session: null },
        shouldPersist: false,
      },
    );
    assert.deepEqual(
      decodePersistedState(
        { version: 2, session: null, obsolete: true },
        NOW,
      ),
      {
        state: { version: 2, session: null },
        shouldPersist: true,
      },
    );
  });

  it('normalizes cyclic and BigInt-bearing values without throwing', () => {
    const session = {
      mode: 'stopwatch',
      status: 'running',
      startedAt: 1_000,
      accumulatedMs: 0,
    };
    const cyclic: Record<string, unknown> = { version: 2, session };
    cyclic.self = cyclic;

    assert.deepEqual(decodePersistedState(cyclic, NOW), {
      state: { version: 2, session },
      shouldPersist: true,
    });
    assert.deepEqual(
      decodePersistedState({ version: 2, session, extra: 1n }, NOW),
      {
        state: { version: 2, session },
        shouldPersist: true,
      },
    );
  });

  it('rejects impossible and malformed sessions', () => {
    const invalid = [
      [],
      true,
      { mode: 'countdown', status: 'running', startedAt: 0, accumulatedMs: 0 },
      {
        mode: 'stopwatch',
        status: 'running',
        startedAt: 0,
        accumulatedMs: 0,
        durationMs: 1_000,
      },
      {
        mode: 'countdown',
        status: 'running',
        startedAt: -1,
        accumulatedMs: 0,
        durationMs: 1_000,
      },
      {
        mode: 'countdown',
        status: 'paused',
        startedAt: 0,
        accumulatedMs: 1_000,
        durationMs: 1_000,
      },
      {
        mode: 'countdown',
        status: 'running',
        startedAt: Number.NaN,
        accumulatedMs: 0,
        durationMs: 1_000,
      },
      {
        mode: 'countdown',
        status: 'running',
        startedAt: 0,
        accumulatedMs: Infinity,
        durationMs: 1_000,
      },
      {
        mode: 'countdown',
        status: 'running',
        startedAt: 0,
        accumulatedMs: 0,
        durationMs: 0,
      },
      {
        mode: 'countdown',
        status: 'running',
        startedAt: 0,
        accumulatedMs: 0,
        durationMs: 999,
      },
      {
        mode: 'countdown',
        status: 'running',
        startedAt: 0,
        accumulatedMs: 0,
        durationMs: 1_500,
      },
      {
        mode: 'countdown',
        status: 'running',
        startedAt: 0,
        accumulatedMs: 0,
        durationMs: 30 * 24 * 60 * 60 * 1_000 + 1,
      },
      {
        mode: 'timer',
        status: 'running',
        startedAt: 0,
        accumulatedMs: 0,
        durationMs: 1_000,
      },
      {
        mode: 'stopwatch',
        status: 'stopped',
        startedAt: 0,
        accumulatedMs: 0,
      },
    ];
    for (const session of invalid) {
      const decoded = decodePersistedState({ version: 2, session }, NOW);
      assert.deepEqual(decoded.state, { version: 2, session: null });
      assert.equal(decoded.shouldPersist, true);
    }
  });

  it('keeps an expired running countdown for startup reconciliation', () => {
    const raw = {
      version: 2,
      session: {
        mode: 'countdown',
        status: 'running',
        startedAt: 0,
        accumulatedMs: 1_000,
        durationMs: 1_000,
      },
    };
    assert.deepEqual(decodePersistedState(raw, NOW), {
      state: raw,
      shouldPersist: false,
    });
  });

  it('returns an empty state for legacy or unknown data', () => {
    for (const raw of [undefined, 'corrupt', { version: 1, items: [] }]) {
      const decoded = decodePersistedState(raw, NOW);
      assert.deepEqual(decoded.state, { version: 2, session: null });
      assert.equal(decoded.shouldPersist, raw !== undefined);
    }
  });

  it('clamps a running countdown started in the future to now', () => {
    const raw = {
      version: 2,
      session: {
        mode: 'countdown',
        status: 'running',
        startedAt: NOW + 60_000,
        accumulatedMs: 5_000,
        durationMs: 600_000,
      },
    };
    const decoded = decodePersistedState(raw, NOW);
    assert.deepEqual(decoded.state, {
      version: 2,
      session: {
        mode: 'countdown',
        status: 'running',
        startedAt: NOW,
        accumulatedMs: 5_000,
        durationMs: 600_000,
      },
    });
    assert.equal(decoded.shouldPersist, true);
  });

  it('clamps a paused stopwatch started in the future while preserving accumulatedMs', () => {
    const raw = {
      version: 2,
      session: {
        mode: 'stopwatch',
        status: 'paused',
        startedAt: NOW + 120_000,
        accumulatedMs: 42_000,
      },
    };
    const decoded = decodePersistedState(raw, NOW);
    assert.deepEqual(decoded.state, {
      version: 2,
      session: {
        mode: 'stopwatch',
        status: 'paused',
        startedAt: NOW,
        accumulatedMs: 42_000,
      },
    });
    assert.equal(decoded.shouldPersist, true);
  });

  it('leaves a session started exactly at now unchanged', () => {
    const raw = {
      version: 2,
      session: {
        mode: 'stopwatch',
        status: 'running',
        startedAt: NOW,
        accumulatedMs: 0,
      },
    };
    const decoded = decodePersistedState(raw, NOW);
    assert.deepEqual(decoded.state, raw);
    assert.equal(decoded.shouldPersist, false);
  });
});
