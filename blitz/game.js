
(()=>{
  const root=document.getElementById('blitz-circle');
  const q=s=>root.querySelector(s), qa=s=>[...root.querySelectorAll(s)];
  const symbols=['✳','◆','●','▲','✚','★'];
  const tones=['var(--red)','var(--blue)','var(--green)','var(--orange)','var(--purple)','var(--yellow)'];
  const packs={"basic": {"name": "기본", "topics": ["동물", "과일", "탈것", "음식", "운동", "나라", "직업", "꽃", "악기", "가구", "채소", "곤충", "새", "물건", "옷", "장소", "음료", "바다 생물", "가전제품", "학용품", "장난감", "간식", "나무", "색깔", "가족", "과자", "신발", "운동용품", "날씨", "몸의 일부", "학교 물건", "욕실 물건", "주방 도구", "놀이", "영화", "책", "도시", "반찬", "빵", "면 요리", "유제품", "동화 속 인물", "교통수단", "전자제품", "겨울 물건", "여름 물건", "동네 가게", "소리", "기념일", "감정", "도형", "우주", "공룡", "생선"]}, "daily": {"name": "생활", "topics": ["아침 식사", "점심 메뉴", "저녁 메뉴", "국·찌개", "분식", "배달 음식", "길거리 음식", "디저트", "아이스크림", "떡", "과일 음료", "학교 급식", "편의점 음식", "김밥 재료", "피자 토핑", "샌드위치 재료", "라면에 넣는 것", "샐러드 재료", "냉장고 속 음식", "마트에서 파는 것", "문구점 물건", "가방 속 물건", "필통 속 물건", "책상 위 물건", "침실 물건", "거실 물건", "청소 도구", "빨래할 때 쓰는 것", "목욕할 때 쓰는 것", "외출 준비물", "비 오는 날 필요한 것", "소풍 준비물", "여행 준비물", "캠핑 준비물", "물놀이 준비물", "운동회 종목", "쉬는 시간 놀이", "놀이터 놀이기구", "생일 선물", "생일 파티 음식", "집안일", "학교에서 하는 일", "주말에 하는 일", "잠들기 전 하는 일", "아침에 하는 일", "공원에서 보는 것", "시장 가게", "병원에서 보는 것", "식당에서 보는 것", "버스 안의 물건", "지하철에서 보는 것", "도로 위에서 보는 것", "공항에서 보는 것", "농장에서 보는 것"]}, "challenge": {"name": "상상·도전", "topics": ["날 수 있는 것", "물에 뜨는 것", "빨간 것", "파란 것", "노란 것", "초록색인 것", "동그란 것", "네모난 것", "길쭉한 것", "뾰족한 것", "부드러운 것", "딱딱한 것", "차가운 것", "뜨거운 것", "달콤한 것", "신맛이 나는 것", "매운 것", "냄새가 강한 것", "반짝이는 것", "투명한 것", "소리가 큰 것", "조용히 해야 하는 곳", "빠르게 움직이는 것", "천천히 움직이는 것", "아주 작은 것", "아주 큰 것", "짝으로 쓰는 것", "손으로 만드는 것", "버튼이 있는 것", "바퀴가 있는 것", "문이 있는 것", "날개가 있는 것", "꼬리가 있는 동물", "줄무늬 동물", "밤에 활동하는 동물", "알에서 태어나는 동물", "땅속에 사는 것", "높은 곳에 있는 것", "바닷속에서 보는 것", "우주여행 준비물", "마법사가 쓰는 것", "보물상자 속 물건", "무인도에 가져갈 것", "거인이 쓰는 물건", "로봇이 할 수 있는 일", "공룡 이름", "괴물의 특징", "슈퍼히어로 능력", "미래의 발명품", "동화 속 장소", "축제에서 보는 것", "사람을 웃게 하는 것", "두 글자 음식", "세 글자 동물"]}};
  const letters=['나','가','기','바','마','리','수','물','사','하','고','비','시','구','오','차','대','소'];
  const defaultNames=['아빠','다온','라온','엄마'];
  let rosterNames=[...defaultNames];
  const playerName=i=>rosterNames[state.order[i]]||'플레이어 '+(i+1);
  function readNames(){rosterNames=rosterNames.map((_,i)=>q('#bt-name-'+i).value.trim().slice(0,12)||defaultNames[i]);rosterNames.forEach((name,i)=>q('#bt-name-'+i).value=name)}
  function participants(){return qa('input[name="participant"]:checked').map(e=>+e.value)}
  function syncParticipants(){const n=+q('#bt-count').value,chosen=participants().slice(0,n);for(const input of qa('input[name="participant"]'))if(chosen.length<n&&!chosen.includes(+input.value))chosen.push(+input.value);qa('input[name="participant"]').forEach(input=>input.checked=chosen.includes(+input.value))}
  function updateRoster(){const n=+q('#bt-count').value,chosen=participants();q('#bt-roster-status').textContent='참가자 '+chosen.length+' / '+n+'명 선택'+(chosen.length===n?' · 새 게임을 누르면 적용돼.':' · '+n+'명을 골라줘.');qa('input[name="participant"]').forEach(input=>input.disabled=!input.checked&&chosen.length>=n)}
  function applyNames(){readNames();const wasOpen=!q('#bt-judge').hidden;closeJudge();draw();if(wasOpen&&!state.finished)openJudge();q('#bt-name-status').textContent='이름 적용 완료';BoardUI.toast('이름을 적용했어')}
  let state,history=[],busy=false,run=0,sound=false,audio;
  const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tone(kind){if(!sound)return;try{audio=audio||new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});const osc=audio.createOscillator(),gain=audio.createGain();osc.connect(gain);gain.connect(audio.destination);osc.type='sine';osc.frequency.setValueAtTime(kind==='wild'?660:kind==='win'?880:400,audio.currentTime);osc.frequency.exponentialRampToValueAtTime(kind==='win'?1320:kind==='wild'?990:260,audio.currentTime+.1);gain.gain.setValueAtTime(.045,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.16);osc.start();osc.stop(audio.currentTime+.17)}catch{}}
  function snapshot(){history.push(JSON.stringify(state))}
  function closeJudge(){qa('.opponent-choice').forEach(panel=>{panel.hidden=true;panel.replaceChildren()});q('#bt-judge').hidden=true;q('#bt-record').setAttribute('aria-expanded','false')}
  function pairs(){const result=[];for(let i=0;i<state.n;i++)for(let j=i+1;j<state.n;j++){const a=state.h[i].at(-1),b=state.h[j].at(-1);if(a&&b&&(a.s===b.s||(state.w&&state.w.includes(a.s)&&state.w.includes(b.s))))result.push([i,j])}return result}
  function pulse(el,cls){if(!el||reduced())return;el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls)}
  function particles(target){if(reduced())return;const rect=target.getBoundingClientRect(),base=root.getBoundingClientRect();for(let i=0;i<10;i++){let dot=document.createElement('span');dot.className='burst-dot';dot.style.left=rect.left-base.left+rect.width/2+'px';dot.style.top=rect.top-base.top+rect.height/2+'px';dot.style.setProperty('--dx',Math.cos(i*.628)*95+'px');dot.style.setProperty('--dy',Math.sin(i*.628)*75+'px');dot.style.setProperty('--spin',i*65+'deg');dot.style.background=['#ffcc4b','#8066ee','#f56b80','#32aa92'][i%4];root.append(dot);setTimeout(()=>dot.remove(),650)}}
  function fly(from,to,kind){if(reduced())return;const a=from.getBoundingClientRect(),b=to.getBoundingClientRect(),base=root.getBoundingClientRect();if(!a.width||!b.width)return;const card=document.createElement('div');card.className='flying-card '+kind;card.textContent=kind==='collect'?'+1':'ϟ';card.style.left=a.left-base.left+a.width/2-23+'px';card.style.top=a.top-base.top+a.height/2-30+'px';card.style.setProperty('--fly-x',b.left+b.width/2-a.left-a.width/2+'px');card.style.setProperty('--fly-y',b.top+b.height/2-a.top-a.height/2+'px');root.append(card);setTimeout(()=>card.remove(),450)}
  function draw(){
    root.dataset.players=String(state.n);
    const left=state.d[0].length,right=state.d[1].length,total=left+right;
    q('#bt-order-display').textContent='진행 순서: '+Array.from({length:state.n},(_,i)=>playerName(i)).join(' → ');
    q('#bt-total').textContent=total;q('#bt-initial').textContent=state.initial;q('#bt-left').textContent=left;q('#bt-right').textContent=right;
    qa('[data-deck]').forEach(b=>b.disabled=!state.d[+b.dataset.deck].length||busy);
    q('#bt-meta').textContent=(state.mode==='topic'?'주제 대결':'한글자 대결')+' · '+state.n+'명 · '+(state.mode==='topic'?state.packs.map(id=>packs[id].name).join(' + '):'글자 카드');
    qa('.seat').forEach(seat=>{const i=+seat.dataset.p;const current=total>0&&i===state.turn;seat.classList.toggle('is-turn',current);if(current)seat.setAttribute('aria-current','step');else seat.removeAttribute('aria-current');seat.querySelector('.turn-badge').textContent=state.extra?'한 장 더!':'내 차례';seat.hidden=i>=state.n;seat.querySelector('strong').textContent=playerName(i);seat.querySelector('small').textContent='획득 '+state.scores[i]+'장';const face=seat.querySelector('.place'),c=state.h[i].at(-1);face.classList.toggle('face',!!c);face.replaceChildren();if(c){face.style.setProperty('--cardtone',tones[c.s]);for(const cls of ['corner','corner bottom']){let e=document.createElement('span');e.className=cls;e.textContent=symbols[c.s];if(c.s===2)e.dataset.shape='circle';face.append(e)}let sym=document.createElement('span');sym.className='big-symbol';sym.textContent=symbols[c.s];if(c.s===2){sym.dataset.shape='circle';sym.setAttribute('role','img');sym.setAttribute('aria-label','원')}let word=document.createElement('strong');word.className='topic';word.textContent=c.t;let count=document.createElement('span');count.className='stack-count';count.textContent=state.h[i].length+'장';face.append(sym,word,count)}else{const e=document.createElement('img');e.className='empty-nunsongi';e.src='../boardgames/assets/nunsongi.webp';e.alt='';e.width=54;e.height=58;const t=document.createElement('span');t.className='empty-text';t.textContent='카드를 기다리는 중';face.append(e,t)}});
    q('#bt-wild').classList.toggle('active',!!state.w);const wildPair=q('#bt-wild .wild-pair');wildPair.replaceChildren();if(state.w){state.w.forEach((i,index)=>{if(index)wildPair.append(document.createTextNode('↔'));const mark=document.createElement('span');mark.textContent=symbols[i];if(i===2){mark.dataset.shape='circle';mark.setAttribute('role','img');mark.setAttribute('aria-label','원')}wildPair.append(mark)})}else wildPair.textContent='ϟ';q('#bt-wild .wild-label').textContent=state.w?'이 두 기호도 대결':'특수카드 자리';q('#bt-wild-caption').textContent=state.w?'다음 특수카드까지 유지':'기호가 달라도 연결!';
    q('#bt-turn').textContent=total?playerName(state.turn)+(state.extra?' · 한 장 더!':' 차례'):(state.finished?'게임 종료':'마지막 대결 진행 중');
    q('#bt-turn-top').textContent=total?playerName(state.turn)+(state.extra?' · 특수카드! 한 장 더 뒤집어줘':' 차례 · 카드를 뒤집어줘'):(state.finished?'게임 종료 · 결과를 확인해줘':'마지막 대결 중 · 승자 자리를 탭해줘');
    q('#bt-instruction').textContent=total?(state.extra?'같은 사람이 더미를 눌러 추가 공개':'먼저 답한 사람의 자리를 탭하면 승리 기록!'):'연쇄 대결까지 기록한 뒤 ‘대결 끝 · 결과 보기’를 눌러줘';
    q('#bt-undo').disabled=!history.length||busy;
    updateBattleTargets();drawResult(total);q('#bt-record').disabled=!!state.finished;
    q('#bt-note').textContent='일반 54장 + 특수 6장 · 전체 무작위 섞기 · '+(state.mode==='topic'?'직접 구성한 주제 세트':'한글자 모드');
  }
  function drawResult(total){
    q('#bt-end-battle').hidden=total>0||!!state.finished;
    const panel=q('#bt-result');panel.hidden=total>0||!state.finished;if(panel.hidden)return;
    const highest=Math.max(...state.scores.slice(0,state.n)),winners=state.scores.slice(0,state.n).map((score,i)=>score===highest?i:-1).filter(i=>i>=0),final=state.finished||pairs().length===0;
    q('#bt-result-title').textContent=(final?(winners.length>1?'공동 우승 · ':'우승 · '):'현재 선두 · ')+winners.map(playerName).join(' · ');
    q('#bt-result-note').textContent=final?'최고 점수 '+highest+'장! 수고했어 🎉':'아직 대결이 남아 있어요. 승패를 기록하면 순위가 바뀔 수 있어요.';
    const list=q('#bt-scores');list.replaceChildren();
    const ranking=state.scores.slice(0,state.n).map((score,i)=>({score,i})).sort((a,b)=>b.score-a.score);
    for(const item of ranking){const row=document.createElement('li');row.className=item.score===highest?'winner':'';const rank=document.createElement('span');rank.textContent=(1+ranking.filter(r=>r.score>item.score).length)+'위';const name=document.createElement('strong');name.textContent=playerName(item.i);const score=document.createElement('b');score.textContent=item.score+'장';row.append(rank,name,score);list.append(row)}
    q('#bt-edit-result').hidden=!state.finished;
  }
  function shuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
  function selectedPacks(){return qa('input[name="card-pack"]:checked').map(e=>e.value)}
  function updatePackStatus(){
    const ids=selectedPacks(),letter=q('#bt-mode').value==='letter';
    q('#bt-pack-options').disabled=letter;
    const valid=participants().length===+q('#bt-count').value,invalid=(!letter&&!ids.length)||!valid;updateRoster();q('#bt-start-family').disabled=invalid;q('#bt-result-new').disabled=invalid;
    q('#bt-apply-packs').disabled=invalid;
    q('#bt-reset').disabled=invalid;
    q('#bt-pack-status').textContent=letter?'한글자 모드는 글자 카드 54장 + 특수 6장으로 진행해요.':!ids.length?'세트를 하나 이상 골라줘.':ids.map(id=>packs[id].name).join(' + ')+' · '+(ids.length===1?'주제 54장':'세트별 '+(54/ids.length)+'장')+' + 특수 6장. 새 게임을 누르면 적용돼요.';
  }
  function reset(){
    const n=+q('#bt-count').value,mode=q('#bt-mode').value,ids=selectedPacks();
    updatePackStatus();if((mode==='topic'&&!ids.length)||participants().length!==n)return;readNames();const order=q('#bt-order-mode').value==='random'?shuffle(participants()):participants();
    run++;busy=false;qa('.flying-card,.burst-dot').forEach(e=>e.remove());
    const chosen=mode==='topic'?shuffle(ids).flatMap(id=>shuffle(packs[id].topics).slice(0,54/ids.length).map(t=>({t,pack:id}))):Array.from({length:54},(_,i)=>({t:letters[i%letters.length]}));
    const cards=shuffle(chosen).map((c,i)=>({...c,s:i%6}));
    const wilds=[[0,1],[2,3],[4,5],[0,2],[1,3],[2,4]].map(wild=>({wild}));
    const all=shuffle([...cards,...wilds]),d=[[],[]];all.forEach((c,i)=>d[i%2].push(c));
    state={n,mode,order,finished:false,packs:[...ids],d,h:[[],[],[],[]],scores:[0,0,0,0],w:null,wilds:[],turn:0,extra:false,initial:all.length};history=[];closeJudge();draw();
  }
  function reveal(di,button){
    if(busy||!state.d[di].length)return;
    // Human players call and resolve duels. Merely matching symbols must never lock the deck.
    snapshot();closeJudge();const c=state.d[di].shift(),who=state.turn;
    if(c.wild){state.w=c.wild;state.wilds.push(c);state.extra=true}else{state.h[who].push(c);state.turn=(who+1)%state.n;state.extra=false}
    const generation=run;busy=true;draw();const target=c.wild?q('#bt-wild'):q('[data-p="'+who+'"] .place');fly(button,target,'deal');pulse(target,c.wild?'wild-enter':'card-enter');if(c.wild)particles(target);pulse(q('#bt-total'),'number-pop');tone(c.wild?'wild':'flip');
    setTimeout(()=>{if(generation!==run)return;busy=false;drawButtons()},reduced()?0:280);
  }
  function drawButtons(){qa('[data-deck]').forEach(b=>b.disabled=!state.d[+b.dataset.deck].length||busy);q('#bt-undo').disabled=!history.length||busy;updateBattleTargets()}
  function updateBattleTargets(){
    const eligible=new Set(pairs().flat());
    qa('.seat').forEach(seat=>{const i=+seat.dataset.p,active=i<state.n&&!busy&&!state.finished&&eligible.has(i);seat.classList.toggle('can-win',active);seat.querySelector('.tap-win').hidden=!active;
      if(active){seat.setAttribute('role','button');seat.setAttribute('tabindex','0');seat.setAttribute('aria-label',playerName(i)+' 승리 기록')}else{seat.removeAttribute('role');seat.removeAttribute('tabindex');seat.removeAttribute('aria-label')}
    });
  }
  function awardWin(w,l){
    if(busy||state.finished||!pairs().some(([a,b])=>(a===w&&b===l)||(a===l&&b===w)))return;
    snapshot();const source=q('[data-p="'+l+'"] .place'),destination=q('[data-p="'+w+'"] .avatar');
    fly(source,destination,'collect');state.h[l].pop();state.scores[w]++;closeJudge();busy=true;const generation=run;draw();pulse(q('[data-p="'+w+'"] .player'),'score-pop');pulse(source,'card-enter');particles(destination);tone('win');
    setTimeout(()=>{if(generation!==run)return;busy=false;drawButtons()},reduced()?0:350);
  }
  function selectWinner(w){
    if(busy||state.finished)return;
    const opponents=pairs().filter(pair=>pair.includes(w)).map(([a,b])=>a===w?b:a);
    if(!opponents.length)return;
    if(opponents.length===1){awardWin(w,opponents[0]);return}
    const panel=q('[data-p="'+w+'"] .opponent-choice'),wasOpen=!panel.hidden;closeJudge();if(wasOpen)return;panel.hidden=false;
    const prompt=document.createElement('p');prompt.textContent=playerName(w)+' 승리! 누구와의 대결이었어?';panel.append(prompt);
    for(const l of opponents){const btn=document.createElement('button');btn.className='action main';btn.type='button';btn.textContent=playerName(l)+'에게 승리';btn.onclick=e=>{e.stopPropagation();awardWin(w,l)};panel.append(btn)}
    const cancel=document.createElement('button');cancel.className='action';cancel.type='button';cancel.textContent='취소';cancel.onclick=e=>{e.stopPropagation();closeJudge()};panel.append(cancel);
  }
  function openJudge(){if(busy||state.finished)return;if(!q('#bt-judge').hidden){closeJudge();return}q('#bt-judge').hidden=false;q('#bt-record').setAttribute('aria-expanded','true');q('#bt-pairs').replaceChildren();const ps=pairs(),total=state.d[0].length+state.d[1].length;
    q('.judge-title').textContent=ps.length?'누가 먼저 정답을 말했어?':total?'승패 기록':'최종 점수';
    q('#bt-message').textContent=ps.length?'목소리로 겨룬 뒤 승자만 골라주세요.':total?'현재 기록할 대결이 없어요. 카드를 계속 공개하세요.':state.scores.map((s,i)=>playerName(i)+' '+s+'장').slice(0,state.n).join(' · ');
    for(const [a,b] of ps)for(const [w,l] of [[a,b],[b,a]]){const btn=document.createElement('button');btn.className='action cursor-interaction';btn.type='button';btn.textContent=playerName(w)+' 승리 ← '+playerName(l);btn.onclick=()=>awardWin(w,l);q('#bt-pairs').append(btn)}
    pulse(q('#bt-judge'),'panel-enter');
  }
  qa('[data-deck]').forEach(b=>b.onclick=()=>reveal(+b.dataset.deck,b));
  qa('.seat').forEach(seat=>{seat.onclick=e=>{if(e.target.closest('.opponent-choice'))return;selectWinner(+seat.dataset.p)};seat.onkeydown=e=>{if(e.target!==seat||!['Enter',' '].includes(e.key))return;e.preventDefault();selectWinner(+seat.dataset.p)}});
  q('#bt-record').onclick=openJudge;
  q('#bt-undo').onclick=()=>{if(busy||!history.length)return;state=JSON.parse(history.pop());closeJudge();draw()};
  q('#bt-mode').onchange=updatePackStatus;q('#bt-count').onchange=()=>{syncParticipants();updatePackStatus();q('#bt-family-settings').open=true};
  async function startNewGame(){if(state.initial-state.d[0].length-state.d[1].length>0&&!state.finished){if(!await BoardUI.confirmAction('새 게임을 시작할까?','지금 게임의 진행과 점수는 사라져. 선택한 설정으로 다시 시작해.','새 게임 시작'))return}reset();q('#bt-settings').close();BoardUI.toast('새 게임 준비 완료!')}
  q('#bt-reset').onclick=startNewGame;
  q('#bt-close-settings').onclick=()=>q('#bt-settings').close();
  q('#bt-save-names').onclick=applyNames;
  q('#bt-start-family').onclick=startNewGame;
  qa('input[name="participant"]').forEach(input=>input.onchange=updatePackStatus);
  qa('[data-move]').forEach(button=>button.onclick=()=>{const row=button.closest('[data-name-row]'),list=q('#bt-roster'),rows=qa('[data-name-row]'),index=rows.indexOf(row);if(button.dataset.move==='up'&&index>0)list.insertBefore(row,rows[index-1]);if(button.dataset.move==='down'&&index<rows.length-1)list.insertBefore(rows[index+1],row);updatePackStatus()});

  q('#bt-result-new').onclick=startNewGame;
  q('#bt-finish').onclick=()=>{if(busy||state.d[0].length+state.d[1].length)return;snapshot();state.finished=true;closeJudge();draw()};
  q('#bt-edit-result').onclick=()=>{snapshot();state.finished=false;closeJudge();draw()};
  q('#bt-apply-packs').onclick=startNewGame;
  qa('input[name="card-pack"]').forEach(e=>e.onchange=updatePackStatus);
  q('#bt-sound').onclick=()=>{sound=!sound;q('#bt-sound').setAttribute('aria-pressed',String(sound));q('#bt-sound').textContent=sound?'♪ 효과음 켜짐':'♪ 효과음 꺼짐';if(sound)tone('flip')};
  syncParticipants();reset();
})();

