import assert from 'node:assert/strict';
import test from 'node:test';
import { goalBudget } from '../lib/game/goal-budget.ts';

const city=[{id:'workshop',type:'foundry'},{id:'upgrading-workshop',type:'foundry'},{id:'mine',type:'mine'}];
const input={cost:{ore:500,parts:180,credits:800},resources:{ore:200,parts:30,credits:900},buildings:city,jobs:[]};

test('development budget uses available stock and exact next action costs, without spending',()=>{
  const result=goalBudget(input);
  assert.deepEqual(result.missing,{ore:300,parts:150});
  assert.equal(result.partsToProduce,150);
  assert.equal(input.resources.parts,30);
  assert.deepEqual(goalBudget({...input,resources:{ore:500,parts:180,credits:800}}).missing,{});
});

test('paid cycles across owned foundries reduce new production need but do not become current stock',()=>{
  const result=goalBudget({...input,jobs:[{building_id:'workshop',parts_reward:'80'},{building_id:'upgrading-workshop',parts_reward:90},{building_id:'foreign',parts_reward:5000},{building_id:'mine',parts_reward:5000}]});
  assert.equal(result.queuedParts,170);
  assert.equal(result.partsToProduce,0);
  assert.equal(result.missing.parts,150);
  assert.equal(goalBudget({...input,jobs:[{building_id:'workshop',parts_reward:70}]}).partsToProduce,80);
});

test('one-off development costs detect warehouse and market reserve constraints, not credit caps',()=>{
  const result=goalBudget({...input,caps:{ore:450,parts:180,credits:10},escrow:{parts:40}});
  assert.deepEqual(result.capacityMissing,{ore:50,parts:40});
  assert.deepEqual(goalBudget({...input,caps:{ore:450,parts:180},escrow:{parts:40},partialDelivery:true}).capacityMissing,{});
  assert.deepEqual(goalBudget({...input,resources:{ore:600,parts:200,credits:900},caps:{ore:450,parts:150}}).capacityMissing,{});
});

test('partial supply goals recognise any affordable shipment, not only a full stage or parts',()=>{
  assert.equal(goalBudget({...input,resources:{ore:1,parts:0,credits:0},partialDelivery:true}).deliverable,true);
  assert.equal(goalBudget({...input,resources:{ore:0,parts:0,credits:0},partialDelivery:true}).deliverable,false);
  assert.equal(goalBudget({...input,cost:{ore:0,parts:0},resources:{ore:100,parts:100}}).deliverable,false);
});

test('incomplete numeric fields cannot invent resources or prepaid output',()=>{
  const result=goalBudget({...input,resources:{ore:Infinity,parts:-100,credits:'invalid'},jobs:[{building_id:'workshop',parts_reward:NaN},{building_id:'workshop',parts_reward:-40}]});
  assert.deepEqual(result.missing,input.cost);
  assert.equal(result.queuedParts,0);
});

test('storage blockers separate raw warehouse capacity from the space reserved by sales',()=>{
  const result=goalBudget({...input,caps:{ore:'450',parts:200},escrow:{parts:'40'}});
  assert.deepEqual(result.storageLimits,[
    {resource:'ore',capacity:450,reserved:0,usableCapacity:450,required:500,shortfall:50},
    {resource:'parts',capacity:200,reserved:40,usableCapacity:160,required:180,shortfall:20},
  ]);
  assert.deepEqual(result.capacityMissing,{ore:50,parts:20});
  assert.deepEqual(result.missing,{ore:300,parts:150});
  const allReserved=goalBudget({...input,caps:{parts:100},escrow:{parts:140}});
  assert.deepEqual(allReserved.storageLimits,[
    {resource:'parts',capacity:100,reserved:140,usableCapacity:0,required:180,shortfall:180},
  ]);
});

test('exact fit and existing sufficient stock do not produce a storage blocker',()=>{
  const exact=goalBudget({...input,caps:{ore:550,parts:200},escrow:{ore:50,parts:20}});
  assert.deepEqual(exact.capacityMissing,{});
  assert.deepEqual(exact.storageLimits,[]);
  const preserved=goalBudget({...input,resources:{ore:500,parts:200,credits:900},caps:{ore:100,parts:0},escrow:{ore:90,parts:50}});
  assert.deepEqual(preserved.capacityMissing,{});
  assert.deepEqual(preserved.storageLimits,[]);
  assert.deepEqual(preserved.missing,{});
});

test('partial shipments and uncapped resources never request one-off storage expansion',()=>{
  const partial=goalBudget({...input,caps:{ore:0,parts:0},partialDelivery:true});
  assert.deepEqual(partial.capacityMissing,{});
  assert.deepEqual(partial.storageLimits,[]);
  assert.deepEqual(partial.missing,{ore:300,parts:150});
  const scienceCredits=goalBudget({cost:{science:800,credits:900},resources:{science:10,credits:20},caps:{science:0,credits:0},escrow:{science:50,credits:100}});
  assert.deepEqual(scienceCredits.capacityMissing,{});
  assert.deepEqual(scienceCredits.storageLimits,[]);
  assert.deepEqual(scienceCredits.missing,{credits:880,science:790});
});

test('unknown or invalid capacities cannot invent blocked accumulation',()=>{
  const invalid=[undefined,null,NaN,Infinity,-Infinity,-1,'','  ','not a number','-1','Infinity',true,false,{},[]];
  for(const cap of invalid) {
    const result=goalBudget({...input,caps:{ore:cap},escrow:{ore:0}});
    assert.deepEqual(result.capacityMissing,{},`capacity ${String(cap)}`);
    assert.deepEqual(result.storageLimits,[],`capacity ${String(cap)}`);
    assert.deepEqual(result.missing,{ore:300,parts:150});
  }
  assert.deepEqual(goalBudget(input).storageLimits,[]);
});

test('unknown or invalid explicit reserves do not fabricate usable capacity',()=>{
  const invalid=[null,NaN,Infinity,-Infinity,-1,'','  ','not a number','-1','Infinity',true,false,{},[]];
  for(const reserve of invalid) {
    const result=goalBudget({...input,caps:{ore:100},escrow:{ore:reserve}});
    assert.deepEqual(result.capacityMissing,{},`reserve ${String(reserve)}`);
    assert.deepEqual(result.storageLimits,[],`reserve ${String(reserve)}`);
  }
  assert.deepEqual(goalBudget({...input,caps:{ore:' 400 '},escrow:{ore:' 0 '}}).storageLimits,[
    {resource:'ore',capacity:400,reserved:0,usableCapacity:400,required:500,shortfall:100},
  ]);
  assert.deepEqual(goalBudget({...input,caps:{ore:0}}).storageLimits,[
    {resource:'ore',capacity:0,reserved:0,usableCapacity:0,required:500,shortfall:500},
  ]);
});

test('storage guidance reads frozen snapshots without changing stock, reserve or paid queues',()=>{
  const frozen=Object.freeze({
    cost:Object.freeze({ore:500,parts:180}),resources:Object.freeze({ore:200,parts:30}),
    caps:Object.freeze({ore:450,parts:200}),escrow:Object.freeze({parts:40}),
    buildings:Object.freeze([Object.freeze({id:'f',type:'foundry'})]),
    jobs:Object.freeze([Object.freeze({building_id:'f',parts_reward:170})]),
  });
  const before=structuredClone(frozen);
  const result=goalBudget(frozen);
  assert.deepEqual(result.capacityMissing,{ore:50,parts:20});
  assert.equal(result.storageLimits.length,2);
  assert.equal(result.partsToProduce,0);
  assert.equal(result.queuedParts,170);
  assert.deepEqual(frozen,before);
});
