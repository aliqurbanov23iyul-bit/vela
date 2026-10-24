import {NextResponse} from 'next/server';
import {tenantTx} from '../../../../src/server/db';
import {equal} from '../../../../src/server/security';
import {telegram} from '../../../../src/server/telegram';
import {telegramUpdate,telegramContext,processTelegramUpdate} from '../../../../src/server/telegram-update';
export async function POST(req:Request){
 const secret=process.env.TELEGRAM_WEBHOOK_SECRET;if(!secret||!equal(req.headers.get('x-telegram-bot-api-secret-token')??'',secret))return NextResponse.json({error:'Forbidden'},{status:403});
 const parsed=telegramUpdate.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({ok:true});const u=parsed.data;
 const c=telegramContext(u);
 if(!c){
  if(u.callback_query){await telegram('answerCallbackQuery',{callback_query_id:u.callback_query.id,text:'VELA yalnız xəbər və bazar məlumatı paylaşır.'}).catch(()=>{});await telegram('editMessageReplyMarkup',{chat_id:u.callback_query.message?.chat.id,message_id:u.callback_query.message?.message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>{});}
  else if(u.message?.chat.type==='private'&&!u.message.from.is_bot){await telegram('sendMessage',{chat_id:u.message.chat.id,text:'👋 <b>VELA-ya xoş gəldiniz!</b>\n\n🔗 Saytda Telegram bölməsindən qısa müddətli kod yaradın, sonra onu /start keçidi ilə açın.\n\nℹ️ VELA xəbər və bazar baxışı göstərir. Ticarət əmri göndərilmir.',parse_mode:'HTML'}).catch(()=>{});}
  return NextResponse.json({ok:true});
 }
 try{const reply=await tenantTx(c.tenant,db=>processTelegramUpdate(db,u,c));if(reply)await telegram('sendMessage',reply);return NextResponse.json({ok:true});}
 catch(e){const known=e instanceof Error&&e.message==='PAIRING_REJECTED';if(!known)return NextResponse.json({error:'Temporarily unavailable'},{status:503});await telegram('sendMessage',{chat_id:c.telegramId,text:'⚠️ Bağlantı kodu etibarsızdır və ya vaxtı bitib. Saytdan yeni kod yaradın.'}).catch(()=>{});return NextResponse.json({ok:true});}
}

