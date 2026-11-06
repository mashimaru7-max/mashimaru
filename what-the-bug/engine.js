(function(root){
 const clone=x=>JSON.parse(JSON.stringify(x));
 function shuffle(a,rng){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
 function drawBoard(state,data,rng){let pool=state.difficulty==='spicy'?data.spicy:state.difficulty==='mixed'?[...data.easy,...data.spicy]:data.easy;const traits=shuffle(pool,rng).slice(0,6),bugs=shuffle(data.bugs,rng);state.board=traits.map((trait,i)=>({trait,...bugs[i]}));state.used=[]}
 function problem(state,rng){let options=[];for(let a=0;a<6;a++)for(let b=0;b<6;b++)if(!state.used.includes(a+':'+b))options.push([a,b]);const pair=options[Math.floor(rng()*options.length)];state.problem=pair;state.used.push(pair.join(':'));state.attempted=[];state.outcome=null;state.phase='ready'}
 function create(config,data,rng=Math.random){if(config.names.length<2||config.names.length>6)throw Error('2~6명이 필요해');const names=config.names.map((n,i)=>String(n).trim().slice(0,12)||'친구 '+(i+1));const state={version:1,names:config.random?shuffle(names,rng):names,difficulty:['easy','spicy','mixed'].includes(config.difficulty)?config.difficulty:'easy',turn:0,limit:names.length*(names.length===2?5:3),tokens:names.map(()=>[]),successes:0,board:[],used:[],problem:[],attempted:[],phase:'ready',outcome:null};drawBoard(state,data,rng);problem(state,rng);return state}
 function actor(s){return s.turn%s.names.length}
 function begin(s){if(s.phase!=='ready')return false;s.phase='acting';return true}
 function wrong(s,index){if(s.phase!=='acting'||!Number.isInteger(index)||index<0||index>=s.names.length||index===actor(s)||s.attempted.includes(index))return false;s.attempted.push(index);if(s.attempted.length===s.names.length-1){s.phase='resolved';s.outcome={success:false,reason:'all-wrong'}}return true}
 function correct(s,index,rng=Math.random){if(s.phase!=='acting'||!Number.isInteger(index)||index<0||index>=s.names.length||index===actor(s)||s.attempted.includes(index))return false;s.phase='resolved';s.successes++;s.outcome={success:true,solver:index};if(s.names.length>2){s.tokens[actor(s)].push(1+Math.floor(rng()*3));s.tokens[index].push(1+Math.floor(rng()*3))}return true}
 function pass(s){if(s.phase!=='acting')return false;s.phase='resolved';s.outcome={success:false,reason:'pass'};return true}
 function next(s,data,rng=Math.random){if(s.phase!=='resolved')return false;s.turn++;if(s.turn>=s.limit){s.phase='finished';return true}if(s.turn%s.names.length===0)drawBoard(s,data,rng);problem(s,rng);return true}
 function ranking(s){return s.names.map((name,i)=>({name,i,score:s.tokens[i].reduce((a,b)=>a+b,0),count:s.tokens[i].length})).sort((a,b)=>b.score-a.score)}
 const api={create,actor,begin,wrong,correct,pass,next,ranking,clone};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BugEngine=api;
})(typeof window==='undefined'?globalThis:window);
