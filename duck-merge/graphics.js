(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DuckGraphics=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION='3.0.2';
 // Sprites are square, padded assets. One uniform scale is mandatory: using
 // different x/y scales made a rotated duck look long and hid real gaps.
 const SCALES=[1.05,1.05,1.05,1.06,1.05,1.05,1.05,1.15,1.4,1.3];
 const urls=SCALES.map((_,i)=>`assets/duck-${i+1}.png?v=${VERSION}`);
 function placement(tier,r){if(!Number.isFinite(SCALES[tier])||!Number.isFinite(r)||r<=0)throw new RangeError('Invalid sprite placement');const size=2*r*SCALES[tier];return{x:-size/2,y:-size/2,w:size,h:size}}
 function createAssetStore(loader){let assets=null,pending=null,revision=0;return{
  load(force=false){if(pending)return pending;if(assets&&!force)return Promise.resolve(assets);const batch=force?++revision:revision;
   pending=Promise.all(urls.map(url=>loader(url+(batch?'&reload='+batch:'')))).then(result=>{
    if(result.length!==SCALES.length||result.some(i=>!i||!i.complete||i.naturalWidth<=0||i.naturalHeight<=0))throw Error('Incomplete duck images');
    assets=result;return assets;
   }).finally(()=>{pending=null});return pending;
  },get(){return assets},valid(){return !!assets&&assets.every(i=>i.complete&&i.naturalWidth>0&&i.naturalHeight>0)}
 }}
 // A render error must stop physics before another invisible step is accepted.
 function guardedFrame(game,advance,draw,onFailure){try{advance();draw();return true}catch(error){game.paused=true;onFailure(error);return false}}
 return{VERSION,SCALES,urls,placement,createAssetStore,guardedFrame};
});
