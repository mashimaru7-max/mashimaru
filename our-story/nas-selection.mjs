export function selectLoaded(selection,items,{folders=false}={}){
 for(const item of items)if(!item.dir||folders)selection.set(item.path,{...item});
 return selection.size;
}
export async function trashSelection(client,items,{active=()=>true,stop=()=>false,onProgress=()=>{},onSuccess=()=>{}}={}){
 const snapshot=items.map(item=>({...item})),failed=[];let completed=0,attempted=0;
 for(const item of snapshot){
  if(!active()||stop())break;
  attempted++;onProgress({attempted,total:snapshot.length,item});
  try{await client.trash(item);completed++;if(active())onSuccess(item);}
  catch(error){failed.push({item,message:error.message,code:error.code});if(['HTTP_401','HTTP_403','HTTP_501','HTTP_503','ABORT','TIMEOUT','FETCH','FORMAT','HTTP_500','HTTP_507','HTTP_405','HTTP_429'].includes(error.code)||/^HTTP_5/.test(error.code||''))break;}
 }
 return {completed,failed,unprocessed:snapshot.length-attempted};
}
