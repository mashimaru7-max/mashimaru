import test from 'node:test';
import assert from 'node:assert/strict';
import {tripFromFields} from '../travel-controller.mjs';
import {NasClient,validateTravelItem} from '../nas-client.mjs';
const base='https://fixture-travel.trycloudflare.com',token='fixture-only-token-0000000000000000000000';
const fields={title:'가족 여행',scope:'domestic',country:'다른 표기',city:'제주',author:'엄마',start:'2026-01-01',end:'2026-01-03',lat:'33.4',lng:'126.5',story:'그날의 기억'};
const id='12345678-1234-4234-8234-123456789012';
const record=tripFromFields('trip',fields,'2019/오니둥이',['다온','라온'],{'라온':'즐거웠어'});
const item={id,revision:1,deleted:false,record};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
test('trip form keeps selected folder, family voices and explicit map location',()=>{
 assert.equal(record.country,'대한민국');assert.equal(record.lat,33.4);assert.equal(record.folder,'2019/오니둥이');assert.deepEqual(record.members,['다온','라온']);assert.equal(record.reviews['라온'],'즐거웠어');assert.equal(validateTravelItem(item),item);
});
test('missing coordinates never become an accidental pin at zero, invalid dates and empty family reject',()=>{
 for(const changes of [{lat:''},{lng:''},{lat:'NaN'},{lng:'181'},{end:'2025-01-01'}])assert.throws(()=>tripFromFields('trip',{...fields,...changes},null,['엄마'],{}));
 assert.throws(()=>tripFromFields('trip',fields,null,[],{}));assert.equal(tripFromFields('trip',{...fields,lat:'0',lng:'0'},null,['아빠'],{}).lat,0);
});
test('wish uses its own compact fields and does not pretend to be a visited trip',()=>{
 const wish=tripFromFields('wish',{...fields,scope:'international',country:'스위스',month:'2027-02',note:'기차를 타고 싶어',done:'on'},null,[],{});
 assert.equal(wish.kind,'wish');assert.equal(wish.done,true);assert.equal(wish.month,'2027-02');assert(!('lat' in wish));assert(!('folder' in wish));
});
test('travel requests use bearer headers, real server records and explicit album ID',async()=>{
 const calls=[];const client=new NasClient({fetchImpl:async(url,init)=>{calls.push({url,init});const u=new URL(url);if(u.pathname==='/api/list')return json({path:'',items:[],next:null,total:0});if(u.pathname==='/api/travel-album')return json({shared:true,items:[],unbound:true});if(init.method==='POST'||u.searchParams.has('id'))return json(item);return json({items:[item],pins:[{id,title:record.title,lat:33.4,lng:126.5}],total:1,next:null,years:['2026'],stats:{trips:1,countries:1,cities:1,wishes:0}});}});
 await client.connect({base,token});assert.equal((await client.travelList()).items[0].id,id);await client.travelWrite({action:'save',id,revision:0,record});await client.travelAlbum(id);
 for(const c of calls){assert(!c.url.includes(token));assert.equal(c.init.headers.Authorization,'Bearer '+token);}
 assert.equal(JSON.parse(calls.at(-1).init.body).id,id);
});
test('stale travel writes report conflict and keep current login',async()=>{
 const client=new NasClient({fetchImpl:async url=>new URL(url).pathname==='/api/list'?json({path:'',items:[],next:null,total:0}):json({},409)});await client.connect({base,token});await assert.rejects(client.travelWrite({action:'save',id,revision:1,record}),e=>e.code==='HTTP_409'&&e.message.includes('입력 내용은 유지'));assert(client.connected);
});
