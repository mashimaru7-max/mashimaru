import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,SAFE} from '../engine.js';
import {validateRounds} from '../rounds.js';
const round={target:80,timeLimit:1,enemyCount:12,enemySpeed:.5};
test('custom round goal, enemy count, time limit and round count affect gameplay',()=>{const game=new Game();game.configure([round]);game.start();assert.equal(game.target,80);assert.equal(game.enemies.length,12);assert.ok(game.enemies.every(e=>!game.blocked(e.x,e.y)));for(let i=0;i<21;i++)game.update(.05);assert.equal(game.status,'gameover');assert.ok(game.events.some(e=>e.type==='timeout'));game.start();game.grid.fill(SAFE,0,Math.ceil(game.grid.length*.81));game.checkProgress();assert.equal(game.status,'clear');game.next();assert.equal(game.status,'complete');});
test('round settings reject invalid goals, counts and nonnumeric values',()=>{for(const invalid of [{...round,target:99},{...round,enemyCount:0},{...round,enemySpeed:NaN},{...round,timeLimit:-1}])assert.throws(()=>validateRounds([invalid]));assert.throws(()=>validateRounds([]));assert.throws(()=>validateRounds(Array(21).fill(round)));});
