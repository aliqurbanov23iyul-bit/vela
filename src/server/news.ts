import {z} from 'zod';
export const newsItem=z.object({id:z.string(),source:z.string(),publishedAt:z.string().datetime(),eventAt:z.string().datetime(),currencies:z.array(z.string().length(3)),impact:z.enum(['LOW','MEDIUM','HIGH']),kind:z.enum(['SCHEDULED','BREAKING']),headline:z.string().max(1000)});
export interface NewsProvider {read(from:Date,to:Date):Promise<z.infer<typeof newsItem>[]>}
export class LicensedJsonFeed implements NewsProvider{
 constructor(private url:string,private apiKey:string) {if(!url.startsWith('https://'))throw Error('HTTPS_REQUIRED');}
 async read(from:Date,to:Date){const url=new URL(this.url);url.searchParams.set('from',from.toISOString());url.searchParams.set('to',to.toISOString());const r=await fetch(url,{headers:{Authorization:`Bearer ${this.apiKey}`},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('NEWS_UNAVAILABLE');return z.array(newsItem).parse(await r.json());}
}
export function newsBlackout(items:z.infer<typeof newsItem>[],currencies:string[],now:number,beforeMinutes:number,afterMinutes:number){return items.some(i=>i.impact==='HIGH'&&i.currencies.some(c=>currencies.includes(c))&&now>=Date.parse(i.eventAt)-beforeMinutes*60000&&now<=Date.parse(i.eventAt)+afterMinutes*60000);}
