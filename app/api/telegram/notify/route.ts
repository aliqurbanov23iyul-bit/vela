import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {identity,sameOrigin} from '../../../../src/server/auth';
import {tenantTx} from '../../../../src/server/db';
import {digest} from '../../../../src/server/security';
import {telegram,proposalMessage,approvalKeyboard} from '../../../../src/server/telegram';
export async function POST(req:Request){try{
 sameOrigin(req);const s=await identity();if(!['OWNER','OPERATOR'].includes(s.role))return NextResponse.json({error:'İcazə yoxdur.'},{status:403});
 const {proposalId}=z.object({proposalId:z.string().uuid()}).strict().parse(await req.json());
 const item=await tenantTx(s.tenant_id,async db=>{
  const p=(await db.query('SELECT p.*,a.label FROM proposals p JOIN accounts a ON a.id=p.account_id WHERE p.id=$1 AND p.expires_at>now() FOR UPDATE OF p',[proposalId])).rows[0];if(!p)throw Error('PROPOSAL');
  const link=(await db.query('SELECT telegram_id FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL LIMIT 1',[s.user_id])).rows[0];if(!link)throw Error('LINK');
  let a=(await db.query('SELECT id,consumed_at,expires_at FROM approvals WHERE user_id=$1 AND proposal_id=$2 AND proposal_version=$3 LIMIT 1',[s.user_id,p.id,p.version])).rows[0];
  if(a&&(a.consumed_at||new Date(a.expires_at).getTime()<=Date.now()))throw Error('EXPIRED');
  if(!a){a={id:randomUUID()};await db.query('INSERT INTO approvals(id,tenant_id,user_id,account_id,proposal_id,proposal_version,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,s.tenant_id,s.user_id,p.account_id,p.id,p.version,digest(randomUUID()),p.expires_at]);}
  const sent=await db.query("SELECT 1 FROM audit WHERE actor_id=$1 AND event='TELEGRAM_PROPOSAL_SENT' AND data->>'approvalId'=$2 LIMIT 1",[s.user_id,a.id]);
  return {id:a.id,chat:link.telegram_id,account:p.account_id,sent:!!sent.rowCount,text:proposalMessage(p.label,p.payload,p.expires_at)};
 });
 if(!item.sent){await telegram('sendMessage',{chat_id:item.chat,text:item.text,reply_markup:approvalKeyboard(s.tenant_id,item.id)});await tenantTx(s.tenant_id,db=>db.query("INSERT INTO audit(tenant_id,actor_id,account_id,event,data) VALUES($1,$2,$3,'TELEGRAM_PROPOSAL_SENT',$4)",[s.tenant_id,s.user_id,item.account,JSON.stringify({approvalId:item.id})]));}
 return NextResponse.json({ok:true});
 }catch(e){const reason=e instanceof Error?e.message:'';return NextResponse.json({error:reason==='LINK'?'Əvvəl Telegram hesabını bağlayın.':reason==='PROPOSAL'||reason==='EXPIRED'?'Təklif artıq mövcud deyil və ya vaxtı bitib.':'Mesaj göndərilmədi. Bağlantını yoxlayıb yenidən cəhd edin.'},{status:400});}}
