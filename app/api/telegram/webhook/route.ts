import {NextResponse} from 'next/server';
import {z} from 'zod';
import {tenantTx} from '../../../../src/server/db';
import {digest,equal} from '../../../../src/server/security';
import {expand,telegram} from '../../../../src/server/telegram';
const update=z.object({update_id:z.number().int(),message:z.object({from:z.object({id:z.number().int(),is_bot:z.boolean()}),chat:z.object({id:z.number().int(),type:z.string()}),text:z.string()}).optional(),callback_query:z.object({id:z.string(),from:z.object({id:z.number().int(),is_bot:z.boolean()}),data:z.string()}).optional()});
export async function POST(req:Request){const secret=process.env.TELEGRAM_WEBHOOK_SECRET;if(!secret||!equal(req.headers.get('x-telegram-bot-api-secret-token')??'',secret))return NextResponse.json({error:'Forbidden'},{status:403});try{
 const u=update.parse(await req.json());const cb=u.callback_query,m=u.message;let tenant:string,command:string,code:string|undefined,approvalId:string|undefined,decision:string|undefined;
 if(cb){const parts=cb.data.split('.');if(parts.length!==3||!['A','R'].includes(parts[2])||cb.from.is_bot)throw Error('INVALID');tenant=expand(parts[0]);approvalId=expand(parts[1]);decision=parts[2]==='A'?'APPROVED':'REJECTED';command='callback';}
 else if(m&&m.chat.type==='private'&&!m.from.is_bot){const [cmd,arg]=m.text.trim().split(/\s+/);if(!['/start','/status','/stop'].includes(cmd)||!arg)throw Error('INVALID');command=cmd;const parts=arg.split('.');tenant=expand(parts[0]);code=parts[1];}else return NextResponse.json({ok:true});
 const telegramId=String((cb?.from??m!.from).id);
 const result=await tenantTx(tenant,async db=>{
 const inserted=await db.query('INSERT INTO telegram_updates(update_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING update_id',[u.update_id]);if(!inserted.rowCount)return 'DUPLICATE';
 if(command==='/start'){if(!code)throw Error('INVALID');const link=await db.query('UPDATE telegram_links SET telegram_id=$1,code_hash=NULL,expires_at=NULL WHERE code_hash=$2 AND expires_at>now() AND telegram_id IS NULL RETURNING user_id',[telegramId,digest(code)]);if(link.rowCount!==1)throw Error('PAIRING_REJECTED');await db.query("INSERT INTO audit(tenant_id,actor_id,event) VALUES($1,$2,'TELEGRAM_LINKED')",[tenant,link.rows[0].user_id]);return 'Hesap eşleştirildi. Canlı işlem kapalı.';}
 const links=await db.query("SELECT l.user_id,m.role FROM telegram_links l JOIN memberships m ON m.user_id=l.user_id AND m.tenant_id=l.tenant_id JOIN users u ON u.id=l.user_id JOIN tenants t ON t.id=l.tenant_id WHERE l.telegram_id=$1 AND NOT u.disabled AND NOT t.suspended",[telegramId]);if(links.rowCount!==1)throw Error('UNAUTHORIZED');const link=links.rows[0];
 if(command==='/status')return 'Canlı emir yürütme bu sürümde kapalı. Pozisyon durumu için uygulamadaki son eşitlemeyi kontrol edin.';
 if(command==='/stop'){if(link.role!=='OWNER')throw Error('FORBIDDEN');await db.query('UPDATE accounts SET stopped=true,permission_version=permission_version+1');await db.query("UPDATE orders SET state='BLOCKED' WHERE state IN ('CREATED','RESERVED')");await db.query("INSERT INTO audit(tenant_id,actor_id,event) VALUES($1,$2,'TELEGRAM_TENANT_STOP')",[tenant,link.user_id]);return 'Yeni girişler durduruldu. Açık pozisyonlar kapatılmadı.';}
 if(!['OWNER','OPERATOR'].includes(link.role))throw Error('FORBIDDEN');const approved=await db.query("UPDATE approvals a SET consumed_at=now(),decision=$1 FROM proposals p WHERE a.id=$2 AND a.user_id=$3 AND a.consumed_at IS NULL AND a.expires_at>now() AND p.id=a.proposal_id AND p.account_id=a.account_id AND p.version=a.proposal_version AND p.expires_at>now() AND p.tenant_id=a.tenant_id RETURNING a.account_id",[decision,approvalId,link.user_id]);if(approved.rowCount!==1)throw Error('EXPIRED_OR_CONSUMED');await db.query("INSERT INTO audit(tenant_id,actor_id,account_id,event) VALUES($1,$2,$3,$4)",[tenant,link.user_id,approved.rows[0].account_id,'TELEGRAM_'+decision]);return 'Karar kaydedildi. Canlı emir gönderilmedi.';
 });
 if(result!=='DUPLICATE'){try{if(cb)await telegram('answerCallbackQuery',{callback_query_id:cb.id,text:result});else await telegram('sendMessage',{chat_id:m!.chat.id,text:result});}catch{/* Decision remains persisted. No retry that could repeat an action. */}}
 return NextResponse.json({ok:true});
 }catch{return NextResponse.json({error:'Update rejected'},{status:400});}}
