import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllianceDirectoryRequest } from '../lib/game/alliance-directory.ts';

test('alliance discovery accepts defaults, trimmed literal Unicode queries and the final allowed page', () => {
  assert.deepEqual(parseAllianceDirectoryRequest({}), { query: '', page: 0 });
  const source = { query: '  ЛуНа_%\\ База  ', page: 99 };
  assert.deepEqual(parseAllianceDirectoryRequest(source), { query: 'ЛуНа_%\\ База', page: 99 });
  assert.equal(source.query, '  ЛуНа_%\\ База  ', 'Validation must not change the caller input');
  assert.deepEqual(parseAllianceDirectoryRequest({ query: 'я'.repeat(64) }), { query: 'я'.repeat(64), page: 0 });
});

test('alliance discovery rejects malformed bodies, overlong queries and pages outside its bounded numeric range', () => {
  for (const input of [null, undefined, [], '', 0, false]) assert.throws(() => parseAllianceDirectoryRequest(input));
  for (const query of [null, 4, {}, [], 'x'.repeat(65), ' '.repeat(65), '🚀'.repeat(33)]) {
    assert.throws(() => parseAllianceDirectoryRequest({ query }), /Поиск/);
  }
  for (const page of [null, '', '1', false, {}, [], -1, .1, 100, NaN, Infinity]) {
    assert.throws(() => parseAllianceDirectoryRequest({ page }), /страница/);
  }
});
