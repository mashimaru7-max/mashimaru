import {GitArtStore} from './git-art.js';
const ADMIN_PASSWORD={"salt":[98,21,29,248,70,159,73,78,0,248,236,113,150,78,111,36],"hash":[149,120,163,98,229,47,89,57,149,158,123,53,86,70,119,211,125,116,4,6,55,180,5,137,37,209,177,2,245,109,22,135]};
export async function passwordRecord(password,salt){if(typeof password!=='string'||password.length<4)throw new Error('비밀번호는 4자 이상으로 정해줘.');const bytes=salt?Uint8Array.from(salt):crypto.getRandomValues(new Uint8Array(16));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const hash=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes,iterations:210000,hash:'SHA-256'},key,256);return {salt:[...bytes],hash:[...new Uint8Array(hash)]};}
export async function passwordMatches(password,record){if(typeof password!=='string'||password.length<4)return false;const result=await passwordRecord(password,record.salt);let difference=0;for(let i=0;i<record.hash.length;i++)difference|=record.hash[i]^result.hash[i];return difference===0;}
export class ArtStore extends GitArtStore{
 constructor(){super();this.unlocked=false;}
 async login(password){if(!await passwordMatches(password,ADMIN_PASSWORD))throw new Error('비밀번호가 맞지 않아.');this.unlocked=true;}
 lock(){this.unlocked=false;}
}
