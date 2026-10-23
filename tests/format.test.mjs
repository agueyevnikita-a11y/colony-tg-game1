import assert from 'node:assert/strict';
import test from 'node:test';
import { durationText } from '../lib/game/format.ts';

test('displayed durations round upward across seconds, minutes, hours and days', () => {
  const cases = [
    [0, '0 сек.'], [0.01, '1 сек.'], [1.1, '2 сек.'],
    [59, '59 сек.'], [59.1, '60 сек.'], [60, '1 мин.'], [60.01, '2 мин.'],
    [3599, '1 ч.'], [3600, '1 ч.'], [3600.01, '1 ч. 1 мин.'],
    [7199, '2 ч.'], [7200, '2 ч.'], [86399, '1 д.'], [86400, '1 д.'],
    [86400.01, '1 д. 1 мин.'], [90000, '1 д. 1 ч.'], [90100, '1 д. 1 ч. 2 мин.'],
  ];
  for (const [seconds, expected] of cases) assert.equal(durationText(seconds), expected, `${seconds} seconds`);
});

test('invalid or elapsed waits never produce NaN, Infinity or negative labels', () => {
  for (const seconds of [-1, -0.5, -Infinity, NaN, Infinity, undefined, null, '60']) {
    assert.equal(durationText(seconds), '0 сек.');
  }
});

test('minute and hour fields stay in range throughout multi-day waits', () => {
  for (let seconds = 60; seconds < 4 * 86400; seconds += 7) {
    const label = durationText(seconds);
    const minutes = Number(label.match(/(\d+) мин\./)?.[1] ?? 0);
    const hours = Number(label.match(/(\d+) ч\./)?.[1] ?? 0);
    assert.ok(minutes < 60 && hours < 24, label);
    const days = Number(label.match(/(\d+) д\./)?.[1] ?? 0);
    const displayedSeconds = (days * 1440 + hours * 60 + minutes) * 60;
    assert.ok(displayedSeconds >= seconds && displayedSeconds - seconds < 60, `${seconds}: ${label}`);
  }
});
