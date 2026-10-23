import assert from 'node:assert/strict';
import test from 'node:test';
import { isInboxPage, inboxMessageAppearance } from '../lib/game/inbox.ts';
const item = {id:'letter-a',kind:'reward',title:'Получена награда',body:'Результат записан.',metadata:{},created_at:'2026-10-20T12:00:00.000Z',read_at:null};
const page = {items:[item],total:1,unread:1,matchingTotal:1,filter:'all',limit:5,hasMore:false,nextCursor:null};

test('inbox accepts complete snapshots and empty filters without changing read state', () => {
  assert.equal(isInboxPage(page), true);
  assert.equal(isInboxPage({...page,items:[],total:0,unread:0,matchingTotal:0,filter:'unread'}), true);
  assert.equal(page.items[0].read_at, null);
});
test('incomplete inbox replies cannot replace a readable page or crash message rendering', () => {
  for(const value of [null,[],{}, {...page,items:null}, {...page,items:[null]}, {...page,items:[{...item,body:undefined}]},
    {...page,items:[{...item,title:{}}]}, {...page,items:[{...item,created_at:'invalid'}]},
    {...page,items:[{...item,metadata:null}]}, {...page,items:[{...item,metadata:[]}]}, {...page,items:[{...item,read_at:'invalid'}]},
    {...page,total:-1}, {...page,unread:Infinity}, {...page,matchingTotal:0.5}, {...page,limit:30},
    {...page,filter:'unknown'}, {...page,hasMore:1}, {...page,nextCursor:{}}, {...page,items:Array(6).fill(item)}]) {
    assert.equal(isInboxPage(value), false);
  }
});
test('message categories use known lunar icons while arbitrary kinds keep a neutral fallback', () => {
  assert.deepEqual(inboxMessageAppearance('purchase'),{icon:'shop',label:'Покупка'});
  assert.deepEqual(inboxMessageAppearance('reward'),{icon:'gift',label:'Награда'});
  for(const kind of [null,{},'__proto__','constructor','future_kind']) assert.deepEqual(inboxMessageAppearance(kind),{icon:'mail',label:'Сообщение'});
});
