/** Countdown durations are stored and compared at whole-second precision. */
export const MS_PER_SECOND = 1_000;
export const MIN_DURATION_MS = MS_PER_SECOND;
export const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;

const UNIT_MULTIPLIERS: Readonly<Record<string, number>> = {
  d: 24 * 60 * 60 * 1_000,
  h: 60 * 60 * 1_000,
  m: 60 * 1_000,
  s: 1_000,
};

function validDuration(value: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  // Decimal unit input can land a few billionths of a millisecond away
  // from its mathematical value because JavaScript numbers are binary
  // floating point. Normalize only that machine-sized error before
  // enforcing the public whole-second contract.
  const rounded = Math.round(value);
  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(value)) * 16;
  if (
    Math.abs(value - rounded) > tolerance ||
    rounded % MS_PER_SECOND !== 0
  ) {
    return undefined;
  }

  return rounded >= MIN_DURATION_MS && rounded <= MAX_DURATION_MS
    ? rounded
    : undefined;
}

function parseClockDuration(value: string): number | undefined {
  const parts = value.split(':');
  if (parts.length !== 2 && parts.length !== 3) {
    return undefined;
  }
  if (!parts.every((part) => /^\d+$/.test(part))) {
    return undefined;
  }
  const numbers = parts.map(Number);
  const seconds = numbers.at(-1);
  const minutes = numbers.at(-2);
  const hours = numbers.length === 3 ? numbers[0] : 0;
  if (
    seconds === undefined ||
    minutes === undefined ||
    hours === undefined ||
    seconds > 59 ||
    minutes > 59
  ) {
    return undefined;
  }
  return validDuration(((hours * 60 + minutes) * 60 + seconds) * 1_000);
}

function parseUnitDuration(value: string): number | undefined {
  const matcher = /(\d+(?:\.\d+)?)\s*([dhms])/gy;
  let cursor = 0;
  let total = 0;
  let matched = false;
  while (cursor < value.length) {
    matcher.lastIndex = cursor;
    const match = matcher.exec(value);
    if (match === null) {
      return undefined;
    }
    const amount = Number(match[1]);
    const multiplier = UNIT_MULTIPLIERS[match[2] ?? ''];
    if (!Number.isFinite(amount) || multiplier === undefined) {
      return undefined;
    }
    total += amount * multiplier;
    cursor = matcher.lastIndex;
    while (value[cursor] === ' ') {
      cursor += 1;
    }
    matched = true;
  }
  return matched ? validDuration(total) : undefined;
}

export function parseDuration(input: string): number | undefined {
  const value = input.trim().toLowerCase();
  if (value.length === 0) {
    return undefined;
  }
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    return validDuration(Number(value) * 60_000);
  }
  if (value.includes(':')) {
    return parseClockDuration(value);
  }
  return parseUnitDuration(value);
}
