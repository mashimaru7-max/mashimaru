export function journalUploadFile(file,maxBytes=64*1024*1024){
 if(!file?.size||file.size>maxBytes)throw Error(`사진은 한 장당 최대 ${Math.floor(maxBytes/1024/1024)}MB까지 올릴 수 있어요.`);
 const original=String(file.name||'').split(/[\\/]/).at(-1);
 if(!/\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(original))throw Error('사진 파일을 골라 주세요. 동시나 그림은 사진으로 찍어 첨부할 수 있어요.');
 const name=crypto.randomUUID()+'-'+original.replace(/[\x00-\x1f\x7f]/g,'').slice(-130);
 return new File([file],name,{type:file.type});
}
export async function uploadJournalPhoto(client,{target,id,file,maxBytes}){
 if(!['다온','라온'].includes(target)||!/^[a-f0-9-]{36}$/.test(id))throw Error('기록 대상을 확인해 주세요.');
 const photo=journalUploadFile(file,maxBytes);
 const root='우리라는이야기-성장기록',child=target+'-'+id;
 for(const [parent,name] of [['',root],[root,child]]){
  try{await client.fileOperation({action:'mkdir',parent,name});}
  catch(error){if(error.code!=='HTTP_409')throw error;await client.list(parent?parent+'/'+name:name);}
 }
 const folder=root+'/'+child;
 await client.upload(folder,photo);
 let offset=0;
 do{const data=await client.list(folder,offset);const item=data.items.find(i=>!i.dir&&i.name===photo.name);if(item?.revision)return {path:item.path,revision:item.revision};offset=data.next;}while(offset!==null&&offset!==undefined);
 throw Error('사진은 NAS에 올라갔지만 첨부 정보를 확인하지 못했어요. NAS 사진에서 연결해 주세요.');
}
