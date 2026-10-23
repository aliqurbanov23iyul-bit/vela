import {randomBytes} from 'node:crypto';
export const compact=(uuid:string)=>Buffer.from(uuid.replaceAll('-',''),'hex').toString('base64url');
export function expand(value:string){const h=Buffer.from(value,'base64url').toString('hex');if(h.length!==32)throw Error('INVALID_UUID');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export const pairingCode=()=>randomBytes(16).toString('base64url');
export async function telegram(method:'sendMessage'|'answerCallbackQuery',payload:unknown){const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw Error('TELEGRAM_UNCONFIGURED');const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('TELEGRAM_UNAVAILABLE');const result=await r.json();if(!result.ok)throw Error('TELEGRAM_REJECTED');return result.result;}
