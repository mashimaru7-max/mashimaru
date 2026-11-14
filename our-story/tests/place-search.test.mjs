import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlaces,placeZoom,searchPlaces} from '../place-search.mjs';
test('only valid coordinates become candidates, including equator and prime meridian',()=>{
 const places=normalizePlaces([{lat:'0',lon:'0',display_name:'Zero',addresstype:'country'},{lat:'91',lon:'1'},{lat:'x',lon:'0'},{lat:'1',lon:'181'}]);
 assert.equal(places.length,1);assert.equal(places[0].lat,0);assert.equal(placeZoom(places[0]),5);assert.equal(placeZoom({type:'city'}),11);
});
test('explicit Korean search uses English names, country scope and no credentials; repeated lookups cached',async()=>{
 let calls=0;
 const fetcher=async(url,options)=>{calls++;assert.equal(url.searchParams.get('q'),'태국 방콕');assert.equal(url.searchParams.get('accept-language'),'en');assert.equal(options.credentials,'omit');assert(!options.headers);return new Response(JSON.stringify([{lat:'13.752',lon:'100.493',display_name:'Bangkok, Thailand',addresstype:'city'}]));};
 const a=await searchPlaces('태국 방콕',{fetcher});const b=await searchPlaces('태국 방콕',{fetcher});assert.equal(a[0].label,'Bangkok, Thailand');assert.equal(a,b);assert.equal(calls,1);
});
test('all named style labels prefer English or romanization',async()=>{
 const {readFile}=await import('node:fs/promises');const style=JSON.parse(await readFile(new URL('../map-style-en.json',import.meta.url)));
 const labels=style.layers.filter(l=>l.layout?.['text-field']&&JSON.stringify(l.layout['text-field']).includes('name'));
 assert(labels.length>10);for(const l of labels)assert.deepEqual(l.layout['text-field'],['coalesce',['get','name:en'],['get','name_en'],['get','name:latin'],['get','name']]);
});
