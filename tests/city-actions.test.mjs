import assert from 'node:assert/strict';
import test from 'node:test';
import { cityActionItems } from '../lib/game/city-actions.ts';

const now = Date.parse('2026-10-22T12:00:00Z');
const before = '2026-10-22T11:59:00Z', after = '2026-10-22T12:01:00Z';
const item = (game, key) => cityActionItems(game, now).find(action => action.key === key);

test('new and full cities keep navigation honest without promising unavailable production or rewards', () => {
  const game = { gridSize: 6, buildings: [{ id:'hq', type:'hq', status:'active' }], colonyEvents:{enabled:true,unlocked:false,active:{id:'hidden'}} };
  const original = structuredClone(game);
  assert.deepEqual(cityActionItems(game, now).map(action => action.key), ['build','production','research','events','decor','contracts','share']);
  assert.equal(item(game,'build').hint, 'Свободно клеток: 35');
  assert.equal(item(game,'production').hint, 'Нужен литейный цех');
  assert.equal(item(game,'research').hint, 'Нужен научный центр');
  assert.equal(item(game,'contracts').hint, 'Нужен торговый узел');
  assert.equal(item(game,'events').attention, false);
  assert.ok(cityActionItems(game,now).every(action => !action.badge));
  assert.equal(item({...game,decor:Array(35).fill({type:'road'})},'build').hint, 'Карта заполнена');
  assert.deepEqual(game, original);
});

test('elapsed jobs request verification and explain storage reserved by market escrow', () => {
  const game = { buildings:[{id:'f',type:'foundry',status:'active'}],state:{parts:10},caps:{parts:100},escrow:{parts:70},
    activeJobs:[{building_id:'f',completes_at:before,parts_reward:35},{building_id:'f',completes_at:after,parts_reward:35},
      {building_id:'missing',completes_at:before,parts_reward:999}] };
  assert.equal(item(game,'production').hint,'Не хватает места');
  assert.equal(item(game,'production').badge,1);
  assert.equal(item({...game,escrow:{parts:0}},'production').hint,'Проверить выпуск');
  assert.equal(item({...game,activeJobs:[game.activeJobs[1]]},'production').attention,false);
  assert.equal(item({...game,activeJobs:[game.activeJobs[1]]},'production').hint,'Циклов в очереди: 1');
});

test('research and event attention follow actual state and never invent an unlock', () => {
  assert.equal(item({research:{active:{completes_at:after}}},'research').attention,false);
  assert.equal(item({research:{active:{completes_at:before}}},'research').hint,'Проверить результат');
  assert.equal(item({research:{active:{completes_at:'invalid'}}},'research').badge,undefined);
  assert.equal(item({research:{labStatus:'upgrading'}},'research').hint,'Центр улучшается');
  for(const state of [{enabled:false,unlocked:true,active:{}},{enabled:true,unlocked:false,active:{}},{enabled:true,unlocked:true,active:null}]) {
    assert.equal(item({colonyEvents:state},'events').attention,false);
  }
  assert.equal(item({colonyEvents:{enabled:true,unlocked:true,active:{id:'event'}}},'events').badge,1);
});

test('contract counts include only valid current orders affordable from actual available resources', () => {
  const contracts = [
    {resource:'ore',amount:100,expires_at:after},{resource:'parts',amount:'20',expires_at:after},
    {resource:'ore',amount:200,expires_at:after},{resource:'ore',amount:1,expires_at:before},
    {resource:'ore',amount:1,expires_at:after,completed_at:before},{resource:'ore',amount:0,expires_at:after},
    {resource:'ore',amount:NaN,expires_at:after},{resource:'crystals',amount:1,expires_at:after},
    {resource:'parts',amount:1,expires_at:'invalid'},
  ];
  const game={contracts,contractsInfo:{enabled:true},state:{ore:100,parts:20,crystals:100}};
  assert.equal(item(game,'contracts').badge,2);
  assert.equal(item(game,'contracts').attention,true);
  assert.equal(item({...game,contractsInfo:{enabled:false}},'contracts').badge,undefined);
  assert.equal(item({...game,state:{ore:Infinity,parts:-1}},'contracts').attention,false);
});

test('supply attention points to earned unclaimed project stages without requiring an active trade hub', () => {
  const projects = [{ ready: true, completed: false, started: true }, { ready: false, completed: false, started: true },
    { ready: true, completed: true, started: true }];
  const game = { supplyProjects: { available: true, unlocked: false, projects } };
  const original = structuredClone(game);
  assert.equal(item(game, 'contracts').badge, 1);
  assert.equal(item(game, 'contracts').hint, 'Награды проектов: 1');
  assert.equal(item(game, 'contracts').attention, true);
  assert.equal(item(game, 'contracts').action, 'supplies');
  assert.equal(item({ supplyProjects: { ...game.supplyProjects, available: false } }, 'contracts').badge, undefined);
  const planning = { supplyProjects: { available: true, unlocked: true, projects: [{ ready: false, completed: false, started: false }] } };
  assert.equal(item(planning, 'contracts').hint, 'Выбрать проект');
  assert.equal(item(planning, 'contracts').action, 'supplies');
  const trade = { ...planning, contractsInfo: { enabled: true }, state: { ore: 10 }, contracts: [{ resource: 'ore', amount: 1, expires_at: after }] };
  assert.equal(item(trade, 'contracts').hint, 'Можно выполнить: 1');
  assert.equal(item(trade, 'contracts').action, 'contracts');
  assert.deepEqual(game, original);
});
