import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const owner = '00000000-0000-4000-8000-000000000001';
const officer = '00000000-0000-4000-8000-000000000002';
const member = '00000000-0000-4000-8000-0000000000ab';
const outsider = '00000000-0000-4000-8000-000000000004';
const guild = '00000000-0000-4000-8000-000000000010';
const otherGuild = '00000000-0000-4000-8000-000000000020';
const state = { db: null, begins: 0, failOwnershipWrite: false };

function reset() {
  state.begins = 0;
  state.failOwnershipWrite = false;
  state.db = {
    members: [
      { alliance_id: guild, user_id: owner, role: 'owner' },
      { alliance_id: guild, user_id: officer, role: 'officer' },
      { alliance_id: guild, user_id: member, role: 'member' },
      { alliance_id: otherGuild, user_id: outsider, role: 'owner' },
    ],
    owners: { [guild]: owner, [otherGuild]: outsider },
    left: [], events: [],
  };
}

// Execute the real management functions and routes on a transactional state adapter.
// It models membership scope, role writes and rollback, rather than mocking the policy.
async function sql(strings, ...values) {
  const query = strings.join('?').replace(/\s+/g, ' ').trim();
  if (query.startsWith('SELECT am.*, a.name AS alliance_name')) {
    const found = state.db.members.find(row => row.user_id === values[0]);
    return found ? [{ ...found, owner_user_id: state.db.owners[found.alliance_id] }] : [];
  }
  if (query.startsWith('SELECT am.* FROM alliance_members am')) {
    return state.db.members.filter(row => row.alliance_id === values[0] && row.user_id === values[1]).map(row => ({ ...row }));
  }
  if (query.startsWith('SELECT count(*)::int AS count FROM alliance_members')) {
    return [{ count: state.db.members.filter(row => row.alliance_id === values[0] && row.role === 'officer').length }];
  }
  if (query.startsWith('UPDATE alliance_members SET role=')) {
    const fixed = query.match(/SET role='(member|owner)'/);
    const role = fixed ? fixed[1] : values[0];
    const allianceId = values[fixed ? 0 : 1], userId = values[fixed ? 1 : 2];
    const row = state.db.members.find(item => item.alliance_id === allianceId && item.user_id === userId);
    if (row) row.role = role;
    return [];
  }
  if (query.startsWith('DELETE FROM alliance_members')) {
    state.db.members = state.db.members.filter(row => row.alliance_id !== values[0] || row.user_id !== values[1]);
    return [];
  }
  if (query.startsWith('UPDATE users SET alliance_left_at=now()')) { state.db.left.push(values[0]); return []; }
  if (query.startsWith('UPDATE alliances SET owner_user_id=')) {
    if (state.failOwnershipWrite) throw new Error('Synthetic ownership write failure');
    state.db.owners[values[1]] = values[0]; return [];
  }
  throw new Error(`Unexpected query in alliance identity test: ${query}`);
}
sql.begin = async callback => {
  state.begins++;
  const snapshot = structuredClone(state.db);
  try { return await callback(sql); } catch (error) { state.db = snapshot; throw error; }
};
globalThis.__colonyAllianceIdentityTest = { state, sql };

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const shared = moduleUrl(`
  const context = globalThis.__colonyAllianceIdentityTest;
  export const sql = context.sql;
  export class NextResponse extends Response { static json(value, init) { return Response.json(value, init); } }
  export async function analyticsEvent(_tx, userId, name, payload) { context.state.db.events.push({ userId, name, payload }); }
  export function getInitDataFromRequest(request) {
    const userId = request.headers.get('x-test-actor');
    if (!userId) throw new Error('Unauthorized');
    return { user: { id: userId } };
  }
  export async function ensurePlayer(user) { return user.id; }
  export async function reconcilePlayer(userId) { return { userId }; }
`);
async function compile(path, imports = {}) {
  let source = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith('node:') || imports[specifier]) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) throw new Error(`Unsupported test import ${specifier}`);
    imports[specifier] = moduleUrl(bindings.elements.filter(item => !item.isTypeOnly).map(item =>
      `export function ${(item.propertyName ?? item.name).text}() { throw new Error('Unexpected dependency'); }`).join('\n'));
  }
  for (const [from, to] of Object.entries(imports)) source = source.replaceAll(`'${from}'`, `'${to}'`);
  return moduleUrl(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
}
const allianceUrl = await compile('../lib/server/alliance.ts', {
  '@/lib/server/db': shared, '@/lib/server/progression': shared,
  '@/lib/game/alliance': await compile('../lib/game/alliance.ts'),
});
const { setAllianceRole, kickAllianceMember, transferAllianceOwnership } = await import(allianceUrl);
const routes = Object.fromEntries(await Promise.all(['role', 'kick', 'transfer'].map(async kind => [kind,
  (await import(await compile(`../app/api/alliance/manage/${kind}/route.ts`, {
    'next/server': shared, '@/lib/server/telegram-auth': shared, '@/lib/server/game': shared,
    '@/lib/server/alliance': allianceUrl,
  }))).POST,
])));
const roleOf = id => state.db.members.find(row => row.user_id === id)?.role;
const call = (kind, actor, body) => routes[kind](new Request('https://colony.invalid/api/alliance/manage/' + kind, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(actor ? { 'x-test-actor': actor } : {}) }, body: JSON.stringify(body),
}));

test('management rejects numeric Telegram targets and malformed UUIDs before starting a transaction', async () => {
  reset();
  for (const invalid of [undefined, null, 42, '42', {}, [], `${member} `, `${member}\n`, 'not-a-user']) {
    for (const operation of [setAllianceRole, kickAllianceMember, transferAllianceOwnership]) {
      await assert.rejects(operation(owner, invalid, 'officer'), /Некорректный участник/);
    }
  }
  assert.equal(state.begins, 0);
  assert.equal(roleOf(member), 'member');
});

test('owner can address a same-guild member by UUID without Telegram identity in analytics', async () => {
  reset();
  assert.equal(await setAllianceRole(owner, member.toUpperCase(), 'officer'), true);
  assert.equal(roleOf(member), 'officer');
  assert.deepEqual(state.db.events, [{ userId: owner, name: 'alliance_role_changed', payload: { target_user_id: member, role: 'officer' } }]);
  await setAllianceRole(owner, member, 'member');
  assert.equal(roleOf(member), 'member');
});

test('UUID targeting preserves actor permissions, self-protection and guild boundaries', async () => {
  reset();
  const before = structuredClone(state.db);
  await assert.rejects(setAllianceRole(member, officer, 'member'), /Только владелец/);
  await assert.rejects(setAllianceRole(officer, member, 'officer'), /Только владелец/);
  await assert.rejects(setAllianceRole(owner, outsider, 'officer'), /Участник не найден/);
  await assert.rejects(setAllianceRole(owner, owner, 'member'), /владельца/);
  await assert.rejects(kickAllianceMember(owner, owner), /нельзя исключить/);
  await assert.rejects(kickAllianceMember(officer, officer), /нельзя исключить/);
  await assert.rejects(kickAllianceMember(member, officer), /Недостаточно прав/);
  await assert.rejects(kickAllianceMember(officer, owner), /нельзя исключить/);
  await assert.rejects(transferAllianceOwnership(officer, member), /Только владелец/);
  await assert.rejects(transferAllianceOwnership(owner, outsider), /другого участника/);
  await assert.rejects(transferAllianceOwnership(owner, owner), /другого участника/);
  assert.deepEqual(state.db, before);
});

test('officer limit is preserved and an officer can still kick an ordinary UUID-addressed member', async () => {
  reset();
  for (let i = 5; i <= 8; i++) state.db.members.push({ alliance_id: guild, user_id: `00000000-0000-4000-8000-00000000000${i}`, role: 'officer' });
  await assert.rejects(setAllianceRole(owner, member, 'officer'), /Максимум 5 офицеров/);
  assert.equal(roleOf(member), 'member');
  await setAllianceRole(owner, officer, 'officer');
  await assert.rejects(kickAllianceMember(officer, '00000000-0000-4000-8000-000000000005'), /только обычных/);
  await kickAllianceMember(officer, member);
  assert.equal(roleOf(member), undefined);
  assert.deepEqual(state.db.left, [member]);
  assert.equal(state.db.events.at(-1).payload.target_user_id, member);
});

test('ownership transfer remains atomic and updates the two roles and guild owner', async () => {
  reset();
  const before = structuredClone(state.db);
  state.failOwnershipWrite = true;
  await assert.rejects(transferAllianceOwnership(owner, member), /Synthetic/);
  assert.deepEqual(state.db, before);
  state.failOwnershipWrite = false;
  await transferAllianceOwnership(owner, member);
  assert.equal(roleOf(owner), 'member');
  assert.equal(roleOf(member), 'owner');
  assert.equal(state.db.owners[guild], member);
  assert.deepEqual(state.db.events.at(-1).payload, { target_user_id: member });
});

test('HTTP management accepts userId targets while auth still determines the actor', async () => {
  reset();
  assert.equal((await call('role', owner, { telegramId: 42, role: 'officer' })).status, 400);
  assert.equal((await call('role', null, { userId: member, role: 'officer' })).status, 400);
  assert.equal((await call('role', member, { userId: officer, role: 'member', actorId: owner })).status, 400);
  const success = await call('role', owner, { userId: member, role: 'officer' });
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { ok: true, userId: owner });
  assert.equal(roleOf(member), 'officer');
  assert.equal((await call('kick', owner, { userId: member })).status, 200);
  assert.equal(roleOf(member), undefined);
  assert.equal((await call('transfer', owner, { userId: officer })).status, 200);
  assert.equal(state.db.owners[guild], officer);
});
