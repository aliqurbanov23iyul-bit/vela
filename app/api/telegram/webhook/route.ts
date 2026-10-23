import {NextResponse} from 'next/server';
import {tenantTx} from '../../../../src/server/db';
import {equal} from '../../../../src/server/security';
import {telegram} from '../../../../src/server/telegram';
import {telegramUpdate,telegramContext,processTelegramUpdate} from '../../../../src/server/telegram-update';
export async function POST(req:Request){
 const secret=process.env.TELEGRAM_WEBHOOK_SECRET;if(!secret||!equal(req.headers.get('x-telegram-bot-api-secret-token')??'',secret))return NextResponse.json({error:'Forbidden'},{status:403});
 const parsed=telegramUpdate.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({ok:true});const u=parsed.data,cb=u.callback_query;
 let context:ReturnType<typeof telegramContext>;
 try{context=telegramContext(u);}catch{
  if(u.message?.chat.type==='private'&&!u.message.from.is_bot){try{await telegram('sendMessage',{chat_id:u.message.chat.id,text:'👋 VELA-ya xoş gəldiniz!\n\n🔗 Hesabı bağlamaq üçün saytda Telegram bölməsindən kod yaradın və /start kod əmrini buraya göndərin.\nƏvvəl bağlamısınızsa, təsdiq mesajındakı 🟢 Bağlantı vəziyyəti düyməsini istifadə edin.'});}catch{return NextResponse.json({error:'Delivery unavailable'},{status:503});}}
  return NextResponse.json({ok:true});
 }
 try{
  const reply=await tenantTx(context.tenant,db=>processTelegramUpdate(db,u,context));
  if(reply){await telegram('sendMessage',{chat_id:cb?cb.from.id:u.message!.chat.id,...reply});await tenantTx(context.tenant,db=>db.query("INSERT INTO audit(tenant_id,event,data) VALUES($1,'TELEGRAM_REPLY_DELIVERED',$2)",[context.tenant,JSON.stringify({updateId:String(u.update_id)})]));}
  if(cb){await telegram('answerCallbackQuery',{callback_query_id:cb.id,text:'📝 Nəticə söhbətə göndərildi.'}).catch(()=>{});if(context.command==='callback')await telegram('editMessageReplyMarkup',{chat_id:cb.message!.chat.id,message_id:cb.message!.message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});}
  return NextResponse.json({ok:true});
 }catch(e){
  const code=e instanceof Error?e.message:'';const known=['PAIRING_REJECTED','UNAUTHORIZED','FORBIDDEN','EXPIRED_OR_CONSUMED'].includes(code)||(e as {code?:string})?.code==='23505';if(!known)return NextResponse.json({error:'Temporarily unavailable'},{status:503});
  const text=code==='EXPIRED_OR_CONSUMED'?'⌛ Bu təklifin vaxtı bitib və ya qərar artıq verilib.':code==='PAIRING_REJECTED'?'⚠️ Bağlantı kodu etibarsızdır və ya vaxtı bitib. Saytdan yeni kod yaradın.':'⚠️ Bu hesab üçün icazə yoxdur və ya Telegram başqa hesaba bağlıdır.';
  try{if(cb)await telegram('answerCallbackQuery',{callback_query_id:cb.id,text,show_alert:true});else await telegram('sendMessage',{chat_id:u.message!.chat.id,text});}catch{return NextResponse.json({error:'Delivery unavailable'},{status:503});}return NextResponse.json({ok:true});
 }
}
