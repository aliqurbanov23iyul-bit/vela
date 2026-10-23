import {NextResponse} from 'next/server';
import {telegram} from '../../../../src/server/telegram';

let cachedUrl:string|null=null;
let cachedAt=0;
let pending:Promise<string|null>|null=null;

export async function GET(){
 const now=Date.now();
 if(now-cachedAt<15*60_000)return NextResponse.json({url:cachedUrl},{headers:{'Cache-Control':'public, s-maxage=900, stale-while-revalidate=3600'}});
 if(!pending){
  pending=(async()=>{
   try{
    const bot=await telegram('getMe',{});
    return typeof bot.username==='string'&&/^[A-Za-z0-9_]{5,32}$/.test(bot.username)?`https://t.me/${bot.username}`:null;
   }catch{return null;}
  })();
 }
 const url=await pending;
 pending=null;
 cachedUrl=url;
 cachedAt=now;
 return NextResponse.json({url},{headers:{'Cache-Control':'public, s-maxage=900, stale-while-revalidate=3600'}});
}
