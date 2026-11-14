import {icon} from './icons.js?v=20261113-albumlook2';
const children=['함께','다온','라온'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const kinds=[['diary','성장 일기','학교에서 있었던 일, 새로 좋아하게 된 것'],['words','아이의 말','지나치기 아까운 한마디를 그대로'],['letter','부모의 편지','지금의 너에게, 미래의 너에게'],['measure','키와 몸무게','한 뼘씩 자라는 변화를 날짜와 함께']];
export function growthTabs(child){return `<div class="chips" aria-label="성장앨범 대상">${children.map(c=>`<button class="${c===child?'selected':''}" aria-pressed="${c===child}" data-action="child" data-value="${c}"><span class="child-avatar" aria-hidden="true">${c==='함께'?icon('heart'):c.slice(0,1)}</span><span>${c}</span></button>`).join('')}</div>`;}
export function childJournal(child,examples){
 if(!['다온','라온'].includes(child))throw new TypeError('기록 대상을 확인해 주세요.');
 return `<div class="page-title"><div><span class="eyebrow">WORDS WE KEEP, DAYS YOU GROW</span><h1><span class="title-emblem">${icon('sprout')}</span>너희의 모든 계절</h1><p>함께한 사진은 함께에, 너만의 이야기는 이곳에.</p></div></div>${growthTabs(child)}
 <section class="journal-intro"><div class="journal-copy"><span class="eyebrow">${child==='다온'?'DAON':'RAON'}’S STORYBOOK</span><h2>${child}의 기록장</h2><p>좋아하는 것이 바뀐 날도,<br>새로운 세상을 만난 날도.<br>사진 없이도 오래 남겨 두고 싶은 이야기.</p><button class="primary" data-action="journal-new" data-value="diary">기록 남기기</button><p class="fine">남긴 이야기는 가족 기록장에 함께 보관돼요.</p></div><div class="journal-notebook" aria-label="성장 기록 구성"><span class="journal-label">오늘의 한 페이지</span><h3>오늘의 ${child}에게</h3><div class="journal-rule"></div><div class="journal-rule"></div><p>아이의 말 한마디<br>부모가 기억하고 싶은 마음</p><div class="journal-rule"></div><span class="hand muted">너의 속도로, 천천히 ♡</span></div></section>
 <section class="journal-kinds" aria-label="기록 종류">${kinds.map(([key,title,sub])=>`<button data-action="journal-new" data-value="${key}"><span class="eyebrow">${key==='words'?'A LITTLE VOICE':key==='letter'?'DEAR YOU':key==='measure'?'GROWING DAYS':'DEAR DIARY'}</span><h3>${title}</h3><p>${sub}</p></button>`).join('')}</section>
 <section class="journal-record-section"><div id="journal-real-records" role="region" aria-label="저장한 성장 기록"><p role="status">기록 보관함을 확인하고 있어요…</p></div></section>
`;
}

export const JOURNAL_KINDS=Object.fromEntries(kinds.map(([key,label])=>[key,label]));
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
export function journalForm(child,kind='diary',item=null){
 if(!['다온','라온'].includes(child)||!JOURNAL_KINDS[kind])throw new TypeError('기록 대상을 확인해 주세요.');
 const r=item?.record||{},val=(key,fallback='')=>esc(r[key]??fallback);
 const date=label=>`<label>${label}<input name="date" type="date" value="${val('date',today())}" required></label>`;
 const area=(name,label,rows,max,required=false,placeholder='')=>`<label class="full">${label}<textarea name="${name}" rows="${rows}" maxlength="${max}" ${required?'required':''} placeholder="${placeholder}">${val(name)}</textarea></label>`;
 const author=`<label>작성자<select name="author">${['엄마','아빠','엄마와 아빠','가족'].map(a=>`<option ${a===(r.author||'엄마')?'selected':''}>${a}</option>`).join('')}</select></label>`;
 let fields,title;
 if(kind==='diary'){
  title=`${child}의 성장 일기`;
  fields=`<div class="form-grid">${date('기억할 날짜')}${author}<label class="full">오늘의 제목<input name="title" required maxlength="100" value="${val('title')}" placeholder="처음으로 혼자 해낸 날"></label><label class="full">주제<input name="topic" required maxlength="40" value="${val('topic','일상')}" placeholder="일상·학교·취미·여행·생일 등 자유롭게"></label>${area('body','무슨 일이 있었나요?',5,6000,true)}${area('feeling','오래 기억하고 싶은 마음 · 선택',2,2000)}</div>`;
 }else if(kind==='words'){
  title=`${child}이가 남긴 말`;
  fields=`<div class="journal-quote-sheet"><span class="journal-quote-mark" aria-hidden="true">“</span>${area('quote','아이가 말한 그대로',3,1000,true,'그 말투까지 기억하고 싶은 한마디')}</div><div class="form-grid">${date('그 말을 한 날짜')}${author}<label class="full">누구에게 한 말인가요? · 선택<input name="listener" maxlength="100" value="${val('listener')}" placeholder="엄마에게, 아빠에게…"></label>${area('context','그때 어떤 상황이었나요? · 선택',3,3000)}</div>`;
 }else if(kind==='letter'){
  title=`${child}에게 쓰는 편지`;
  fields=`<div class="form-grid">${date('편지를 쓰는 날')}${author}</div><div class="journal-letter-paper"><p class="journal-salutation">사랑하는 ${child}에게,</p>${area('body','편지 내용',8,10000,true,'지금 너에게 전하고 싶은 마음을 천천히 써 내려가요.')}<p class="journal-signature">너의 곁에서</p></div><label>나중에 함께 읽고 싶은 날 · 선택<input name="readOn" type="date" value="${val('readOn')}"></label>`;
 }else{
  title=`${child}의 키와 몸무게`;
  fields=`<div class="form-grid">${date('측정한 날짜')}${author}</div><div class="journal-measure-pair"><label><span>키</span><span class="journal-number"><input name="height" type="number" min="20" max="250" step="0.1" value="${val('height')}" placeholder="—"><span>cm</span></span></label><label><span>몸무게</span><span class="journal-number"><input name="weight" type="number" min="1" max="200" step="0.1" value="${val('weight')}" placeholder="—"><span>kg</span></span></label></div><p class="fine">키·몸무게 중 하나만 입력해도 괜찮아요.</p>${area('note','측정 메모 · 선택',2,1000,false,'집에서 아침에 측정, 학교 신체검사 등')}`;
 }
 return `<section class="journal-entry-preview journal-entry-${kind}"><span class="eyebrow">A PAGE FOR ${child==='다온'?'DAON':'RAON'}</span><h2>${title}${item?' 수정':''}</h2><p class="fine">${child}의 기록 · 저장하면 같은 NAS에 로그인한 가족도 볼 수 있어요. 작성자는 선택한 표시 이름이에요.</p><form id="family-journal-form">${fields}<details class="journal-attach-picker"><summary>NAS 사진 연결 · 선택 사항</summary><p class="fine">최대 6장. 원본은 그대로 두고 이 기록에 사진 위치만 연결해요.</p><div id="journal-selected-photos"></div><div id="journal-photo-browser"></div></details><p id="journal-form-error" role="alert"></p><button class="primary journal-preview-save" type="submit">${item?'수정 내용 저장':'기록 저장'}</button></form></section>`;
}
export function journalTitle(record){
 if(record.kind==='diary')return record.title;
 if(record.kind==='words')return record.quote.slice(0,45);
 if(record.kind==='letter')return record.target+'에게 쓰는 편지';
 return [record.height!==null?`키 ${record.height} cm`:'',record.weight!==null?`몸무게 ${record.weight} kg`:''].filter(Boolean).join(' · ');
}
export function journalRow(item){
 const r=item.record,excerpt=String(r.body||r.context||r.note||'').slice(0,130);
 return `<article class="journal-saved-row"><time datetime="${esc(r.date)}">${esc(r.date)}</time><div><span class="journal-kind-label">${JOURNAL_KINDS[r.kind]}</span><h3>${esc(journalTitle(r))}</h3>${excerpt?`<p>${esc(excerpt)}</p>`:''}<small>${esc(r.author)} 작성${r.attachments.length?' · 사진 '+r.attachments.length+'장':''}</small></div><button data-journal-open="${esc(item.id)}">${item.deleted?'휴지통 기록 보기':'기록 읽기'}</button></article>`;
}
export function journalDetails(item){
 const r=item.record;
 const paragraph=(label,text)=>text?`<section class="journal-detail-part"><h3>${label}</h3><p class="detail-body">${esc(text)}</p></section>`:'';
 let content='';
 if(r.kind==='diary')content=paragraph(esc(r.topic),r.body)+paragraph('기억하고 싶은 마음',r.feeling);
 if(r.kind==='words')content=`<blockquote class="journal-saved-quote">“${esc(r.quote)}”</blockquote>`+paragraph('누구에게',r.listener)+paragraph('그때의 상황',r.context);
 if(r.kind==='letter')content=`<div class="journal-letter-paper"><p class="journal-salutation">사랑하는 ${esc(r.target)}에게,</p><p class="detail-body">${esc(r.body)}</p><p class="journal-signature">${esc(r.author)}가</p></div>`+paragraph('다시 읽고 싶은 날',r.readOn);
 if(r.kind==='measure')content=`<div class="journal-measure-pair"><div><small>키</small><h2>${r.height===null?'미입력':esc(r.height)+' cm'}</h2></div><div><small>몸무게</small><h2>${r.weight===null?'미입력':esc(r.weight)+' kg'}</h2></div></div>`+paragraph('측정 메모',r.note);
 return `<span class="eyebrow">${JOURNAL_KINDS[r.kind]}${item.deleted?' · 휴지통':''}</span><h2>${esc(journalTitle(r))}</h2><p class="fine">${esc(r.target)} · ${esc(r.date)} · ${esc(r.author)} 작성</p>${content}<div id="journal-detail-photos"></div><p id="journal-detail-error" role="alert"></p><div class="detail-actions">${item.deleted?'<button class="primary" data-journal-restore>기록 복원</button>':'<button data-journal-edit>기록 수정</button><button data-journal-trash>휴지통으로 이동</button>'}</div>`;
}
