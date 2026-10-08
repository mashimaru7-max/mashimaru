export const W=60,H=90,EMPTY=0,SAFE=1,TRAIL=2;
export class Game {
 constructor(){this.stage=1;this.lives=3;this.score=0;this.speed=1;this.events=[];this.status='ready';this.init();}
 index(x,y){return y*W+x;}
 cell(x,y){return x<0||y<0||x>=W||y>=H?SAFE:this.grid[this.index(x,y)];}
 init(){this.grid=new Uint8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(x<2||y<2||x>=W-2||y>=H-2)this.grid[this.index(x,y)]=SAFE;this.player={x:1,y:45};this.lastSafe={...this.player};this.trail=[];this.dir=null;this.acc=0;this.cooldown=0;this.elapsed=0;this.combo=0;this.comboAt=-100;const n=[1,2,2,3,3][this.stage-1];this.enemies=Array.from({length:n},(_,i)=>({x:30+i*7,y:24+i*19,vx:(i%2?-1:1)*(4.1+this.stage*.7),vy:(i%2?1:-1)*(3.4+this.stage*.6)}));this.initialArea=this.area();}
 area(){let n=0;for(const c of this.grid)if(c===SAFE)n++;return n/(W*H)*100;}
 get target(){return this.stage<4?75:80;}
 start(){this.stage=1;this.lives=3;this.score=0;this.init();this.status='playing';this.events=[];}
 next(){if(this.status!=='clear')return;if(this.stage>=5){this.status='complete';return;}this.stage++;this.lives=Math.min(3,this.lives+1);this.init();this.status='playing';}
 direction(d){if(this.status==='playing'&&!this.cooldown){if(d!==this.dir)this.acc=0;this.dir=d;}}
 stop(){this.dir=null;this.acc=0;}
 pause(){if(this.status==='playing'){this.status='paused';this.stop();}else if(this.status==='paused')this.status='playing';}
 hit(){if(this.cooldown||this.status!=='playing')return;for(const p of this.trail)this.grid[this.index(p.x,p.y)]=EMPTY;this.trail=[];this.player={...this.lastSafe};this.stop();this.lives--;this.combo=0;this.cooldown=1.1;this.status=this.lives<=0?'gameover':'playing';this.events.push({type:'hit'});}
 step(){const v={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[this.dir];if(!v)return;const p={x:this.player.x+v[0],y:this.player.y+v[1]};if(p.x<0||p.y<0||p.x>=W||p.y>=H)return;const c=this.cell(p.x,p.y);
  if(c===TRAIL){const back=this.trail[this.trail.length-2];if(back&&back.x===p.x&&back.y===p.y){const removed=this.trail.pop();this.grid[this.index(removed.x,removed.y)]=EMPTY;this.player=p;return;}this.hit();return;}
  this.player=p;if(c===SAFE){if(this.trail.length)this.capture();this.lastSafe={...p};}else{this.grid[this.index(p.x,p.y)]=TRAIL;this.trail.push(p);}
 }
 capture(){const before=this.area();for(const p of this.trail)this.grid[this.index(p.x,p.y)]=SAFE;this.trail=[];const seen=new Uint8Array(W*H),queue=[];
  for(const e of this.enemies){const x=Math.floor(e.x),y=Math.floor(e.y);for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++){if(xx<0||yy<0||xx>=W||yy>=H)continue;const i=this.index(xx,yy);if(this.grid[i]===EMPTY&&!seen[i]){seen[i]=1;queue.push(i);}}}
  for(let head=0;head<queue.length;head++){const i=queue[head],x=i%W,y=Math.floor(i/W);for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(xx<0||yy<0||xx>=W||yy>=H)continue;const j=this.index(xx,yy);if(this.grid[j]===EMPTY&&!seen[j]){seen[j]=1;queue.push(j);}}}
  for(let i=0;i<this.grid.length;i++)if(this.grid[i]===EMPTY&&!seen[i])this.grid[i]=SAFE;
  const gained=this.area()-before;this.combo=this.elapsed-this.comboAt<8?Math.min(3,this.combo+1):1;this.comboAt=this.elapsed;const points=Math.round(gained*100*(gained>=10?1.5:1)*this.combo);this.score+=points;this.events.push({type:'capture',gained,points,combo:this.combo});if(this.area()>=this.target){this.status='clear';this.stop();this.score+=Math.max(0,Math.round(3000-this.elapsed*8));this.events.push({type:'clear'});}
 }
 blocked(x,y){const r=.28;for(const dx of [-r,r])for(const dy of [-r,r])if(this.cell(Math.floor(x+dx),Math.floor(y+dy))===SAFE)return true;return false;}
 enemyContact(e){if(this.cooldown)return;const x=Math.floor(e.x),y=Math.floor(e.y);for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++){if(this.cell(xx,yy)!==TRAIL)continue;const nx=Math.max(xx,Math.min(e.x,xx+1)),ny=Math.max(yy,Math.min(e.y,yy+1));if(Math.hypot(e.x-nx,e.y-ny)<.4){this.hit();return;}}
  if(this.trail.length&&Math.hypot(e.x-this.player.x-.5,e.y-this.player.y-.5)<.8)this.hit();
 }
 update(dt){if(this.status!=='playing')return;dt=Math.min(dt,.05);this.elapsed+=dt;this.cooldown=Math.max(0,this.cooldown-dt);if(this.dir&&!this.cooldown){this.acc+=dt*(this.trail.length?11:15)*this.speed;while(this.acc>=1&&this.status==='playing'&&this.dir){this.acc-=1;this.step();}}if(this.status!=='playing')return;
  for(const e of this.enemies){const count=Math.max(1,Math.ceil(Math.max(Math.abs(e.vx),Math.abs(e.vy))*dt/.15));for(let j=0;j<count;j++){const nx=e.x+e.vx*dt/count;if(this.blocked(nx,e.y))e.vx*=-1;else e.x=nx;const ny=e.y+e.vy*dt/count;if(this.blocked(e.x,ny))e.vy*=-1;else e.y=ny;this.enemyContact(e);if(this.status!=='playing')return;}}
 }
 snapshot(){return {status:this.status,stage:this.stage,lives:this.lives,score:this.score,capturedPercent:Number(this.area().toFixed(1)),target:this.target,player:{...this.player}};}
}
