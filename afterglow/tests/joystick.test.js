import test from 'node:test';
import assert from 'node:assert/strict';
import {FloatingStick} from '../joystick.js';
test('stick begins at any touch position and ignores small jitter',()=>{const s=new FloatingStick();s.begin(233,81);assert.equal(s.move(236,83).direction,null);assert.equal(s.move(241,81).direction,'right');});
test('base follows a long drag and stays within the stick radius',()=>{const s=new FloatingStick();s.begin(50,50);const r=s.move(200,50);assert.equal(r.direction,'right');assert.equal(r.base.x,172);assert.ok(Math.hypot(r.knob.x-r.base.x,r.knob.y-r.base.y)<=28.001);});
test('a short perpendicular movement turns after a long drag',()=>{const s=new FloatingStick();s.begin(50,50);s.move(200,50);const r=s.move(200,14);assert.equal(r.direction,'up');assert.ok(r.base.x>170);});
test('direction hysteresis suppresses diagonal jitter, then allows deliberate turn',()=>{const s=new FloatingStick();s.begin(100,100);assert.equal(s.move(112,100).direction,'right');for(const y of [111.8,112.2,111.9,112.1])assert.equal(s.move(112,y).direction,'right');assert.equal(s.move(112,114).direction,'down');});
test('neutral and reset clear direction; a new touch has a fresh origin',()=>{const s=new FloatingStick();s.begin(100,100);s.move(115,100);assert.equal(s.move(102,101).direction,null);s.reset();assert.equal(s.move(200,100).active,false);assert.equal(s.begin(220,75).direction,null);assert.equal(s.move(210,75).direction,'left');});
test('a direct reversal switches direction without hysteresis delay',()=>{const s=new FloatingStick();s.begin(100,100);s.move(112,100);assert.equal(s.move(88,100).direction,'left');});
