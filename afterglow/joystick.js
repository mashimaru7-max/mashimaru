// Coordinates are CSS pixels: sensitivity stays consistent across phone sizes.
export class FloatingStick {
 constructor({radius=28,deadZone=6,hysteresis=1.12}={}){this.radius=radius;this.deadZone=deadZone;this.hysteresis=hysteresis;this.reset();}
 reset(){this.active=false;this.direction=null;this.base={x:0,y:0};this.knob={x:0,y:0};}
 begin(x,y){this.active=true;this.direction=null;this.base={x,y};this.knob={x,y};return this.snapshot();}
 move(x,y){if(!this.active)return this.snapshot();let dx=x-this.base.x,dy=y-this.base.y;const distance=Math.hypot(dx,dy);
  if(distance>this.radius){const follow=1-this.radius/distance;this.base.x+=dx*follow;this.base.y+=dy*follow;dx=x-this.base.x;dy=y-this.base.y;}
  this.knob={x,y};const h=Math.abs(dx),v=Math.abs(dy);
  if(Math.hypot(dx,dy)<this.deadZone)this.direction=null;
  else if((this.direction==='left'||this.direction==='right')&&v<=h*this.hysteresis)this.direction=dx>=0?'right':'left';
  else if((this.direction==='up'||this.direction==='down')&&h<=v*this.hysteresis)this.direction=dy>=0?'down':'up';
  else this.direction=h>=v?(dx>=0?'right':'left'):(dy>=0?'down':'up');
  return this.snapshot();
 }
 snapshot(){return {active:this.active,direction:this.direction,base:{...this.base},knob:{...this.knob}};}
}
