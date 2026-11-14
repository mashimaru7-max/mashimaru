/* K League 2 2026, competition regulations articles 34–35.
   National-team exemptions are user-selected, never inferred from today's date. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LineupRules=api;})(typeof window==='object'?window:globalThis,()=>{
'use strict';
const STARTERS=11,BENCH=9;
function normalize(data,players,formations){
 if(!data||!formations.includes(data.formation)||!Array.isArray(data.lineup)||data.lineup.length!==STARTERS)return null;
 const bench=data.bench===undefined?Array(BENCH).fill(null):data.bench;
 const callups=data.callups===undefined?0:data.callups;
 if(!Array.isArray(bench)||bench.length!==BENCH||!Number.isInteger(callups)||callups<0||callups>2)return null;
 const ids=[...data.lineup,...bench].filter(id=>id!==null);
 if(ids.some(id=>!players.some(p=>p.id===id))||new Set(ids).size!==ids.length)return null;
 return {formation:data.formation,lineup:[...data.lineup],bench:[...bench],callups,captain:data.captain!=null&&data.lineup.includes(data.captain)?data.captain:null};
}
function at(state,index){return index<STARTERS?state.lineup[index]:state.bench[index-STARTERS];}
function set(state,index,id){if(index<STARTERS)state.lineup[index]=id;else state.bench[index-STARTERS]=id;}
function place(state,id,index){
 if(!Number.isInteger(index)||index<0||index>=STARTERS+BENCH)throw Error('명단 자리 범위 초과');
 const next=structuredClone(state),old=[...next.lineup,...next.bench].indexOf(id);
 if(old===index)return next;
 if(old>=0)set(next,old,at(next,index));set(next,index,id);return next;
}
function isU22(p){return !!p&&!p.isForeign&&typeof p.birthday==='string'&&p.birthday>='2004-01-01';}
function assess(state,players){
 const byId=id=>players.find(p=>p.id===id);
 const starting=state.lineup.map(byId).filter(Boolean),bench=state.bench.map(byId).filter(Boolean),all=[...starting,...bench];
 const youth=all.filter(isU22).length,startingYouth=starting.filter(isU22).length,foreign=all.filter(p=>p.isForeign).length;
 const callups=state.callups||0,maxEntry=18+Math.min(2,youth+callups),maxBench=maxEntry-STARTERS;
 const benchGK=bench.filter(p=>p.position==='GK').length,issues=[];
 if(starting.length!==STARTERS)issues.push(`선발 ${STARTERS-starting.length}명 더 선택`);
 if(all.length>maxEntry)issues.push(`U22 조건상 엔트리 ${maxEntry}명까지 가능 · 현재 ${all.length}명`);
 if(!benchGK)issues.push('후보 골키퍼 1명 필요');
 if(foreign>4)issues.push(`외국인 최대 4명 · 현재 ${foreign}명`);
 const goalkeeper=byId(state.lineup[10]);
 if(starting.length===STARTERS&&(starting.filter(p=>p.position==='GK').length!==1||goalkeeper?.position!=='GK'))issues.push('선발 골키퍼 1명을 GK 자리에 배치');
 const ready=issues.length===0&&all.length===maxEntry;
 return {starting:starting.length,bench:bench.length,total:all.length,youth,startingYouth,foreign,benchGK,maxEntry,maxBench,issues,ready};
}
return {STARTERS,BENCH,normalize,at,set,place,isU22,assess};
});
