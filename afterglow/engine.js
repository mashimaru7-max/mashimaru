import {defaultRounds,validateRounds} from './rounds.js?v=11';
export const W=60,H=90,EMPTY=0,SAFE=1,TRAIL=2;
export class Game {
 constructor(){this.rounds=defaultRounds();this.stage=1;this.lives=3;this.score=0;this.speed=1;this.events=[];this.status='ready';this.init();}
 configure(rounds){this.rounds=validateRounds(rounds);}
 get round(){return this.rounds[this.stage-1]??this.rounds[0];}
 index(x,y){return y*W+x;}
 cell(x,y){return x<0||y<0||x>=W||y>=H?SAFE:this.grid[this.index(x,y)];}
 init(){this.grid=new Uint8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(x<2||y<2||x>=W-2||y>=H-2)this.grid[this.index(x,y)]=SAFE;this.player={x:1,y:45};this.lastSafe={...this.player};this.trail=[];this.returning=false;this.bonusChallenge=false;this.bonusUnlocked=false;this.milestoneReached=false;this.dir=null;this.acc=0;this.cooldown=0;this.elapsed=0;this.combo=0;this.comboAt=-100;const n=this.round.enemyCount;this.enemies=Array.from({length:n},(_,i)=>({x:10+(i%4)*12,y:16+Math.floor(i/4)*24,vx:(i%2?-1:1)*(5.2+this.stage*.7)*this.round.enemySpeed,vy:(i%2?1:-1)*(4.4+this.stage*.6)*this.round.enemySpeed,kind:i%2?'roamer':'hunter',phase:i*2.1,turnIn:.8+i*.2,hunting:false}));this.initialArea=this.area();}
 area(){let n=0;for(const c of this.grid)if(c===SAFE)n++;return n/(W*H)*100;}
 get target(){return this.bonusChallenge?95:this.round.target;}
 continueBonus(){if(this.status!=='clear'||this.bonusUnlocked)return false;this.bonusChallenge=true;this.status='playing';this.events=[];return true;}
 checkProgress(){const area=this.area();if(area>=95){if(!this.bonusUnlocked){this.bonusUnlocked=true;this.score+=5000;this.events.push({type:'bonus'});}if(!this.milestoneReached){this.milestoneReached=true;this.score+=Math.max(0,Math.round(3000-this.elapsed*8));}this.bonusChallenge=false;this.status='clear';this.stop();this.events.push({type:'clear'});}else if(area>=this.round.target&&!this.milestoneReached){this.milestoneReached=true;this.status='clear';this.stop();this.score+=Math.max(0,Math.round(3000-this.elapsed*8));this.events.push({type:'clear'});}}
 start(){this.stage=1;this.lives=3;this.score=0;this.init();this.status='playing';this.events=[];}
 next(){if(this.status!=='clear')return;if(this.stage>=this.rounds.length){this.status='complete';return;}this.stage++;this.lives=Math.min(3,this.lives+1);this.init();this.status='playing';}
 direction(d){if(this.status==='playing'&&!this.cooldown){if(!d){this.release();return;}this.returning=false;this.dir=d;}}
 stop(){this.dir=null;this.acc=0;this.returning=false;}
 release(){this.dir=null;this.acc=0;this.returning=this.status==='playing'&&this.trail.length>0;}
 returnStep(){if(!this.trail.length){this.returning=false;return;}const removed=this.trail.pop();this.grid[this.index(removed.x,removed.y)]=EMPTY;this.player={...(this.trail[this.trail.length-1]??this.lastSafe)};if(!this.trail.length){this.returning=false;this.events.push({type:'returned'});}}
 pause(){if(this.status==='playing'){this.status='paused';this.dir=null;this.acc=0;}else if(this.status==='paused'){this.status='playing';if(this.trail.length)this.returning=true;}}
 hit(){if(this.cooldown||this.status!=='playing')return;for(const p of this.trail)this.grid[this.index(p.x,p.y)]=EMPTY;this.trail=[];this.player={...this.lastSafe};this.stop();this.lives--;this.combo=0;this.cooldown=1.1;this.status=this.lives<=0?'gameover':'playing';this.events.push({type:'hit'});}
 step(){const v={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[this.dir];if(!v)return;const p={x:this.player.x+v[0],y:this.player.y+v[1]};if(p.x<0||p.y<0||p.x>=W||p.y>=H)return;const c=this.cell(p.x,p.y);
  if(c===TRAIL){const back=this.trail[this.trail.length-2];if(back&&back.x===p.x&&back.y===p.y){const removed=this.trail.pop();this.grid[this.index(removed.x,removed.y)]=EMPTY;this.player=p;return;}this.hit();return;}
  if(this.trail.length===1&&p.x===this.lastSafe.x&&p.y===this.lastSafe.y){this.returnStep();return;}
  this.player=p;if(c===SAFE){if(this.trail.length)this.capture();this.lastSafe={...p};}else{this.grid[this.index(p.x,p.y)]=TRAIL;this.trail.push(p);}
 }
 capture(){const before=this.area();for(const p of this.trail)this.grid[this.index(p.x,p.y)]=SAFE;this.trail=[];
  // Label whole regions. An enemy protects only the region containing its center,
  // never cells across a captured wall. Keep one playable region after each cut.
  const labels=new Int32Array(W*H);labels.fill(-1);const regions=[];
  for(let i=0;i<this.grid.length;i++){if(this.grid[i]!==EMPTY||labels[i]!==-1)continue;const id=regions.length,cells=[i];labels[i]=id;
   for(let head=0;head<cells.length;head++){const j=cells[head],x=j%W,y=Math.floor(j/W);for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(xx<0||yy<0||xx>=W||yy>=H)continue;const k=this.index(xx,yy);if(this.grid[k]===EMPTY&&labels[k]===-1){labels[k]=id;cells.push(k);}}}regions.push(cells);
  }
  const enemyRegions=this.enemies.map(e=>labels[this.index(Math.floor(e.x),Math.floor(e.y))]??-1);
  let keep=-1;for(const id of enemyRegions)if(id>=0&&(keep<0||regions[id].length>regions[keep].length))keep=id;
  for(let id=0;id<regions.length;id++)if(id!==keep)for(const i of regions[id])this.grid[i]=SAFE;
  if(keep>=0)for(let n=0;n<this.enemies.length;n++){if(enemyRegions[n]===keep)continue;const e=this.enemies[n];let closest=regions[keep][0],distance=Infinity;for(const i of regions[keep]){const x=i%W+.5,y=Math.floor(i/W)+.5,d=(x-e.x)**2+(y-e.y)**2;if(d<distance){distance=d;closest=i;}}e.x=closest%W+.5;e.y=Math.floor(closest/W)+.5;e.turnIn=0;e.hunting=false;}
  const gained=this.area()-before;this.combo=this.elapsed-this.comboAt<8?Math.min(3,this.combo+1):1;this.comboAt=this.elapsed;const points=Math.round(gained*100*(gained>=10?1.5:1)*this.combo);this.score+=points;this.events.push({type:'capture',gained,points,combo:this.combo});this.checkProgress();
 }
 blocked(x,y){const r=.28;for(const dx of [-r,r])for(const dy of [-r,r])if(this.cell(Math.floor(x+dx),Math.floor(y+dy))===SAFE)return true;return false;}
 enemyContact(e){if(this.cooldown)return;const x=Math.floor(e.x),y=Math.floor(e.y);for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++){if(this.cell(xx,yy)!==TRAIL)continue;const nx=Math.max(xx,Math.min(e.x,xx+1)),ny=Math.max(yy,Math.min(e.y,yy+1));if(Math.hypot(e.x-nx,e.y-ny)<.4){this.hit();return;}}
  if(this.trail.length&&Math.hypot(e.x-this.player.x-.5,e.y-this.player.y-.5)<.8)this.hit();
 }
 steerEnemy(e,dt){if(!e.kind)return;e.turnIn-=dt;if(e.turnIn>0)return;e.turnIn=.55+.15*(1+Math.sin(this.elapsed+e.phase));let angle=Math.atan2(e.vy,e.vx),speed=(7.2+this.stage*.8)*this.round.enemySpeed;e.hunting=e.kind==='hunter'&&this.trail.length>=3;if(e.hunting){let closest=this.trail[0],distance=Infinity;for(const p of this.trail){const d=Math.hypot(p.x+.5-e.x,p.y+.5-e.y);if(d<distance){distance=d;closest=p;}}angle=Math.atan2(closest.y+.5-e.y,closest.x+.5-e.x);speed*=1.3;}else{angle+=Math.sin(this.elapsed*1.7+e.phase)*.95+(e.kind==='roamer'?.32:-.19);speed*=1+.18*Math.sin(this.elapsed*2+e.phase);}e.vx=Math.cos(angle)*speed;e.vy=Math.sin(angle)*speed;}
 update(dt){if(this.status!=='playing')return;dt=Math.min(dt,.05);this.elapsed+=dt;if(this.round.timeLimit&&this.elapsed>=this.round.timeLimit){this.stop();this.status='gameover';this.events.push({type:'timeout'});return;}this.cooldown=Math.max(0,this.cooldown-dt);if((this.dir||this.returning)&&!this.cooldown){this.acc+=dt*(this.returning?24:this.trail.length?12:16)*this.speed;while(this.acc>=1&&this.status==='playing'&&(this.dir||this.returning)){this.acc-=1;if(this.returning)this.returnStep();else this.step();}}if(this.status!=='playing')return;
  for(const e of this.enemies){this.steerEnemy(e,dt);const count=Math.max(1,Math.ceil(Math.max(Math.abs(e.vx),Math.abs(e.vy))*dt/.15));for(let j=0;j<count;j++){const nx=e.x+e.vx*dt/count;if(this.blocked(nx,e.y))e.vx*=-1;else e.x=nx;const ny=e.y+e.vy*dt/count;if(this.blocked(e.x,ny))e.vy*=-1;else e.y=ny;this.enemyContact(e);if(this.status!=='playing')return;}}
 }
 snapshot(){return {status:this.status,stage:this.stage,lives:this.lives,score:this.score,capturedPercent:Number(this.area().toFixed(1)),target:this.target,bonusUnlocked:this.bonusUnlocked,returning:this.returning,player:{...this.player}};}
}
