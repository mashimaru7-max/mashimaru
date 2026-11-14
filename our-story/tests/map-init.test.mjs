import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMap} from '../travel-controller.mjs';
test('MapLibre 5 initializes English tiles without the removed supported() API',()=>{
 let vector=0,raster=0;const map={setView(){return this},invalidateSize(){},_container:{isConnected:true}};
 const previous={L:globalThis.L,maplibregl:globalThis.maplibregl};
 globalThis.L={map:()=>map,maplibreGL(options){vector++;assert(options.style.endsWith('/map-style-en.json'));return {addTo(){return this},getMaplibreMap(){return {on(){}}}};},tileLayer(){raster++;return {addTo(){}}}};
 globalThis.maplibregl={Map:class {}};
 try{assert.equal(makeMap({}),map);assert.equal(vector,1);assert.equal(raster,0);}finally{globalThis.L=previous.L;globalThis.maplibregl=previous.maplibregl;}
});
