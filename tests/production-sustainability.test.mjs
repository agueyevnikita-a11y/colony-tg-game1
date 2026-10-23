import assert from 'node:assert/strict';
import test from 'node:test';
import { productionSustainability } from '../lib/game/production-sustainability.ts';

test('production supply exposes the early ore bottleneck without treating stored stock as income', () => {
  const rows = productionSustainability({ cycleCost:{ore:85,energy:40},cycleSeconds:300,resourceRates:{ore:120,energy:100} });
  assert.deepEqual(rows.map(row=>[row.resource,row.requiredPerHour,row.passivePerHour,row.sustainable]),[
    ['ore',1020,120,false],['energy',480,100,false],
  ]);
  assert.equal(rows[0].coverage,120/1020);
  assert.equal(rows[1].coverage,100/480);
  assert.equal(Object.hasOwn(rows[0],'eta'),false);
});

test('mode duration, recipe rounding, zero income and fully covered demand stay distinct', () => {
  const economy=productionSustainability({cycleCost:{ore:60,energy:57},cycleSeconds:840,resourceRates:{ore:0,energy:1000}});
  assert.equal(economy[0].requiredPerHour,60*3600/840);
  assert.equal(economy[0].coverage,0);
  assert.equal(economy[1].requiredPerHour,57*3600/840);
  assert.equal(economy[1].coverage,1);
  assert.equal(economy[1].sustainable,true);
  const exact=productionSustainability({cycleCost:{ore:100,energy:40},cycleSeconds:300,resourceRates:{ore:1200,energy:480}});
  assert.ok(exact.every(row=>row.sustainable&&row.coverage===1));
});

test('unknown, partial and invalid rates or cycle data never become zero income advice', () => {
  const base={cycleCost:{ore:85,energy:40},cycleSeconds:300,resourceRates:{ore:120,energy:100}};
  for(const resourceRates of [undefined,{}, {ore:120},{energy:100},{ore:NaN,energy:100},{ore:120,energy:Infinity},{ore:-1,energy:100},{ore:'120',energy:100}])assert.equal(productionSustainability({...base,resourceRates}),null);
  for(const cycleSeconds of [0,-1,NaN,Infinity])assert.equal(productionSustainability({...base,cycleSeconds}),null);
  for(const ore of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(productionSustainability({...base,cycleCost:{ore,energy:40}}),null);
});
