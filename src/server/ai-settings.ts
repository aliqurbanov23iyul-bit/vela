import {z} from 'zod';
import type {PoolClient} from 'pg';
import {aiLimits} from './market';
export const providers=['GEMINI','GROQ','OPENROUTER'] as const;
export const preferenceInput=z.object({enabled:z.boolean(),symbols:z.array(z.enum(['EURUSD','XAUUSD'])).min(1).max(2).refine(a=>new Set(a).size===a.length),intervalMinutes:z.union([z.literal(15),z.literal(30),z.literal(60)])}).strict();
const model=z.string().max(128).regex(/^[a-zA-Z0-9_.:/@+\-]*$/);
export const serviceInput=z.object({order:z.array(z.enum(providers)).min(1).max(3).refine(a=>new Set(a).size===a.length),models:z.object({GEMINI:model,GROQ:model,OPENROUTER:model}).strict(),minInterval:z.union([z.literal(15),z.literal(30),z.literal(60)]),dailyLimit:z.number().int().min(0).max(288)}).strict();
export async function resolveAIConfig(db:PoolClient,defaults=aiLimits()){
 const pref=(await db.query('SELECT enabled,symbols,interval_minutes FROM ai_preferences LIMIT 1')).rows[0];
 const service=(await db.query('SELECT provider_order,models,min_interval_minutes,daily_limit FROM ai_service_settings WHERE id=1')).rows[0];
 const order:string[]=service?.provider_order??(process.env.AI_PROVIDER_ORDER??'GEMINI,GROQ,OPENROUTER').split(',').map(x=>x.trim()).filter(x=>providers.includes(x as typeof providers[number]));
 const models:Record<string,string>={};const configured:Record<string,boolean>={};
 for(const p of providers){models[p]=service?.models?.[p]||process.env[p+'_MODEL']||'';configured[p]=!!(models[p]&&process.env[p+'_API_KEY']);}
 const minInterval=service?.min_interval_minutes??defaults.intervalMinutes,dailyLimit=service?.daily_limit??defaults.daily;
 const preference={enabled:pref?.enabled??true,symbols:(pref?.symbols??['EURUSD','XAUUSD']) as string[],intervalMinutes:pref?.interval_minutes??Math.max(30,minInterval)};
 return {preference,service:{order,models,configured,minInterval,dailyLimit},effectiveInterval:Math.max(minInterval,preference.intervalMinutes),ready:order.some(p=>configured[p])};
}
