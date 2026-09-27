import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { REQUIRED_SCHEMA, schemaIsReady } = await import('../lib/server/readiness.ts');
const columns = Object.entries(REQUIRED_SCHEMA).flatMap(([table_name, names]) => names.map((column_name) => ({ table_name, column_name })));

test('readiness distinguishes current, empty and partially migrated database schemas', () => {
  assert.equal(schemaIsReady(columns), true);
  assert.equal(schemaIsReady([]), false);
  assert.equal(schemaIsReady(columns.filter((column) => column.column_name !== 'passive_carry')), false);
  assert.equal(schemaIsReady(columns.filter((column) => column.table_name !== 'notification_jobs')), false);
  assert.equal(schemaIsReady([...columns, { table_name: 'custom', column_name: 'extra' }]), true);
});
