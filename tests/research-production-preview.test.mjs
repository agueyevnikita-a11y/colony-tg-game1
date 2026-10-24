import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import test from 'node:test';

registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('.') && !extname(specifier) && context.parentURL?.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
} });
const { researchProductionPreview } = await import('../lib/game/research-production-preview.ts');
const { quoteFoundry } = await import('../lib/game/foundry.ts');
const { RESEARCH_TREE } = await import('../lib/game/research.ts');
const active = { id:'a',type:'foundry',status:'active',level:1,x:2,y:3 };
const base = { researchKey:'thermal_recovery',catalog:RESEARCH_TREE,completed:['basic_theory'],buildings:[active] };

test('new-cycle output bonus uses integer server quote and does not change costs or time', () => {
  const value=researchProductionPreview(base);
  assert.deepEqual([value.before.parts,value.after.parts],[35,38]);
  assert.deepEqual([value.before.ore,value.before.energy,value.before.seconds],[100,40,300]);
  assert.deepEqual([value.after.ore,value.after.energy,value.after.seconds],[100,40,300]);
  assert.equal(value.done,false);
  assert.deepEqual(value.additionalPrerequisites,[]);
});

test('recipe preview includes missing canonical prerequisite bonuses rather than inventing an immediate unlock', () => {
  const precision=researchProductionPreview({...base,researchKey:'precision_casting'});
  assert.deepEqual(precision.additionalPrerequisites.map(item=>item.key),['thermal_recovery']);
  assert.deepEqual([precision.before.parts,precision.after.parts,precision.after.ore,precision.after.energy,precision.after.seconds],[35,38,70,90,420]);
  const industrial=researchProductionPreview({...base,researchKey:'industrial_casting'});
  assert.deepEqual(industrial.additionalPrerequisites.map(item=>item.key),['thermal_recovery','extraction_ai']);
  assert.deepEqual([industrial.before.parts,industrial.after.parts,industrial.after.ore,industrial.after.energy,industrial.after.seconds],[35,77,240,60,600]);
});

test('researched prerequisites are not counted twice and standard and industrial floors stay distinct', () => {
  const value=researchProductionPreview({...base,researchKey:'industrial_casting',completed:['basic_theory','thermal_recovery','extraction_ai']});
  assert.deepEqual(value.additionalPrerequisites,[]);
  assert.deepEqual([value.before.parts,value.after.parts],[38,77]);
  assert.notEqual(value.after.parts,value.before.parts*2);
});

test('chosen active workshop is respected; inactive selection falls back to a real active one', () => {
  const second={...active,id:'b',level:6,x:5,y:1};
  const upgrading={...active,id:'c',status:'upgrading',level:15};
  for(const selectedBuildingId of ['b','c','unknown']){
    const value=researchProductionPreview({...base,buildings:[active,second,upgrading],selectedBuildingId});
    const level=selectedBuildingId==='b'?6:1;
    assert.equal(value.workshop.id,selectedBuildingId==='b'?'b':'a');
    assert.deepEqual(value.after,quoteFoundry({level,recipe:'standard_alloy',mode:'standard',link:'none',cycles:1,partsMultiplier:1.1}));
  }
});

test('no active workshop produces no fictional level-one quote', () => {
  for(const buildings of [[],[{...active,status:'building'}],[{...active,status:'upgrading'}],[{...active,type:'mine'}],[{...active,level:16}],[{...active,level:NaN}],[{...active,x:-1}]]){
    const value=researchProductionPreview({...base,buildings});
    assert.equal(value.workshop,null);assert.equal(value.before,null);assert.equal(value.after,null);
  }
});

test('completed output bonus shows its real contribution and completed legacy recipe never invents a prerequisite bonus', () => {
  const thermal=researchProductionPreview({...base,completed:['basic_theory','thermal_recovery']});
  assert.equal(thermal.done,true);assert.deepEqual([thermal.before.parts,thermal.after.parts],[35,38]);
  const legacy=researchProductionPreview({...base,researchKey:'precision_casting',completed:['precision_casting']});
  assert.equal(legacy.done,true);assert.deepEqual(legacy.additionalPrerequisites,[]);
  assert.deepEqual([legacy.before.parts,legacy.after.parts],[35,35]);
});

test('unsupported keys and incomplete, cyclic, duplicate or modified prerequisite graphs have no hypothetical outcome', () => {
  for(const researchKey of ['basic_theory','deep_drilling','compact_storage','constructor','__proto__','unknown'])assert.equal(researchProductionPreview({...base,researchKey}),null);
  const clone=()=>structuredClone(RESEARCH_TREE);
  const missing=clone().filter(item=>item.key!=='thermal_recovery');
  const duplicate=clone();duplicate.push(duplicate[0]);
  const cycle=clone();cycle.find(item=>item.key==='thermal_recovery').prereqs=['precision_casting'];
  const bypass=clone();bypass.find(item=>item.key==='precision_casting').prereqs=[];
  const malformed=clone();malformed.find(item=>item.key==='precision_casting').prereqs=null;
  for(const catalog of [missing,duplicate,cycle,bypass,malformed])assert.equal(researchProductionPreview({...base,researchKey:'precision_casting',catalog}),null);
});

test('illustration preserves the catalog, city and completion snapshot without job or supply state', () => {
  const input=structuredClone({...base,researchKey:'industrial_casting'});const before=structuredClone(input);
  const value=researchProductionPreview(input);
  assert.deepEqual(input,before);
  for(const key of ['jobs','cycles','supplyPlan','startsAt','launch'])assert.equal(Object.hasOwn(value,key),false);
});
