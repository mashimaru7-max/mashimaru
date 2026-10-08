import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHmac,timingSafeEqual,pbkdf2Sync} from 'node:crypto';
import {defaultRounds,validateRounds} from '../rounds.js';
const verifier=JSON.parse(await readFile(new URL('./password-record.json',import.meta.url),'utf8'));
export async function createApi({dataDir,origin='https://mashimaru7-max.github.io',passwordVerifier=verifier}={}){
 await mkdir(dataDir,{recursive:true});const filename=join(dataDir,'afterglow.json'),keyfile=join(dataDir,'session-key');
 let secret;try{secret=await readFile(keyfile);}catch{secret=randomBytes(32);await writeFile(keyfile,secret,{mode:0o600});}
 let state;try{state=JSON.parse(await readFile(filename,'utf8'));validateRounds(state.rounds);}catch(e){if(e.code!=='ENOENT')throw e;state={rounds:defaultRounds(),images:{}};}
 let queue=Promise.resolve();const failures=new Map();
 async function commit(change){const operation=queue.then(async()=>{const next=structuredClone(state);change(next);await writeFile(filename+'.tmp',JSON.stringify(next),{mode:0o600});await rename(filename+'.tmp',filename);state=next;});queue=operation.catch(()=>{});return operation;}
 function signature(payload){return createHmac('sha256',secret).update(payload).digest('base64url');}
 function authorized(req){const token=req.headers.authorization?.replace(/^Bearer /,''),parts=token?.split('.');if(parts?.length!==2||!/^[0-9]+$/.test(parts[0])||Number(parts[0])<Date.now())return false;const expected=Buffer.from(signature(parts[0])),provided=Buffer.from(parts[1]);return provided.length===expected.length&&timingSafeEqual(provided,expected);}
 async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Object.assign(new Error('업로드 용량이 너무 커.'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
 return createServer(async(req,res)=>{
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','X-Content-Type-Options':'nosniff'};
 const send=(status,value)=>{res.writeHead(status,headers);res.end(JSON.stringify(value));};
 try{
  if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'허용되지 않은 접속이야.'});
  if(req.method==='OPTIONS'){res.writeHead(204,headers);return res.end();}
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/health'&&req.method==='GET')return send(200,{ok:true});
  if(path==='/config'&&req.method==='GET')return send(200,{rounds:state.rounds});
  if(path==='/login'&&req.method==='POST'){
   const ip=req.socket.remoteAddress,now=Date.now();if(failures.size>10000)for(const [key,value] of failures)if(now-value.at>600000)failures.delete(key);
   const attempts=failures.get(ip);if(attempts&&now-attempts.at<600000&&attempts.count>=10)return send(429,{error:'로그인 시도가 많아. 10분 후 다시 해줘.'});
   const {password}=JSON.parse((await body(req)).toString());let correct=false;
   if(typeof password==='string'&&password.length>=4&&password.length<=128){const hash=pbkdf2Sync(password,Buffer.from(passwordVerifier.salt),210000,32,'sha256');correct=timingSafeEqual(hash,Buffer.from(passwordVerifier.hash));}
   if(!correct){failures.set(ip,{count:attempts&&now-attempts.at<600000?attempts.count+1:1,at:attempts&&now-attempts.at<600000?attempts.at:now});return send(401,{error:'비밀번호가 맞지 않아.'});}
   failures.delete(ip);const payload=String(now+3600000);return send(200,{token:payload+'.'+signature(payload)});
  }
  const match=/^\/round\/(\d+)$/.exec(path),round=Number(match?.[1]);
  if(match&&(round<1||round>20))return send(400,{error:'라운드가 올바르지 않아.'});
  if(match&&req.method==='GET')return send(200,state.images[round]??{});
  if(!authorized(req))return send(401,{error:'관리자로 다시 로그인해줘.'});
  if(path==='/config'&&req.method==='PUT'){const rounds=validateRounds(JSON.parse((await body(req)).toString()).rounds);await commit(next=>{next.rounds=rounds;});return send(200,{ok:true});}
  if(match&&req.method==='DELETE'){await commit(next=>{delete next.images[round];});return send(200,{ok:true});}
  if(match&&req.method==='PUT'){
   const buffer=await body(req),form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']??''},body:buffer}).formData(),images={};
   for(const [key,file] of form){if(!['base','bonus'].includes(key)||!file.arrayBuffer||file.type!=='image/jpeg'||file.size>3*1024*1024)throw new Error('올바른 JPG 그림을 선택해줘.');const data=Buffer.from(await file.arrayBuffer());if(data[0]!==255||data[1]!==216||data[2]!==255)throw new Error('JPG 파일이 아니야.');images[key]='data:image/jpeg;base64,'+data.toString('base64');}
   await commit(next=>{next.images[round]=images;});return send(200,{ok:true});
  }
  return send(404,{error:'주소를 찾지 못했어.'});
 }catch(e){send(e.status??400,{error:e.status===413?e.message:'요청을 처리하지 못했어. 입력값과 파일을 확인해줘.'});}
 });
}
if(process.argv[1]===new URL(import.meta.url).pathname){const server=await createApi({dataDir:process.env.AFTERGLOW_DATA_DIR??'./data',origin:process.env.AFTERGLOW_ORIGIN??'https://mashimaru7-max.github.io'});server.listen(Number(process.env.PORT??8080),'0.0.0.0',()=>console.log('AFTERGLOW API ready'));}
