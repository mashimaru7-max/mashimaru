(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DuckGraphics=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION='2.0.0';
 // Body box excludes hats, crowns and feet. Align its centre with the physics circle.
 const BOXES=[ [.02,.12,.98,.94], [.02,.10,.98,.94], [.02,.22,.98,.94], [.02,.30,.98,.94], [.02,.06,.98,.94], [.02,.13,.98,.94], [.02,.07,.98,.94], [.02,.24,.98,.94] ];
 const urls=BOXES.map((_,i)=>`assets/duck-${i+1}.png?v=${VERSION}`);
 function placement(tier,r){if(!BOXES[tier]||!Number.isFinite(r)||r<=0)throw new RangeError('Invalid sprite placement');const[l,t,rr,b]=BOXES[tier],w=2*r/(rr-l),h=2*r/(b-t);return{x:-(l+rr)/2*w,y:-(t+b)/2*h,w,h}}
 function createAssetStore(loader){let assets=null,pending=null,revision=0;return{
  load(force=false){if(pending)return pending;if(assets&&!force)return Promise.resolve(assets);const batch=force?++revision:revision;
   pending=Promise.all(urls.map(url=>loader(url+(batch?'&reload='+batch:'')))).then(result=>{
    if(result.length!==8||result.some(i=>!i||!i.complete||i.naturalWidth<=0||i.naturalHeight<=0))throw Error('Incomplete duck images');
    assets=result;return assets;
   }).finally(()=>{pending=null});return pending;
  },get(){return assets},valid(){return !!assets&&assets.every(i=>i.complete&&i.naturalWidth>0&&i.naturalHeight>0)}
 }}
 // A render error must stop physics before another invisible step is accepted.
 function guardedFrame(game,advance,draw,onFailure){try{advance();draw();return true}catch(error){game.paused=true;onFailure(error);return false}}
 return{VERSION,BOXES,urls,placement,createAssetStore,guardedFrame};
});
