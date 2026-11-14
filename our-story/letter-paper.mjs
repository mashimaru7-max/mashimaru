// Versioned presentation metadata in the existing letter body keeps older NAS APIs compatible.
export const PAPERS=[
 ['classic','크림 노트'],['blossom','벚꽃 편지'],['garden','작은 꽃밭'],['olive','올리브 가지'],['lavender','라벤더 향기'],
 ['sky','맑은 하늘'],['stars','별에게 보내는 밤'],['moon','달빛 한 장'],['sea','바다의 편지'],['peach','복숭아빛 마음'],
 ['rose','장미빛 약속'],['lemon','레몬 한 조각'],['forest','초록 숲속'],['autumn','가을 산책'],['snow','포근한 겨울'],
 ['rainbow','무지개 우체국'],['gingham','소풍 가는 날'],['watercolor','물든 하루'],['heart','작은 하트'],['postcard','오래된 엽서']
];
const ids=new Set(PAPERS.map(([id])=>id));
const prefix='[OUR-STORY-LETTER:v1:';
export function readLetter(body=''){
 const text=String(body),match=text.match(/^\[OUR-STORY-LETTER:v1:([a-z]+)\]\n\n/);
 return match&&ids.has(match[1])?{paper:match[1],text:text.slice(match[0].length)}:{paper:'classic',text};
}
export function writeLetter(text,paper='classic'){
 if(!ids.has(paper))throw Error('편지지를 다시 선택해 주세요.');
 if(!String(text).trim())throw Error('편지 내용을 적어 주세요.');
 const result=paper==='classic'&&!String(text).startsWith(prefix)?String(text):`${prefix}${paper}]\n\n${text}`;
 if(result.length>10000)throw Error('편지는 편지지 정보를 포함해 10,000자까지 저장할 수 있어요. 내용을 조금 줄여 주세요.');
 return result;
}
export function paperPicker(paper='classic'){
 if(!ids.has(paper))paper='classic';
 return `<input type="hidden" name="paper" value="${paper}"><details class="stationery-picker"><summary>편지지 고르기 · <span data-paper-name>${PAPERS.find(([id])=>id===paper)[1]}</span><small>20가지 디자인</small></summary><div class="stationery-grid" role="group" aria-label="편지지 디자인">${PAPERS.map(([id,name])=>`<button type="button" data-paper-choice="${id}" aria-pressed="${id===paper}"><span class="stationery-swatch" data-paper="${id}" aria-hidden="true"><i></i><i></i><i></i></span><span>${name}</span></button>`).join('')}</div></details>`;
}
export function bindPaperPicker(form,onChange=()=>{}){
 const picker=form.querySelector('.stationery-picker');if(!picker)return;
 picker.addEventListener('click',event=>{
  const button=event.target.closest('[data-paper-choice]');if(!button||button.disabled)return;
  const paper=button.dataset.paperChoice;if(!ids.has(paper))return;
  form.elements.paper.value=paper;form.querySelector('.journal-letter-paper').dataset.paper=paper;
  picker.querySelector('[data-paper-name]').textContent=PAPERS.find(([id])=>id===paper)[1];
  picker.querySelectorAll('[data-paper-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  picker.open=false;picker.querySelector('summary').focus();onChange();
 });
}
