const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export function mediaEntries(items,filter='all'){
 return items.map((item,index)=>({item,index})).filter(({item})=>item.dir||filter==='all'||filter==='video'&&/\.(mp4|m4v|mov|webm)$/i.test(item.path)||filter==='photo'&&!/\.(mp4|m4v|mov|webm)$/i.test(item.path));
}
export function folderPeriod(path){
 const folders=path.split('/').slice(0,-1);let year=null,month=null;
 for(let i=0;i<folders.length;i++){
  const full=/^((?:19|20)[0-9]{2})[-.년 ](0?[1-9]|1[0-2])(?:월|[-. ]|$)/.exec(folders[i]);
  if(full){year=full[1];month=String(Number(full[2]));continue;}
  const y=/^((?:19|20)[0-9]{2})년?$/.exec(folders[i]);if(y){year=y[1];month=null;const m=/^(0?[1-9]|1[0-2])월/.exec(folders[i+1]||'');if(m)month=String(Number(m[1]));}
 }
 return year?year+'년'+(month?' '+month+'월':''):null;
}
export function infoHTML(path,info=null,{loading=false,unavailable=false}={}){
 const period=folderPeriod(path),captured=info?.capturedAt;
 const date=captured?`${captured.slice(0,4)}년 ${Number(captured.slice(5,7))}월 ${Number(captured.slice(8,10))}일`:period||'촬영일 미확인';
 const source=captured?'사진의 촬영정보':period?'폴더 이름 기준 · 촬영일과 다를 수 있어요':loading?'촬영정보 확인 중':unavailable?'촬영정보는 NAS 업데이트 후 확인할 수 있어요':'이 파일에서 촬영일을 확인하지 못했어요';
 const places=[...new Set((info?.trips||[]).map(t=>[t.country,t.city].filter(Boolean).join(' · ')))];
 const gps=info?.gps;const map=gps?`<a class="media-map-link" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${gps.lat}&amp;mlon=${gps.lng}#map=14/${gps.lat}/${gps.lng}">촬영 위치 지도 보기</a>`:'';
 return `<div><span class="media-info-label">날짜</span><strong>${esc(date)}</strong><small>${esc(source)}</small></div><div><span class="media-info-label">지역</span><strong>${esc(places.join(' / ')||(gps?'GPS 위치 있음':loading?'확인 중':unavailable?'업데이트 후 확인':'위치 미확인'))}</strong>${places.length?'<small>연결한 여행의 지역</small>':''}${map}</div>`;
}
