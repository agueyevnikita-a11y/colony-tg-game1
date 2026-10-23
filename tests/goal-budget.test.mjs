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
