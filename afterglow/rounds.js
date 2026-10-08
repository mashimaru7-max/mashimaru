export const defaultRounds=()=>Array.from({length:5},(_,i)=>({target:90,timeLimit:0,enemyCount:[2,2,3,3,4][i],enemySpeed:1}));
export function validateRound(value){
 const limits={target:[50,94],timeLimit:[0,1800],enemyCount:[1,12],enemySpeed:[.25,3]},out={};
 for(const [key,[min,max]] of Object.entries(limits)){const n=value?.[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||key!=='enemySpeed'&&!Number.isInteger(n))throw new Error('라운드 설정값이 올바르지 않아.');out[key]=n;}
 return out;
}
export function validateRounds(values){if(!Array.isArray(values)||values.length<1||values.length>20)throw new Error('라운드는 1~20개로 설정해줘.');return values.map(validateRound);}
