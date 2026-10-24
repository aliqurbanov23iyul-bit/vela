import type {PoolClient} from 'pg';
import {z} from 'zod';
import {digest} from './security';
import {expand} from './telegram';
const person=z.object({id:z.number().int(),is_bot:z.boolean()});
export const telegramUpdate=z.object({update_id:z.number().int(),message:z.object({from:person,chat:z.object({id:z.number().int(),type:z.string()}),text:z.string()}).optional(),callback_query:z.object({id:z.string(),from:person,data:z.string(),message:z.object({message_id:z.number().int(),chat:z.object({id:z.number().int(),type:z.string()})}).optional()}).optional()});
export type TelegramUpdate=z.infer<typeof telegramUpdate>;
export function telegramContext(u:TelegramUpdate){
 if(u.callback_query)return null;
 const m=u.message;
 if(m&&!m.from.is_bot&&m.chat.type==='private'&&m.chat.id===m.from.id){
  const [cmd,arg]=m.text.trim().split(/\s+/);if(cmd.split('@')[0]==='/start'&&arg&&/^[A-Za-z0-9_-]{44}$/.test(arg))return {tenant:expand(arg.slice(0,22)),code:arg.slice(22),telegramId:String(m.from.id),updateId:u.update_id};
 }
 return null;
}
export async function processTelegramUpdate(db:PoolClient,u:TelegramUpdate,c:NonNullable<ReturnType<typeof telegramContext>>){
 const inserted=await db.query('INSERT INTO telegram_updates(update_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING update_id',[u.update_id]);
 if(!inserted.rowCount)return null;
 const link=await db.query('SELECT l.id,l.user_id,u.username FROM telegram_links l JOIN users u ON u.id=l.user_id JOIN tenants t ON t.id=l.tenant_id JOIN memberships m ON m.user_id=l.user_id AND m.tenant_id=l.tenant_id WHERE l.tenant_id=$1 AND l.code_hash=$2 AND l.expires_at>now() AND l.telegram_id IS NULL AND NOT u.disabled AND NOT t.suspended FOR UPDATE OF l',[c.tenant,digest(c.code)]);
 if(link.rowCount!==1)throw Error('PAIRING_REJECTED');
 const actor=link.rows[0].user_id;
 await db.query('DELETE FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL',[actor]);
 await db.query('UPDATE telegram_links SET telegram_id=$1,code_hash=NULL,expires_at=NULL WHERE id=$2',[c.telegramId,link.rows[0].id]);
 await db.query('INSERT INTO telegram_preferences(tenant_id,user_id,enabled,markets) VALUES($1,$2,false,\'{}\') ON CONFLICT(tenant_id,user_id) DO NOTHING',[c.tenant,actor]);
 await db.query("INSERT INTO audit(tenant_id,actor_id,event) VALUES($1,$2,'TELEGRAM_LINKED')",[c.tenant,actor]);
 return {chat_id:c.telegramId,text:`✅ <b>VELA hesabınız bağlandı!</b>\n\n👤 İstifadəçi: <b>${String(link.rows[0].username).replace(/[&<>]/g,'')}</b>\n🔔 Xəbər və bazar baxışı bildirişlərini saytdakı Telegram bölməsindən aça bilərsiniz.\n🌐 Sayt bağlantı vəziyyətini avtomatik yeniləyəcək.\n\nℹ️ Bu bot ticarət əmri göndərmir və hesab əməliyyatlarını idarə etmir.`,parse_mode:'HTML' as const};
}


