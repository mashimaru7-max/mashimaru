const test=require('node:test');const assert=require('node:assert/strict');
const {Game,STEP,FLOOR,TIERS,FINAL_TIER,CONTACT_EPSILON}=require('../physics.js');const M=require('../vendor/matter.min.js');
const advance=(g,ms)=>{for(let i=0;i<Math.ceil(ms/STEP);i++)g.step()};
test('regression: removing a settled support makes the upper duck fall without a nudge',()=>{
 const g=new Game(),base=M.Bodies.rectangle(160,420,180,24,{isStatic:true}),top=g.add(0,160,370);M.Composite.add(g.engine.world,base);advance(g,5000);const y=top.position.y;assert.ok(y<410);
 M.Composite.remove(g.engine.world,base);g.ducks=g.ducks.filter(b=>b!==base);advance(g,2000);
 assert.ok(top.position.y>y+70);assert.ok(Math.abs(top.position.y-(FLOOR-18))<2);assert.equal(top.isSleeping,false);
});
test('regression: actual merge under a settled pile leaves no unsupported stationary body',()=>{
 const g=new Game();const a=g.add(1,120,FLOOR-25),b=g.add(1,170,FLOOR-25),top=g.add(0,111,FLOOR-67);
 const resolve=g.resolveMerges;g.resolveMerges=()=>{};advance(g,5000);g.resolveMerges=resolve;
 M.Body.setPosition(a,{x:120,y:FLOOR-25});M.Body.setPosition(b,{x:170,y:FLOOR-25});
 g.resolveMerges();assert.equal(g.merges,1);advance(g,2000);
 assert.equal(top.isSleeping,false);const support=g.ducks.some(d=>d!==top&&d.position.y>top.position.y&&Math.hypot(d.position.x-top.position.x,d.position.y-top.position.y)<=TIERS[d.duck.tier].r+18+2);
 assert.ok(support||Math.abs(top.position.y-(FLOOR-18))<2);
});
test('regression: a young contacting pair is reconsidered even without collision events',()=>{
 const g=new Game(),a=g.add(0,192,490),b=g.add(0,228,490);M.Body.setStatic(a,true);M.Body.setStatic(b,true);
 advance(g,75);assert.equal(g.merges,0);advance(g,100);assert.equal(g.merges,1);assert.equal(g.score,30);
});
test('same-tier gap is not enlarged into an invisible merge zone',()=>{
 for(let tier=0;tier<FINAL_TIER;tier++){const g=new Game(),r=TIERS[tier].r,a=g.add(tier,210-r-(CONTACT_EPSILON+1)/2,400),b=g.add(tier,210+r+(CONTACT_EPSILON+1)/2,400);M.Body.setStatic(a,true);M.Body.setStatic(b,true);advance(g,500);assert.equal(g.merges,0)}
});
test('contact tolerance admits only subpixel slop and respects tier identity',()=>{
 const g=new Game(),a=g.add(0,192,450),b=g.add(0,228.3,450);M.Body.setStatic(a,true);M.Body.setStatic(b,true);advance(g,200);assert.equal(g.merges,1);
});
test('wall and rotated pairs merge at every mergeable tier',()=>{
 for(let tier=0;tier<FINAL_TIER;tier++){const g=new Game(),r=TIERS[tier].r,a=g.add(tier,r+5,350,{angle:.9}),b=g.add(tier,r+5,350+2*r,{angle:-1.2});M.Body.setStatic(a,true);M.Body.setStatic(b,true);advance(g,200);assert.equal(g.merges,1);assert.equal(g.highest,tier+1)}
});
test('four ducks form two pairs and only chain-merge on renewed contact',()=>{
 const g=new Game();for(const x of [155,191,227,263]){const b=g.add(0,x,450);M.Body.setStatic(b,true)}advance(g,1000);assert.equal(g.ducks.length,2);assert.equal(g.score,60);M.Body.setPosition(g.ducks[0],{x:185,y:500});M.Body.setPosition(g.ducks[1],{x:235,y:500});advance(g,1000);assert.equal(g.ducks.length,1);assert.equal(g.ducks[0].duck.tier,2);assert.equal(g.score,120);
});
test('invalid construction and timestep inputs cannot poison physics',()=>{
 const g=new Game();for(const t of [-1,TIERS.length,NaN,1.5])assert.throws(()=>g.add(t,100,100),RangeError);assert.throws(()=>g.add(0,NaN,100),RangeError);for(const dt of [0,-1,NaN,Infinity,200])assert.throws(()=>g.step(dt),RangeError);assert.equal(g.time,0);assert.equal(g.ducks.length,0);
});
test('20 deterministic sessions keep positions and scores valid',()=>{
 for(let run=1;run<=20;run++){let seed=run;const rng=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);const g=new Game({random:rng});for(let n=0;n<100&&!g.over;n++){g.drop(20+rng()*380);advance(g,800);for(const d of g.ducks){assert.ok(Number.isFinite(d.position.x)&&Number.isFinite(d.position.y)&&Number.isFinite(d.angle));assert.equal(d.isSleeping,false);assert.ok(d.position.y<=FLOOR+1)}}assert.ok(Number.isSafeInteger(g.score));}
});
test('settled bodies do not remain deeply overlapped after merge resolution',()=>{
 let seed=42;const rng=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);const g=new Game({random:rng});for(let n=0;n<80&&!g.over;n++){g.drop(20+rng()*380);advance(g,850)}advance(g,3000);
 for(let i=0;i<g.ducks.length;i++)for(let j=i+1;j<g.ducks.length;j++){const a=g.ducks[i],b=g.ducks[j],sum=TIERS[a.duck.tier].r+TIERS[b.duck.tier].r,dist=Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y);assert.ok(sum-dist<2.5,`deep overlap: ${sum-dist}`)}
});
