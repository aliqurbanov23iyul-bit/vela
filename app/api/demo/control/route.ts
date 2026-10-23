import {NextResponse} from 'next/server';
import {z} from 'zod';
import {identity,requireOwner,sameOrigin} from '../../../../src/server/auth';
import {tenantTx} from '../../../../src/server/db';
import {controlDemo} from '../../../../src/server/demo-control';
export async function GET(){try{
 const s=await identity();
 const data=await tenantTx(s.tenant_id,async db=>{
  const accounts=(await db.query('SELECT a.id,a.label,a.account_type,a.heartbeat,a.snapshot,d.session_id,d.enabled,d.mode,d.started_at,d.expires_at,d.permission_version=a.permission_version AS current_permission FROM accounts a LEFT JOIN demo_control d ON d.account_id=a.id ORDER BY a.label')).rows;
  const deals=(await db.query('SELECT d.account_id,a.label,d.payload FROM demo_deals d JOIN accounts a ON a.id=d.account_id ORDER BY d.deal_at DESC LIMIT 100')).rows;
  const proposals=(await db.query("SELECT c.id,c.account_id,c.symbol,c.mode,c.created_at,c.expires_at,c.claimed_at,c.request,p.decision FROM demo_candidates c LEFT JOIN approvals p ON p.id=c.approval_id ORDER BY c.created_at DESC LIMIT 20")).rows;
  const linked=!!(await db.query('SELECT 1 FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL',[s.user_id])).rowCount;
  return {accounts,deals,proposals,telegramConnected:linked,canManage:s.role==='OWNER'};
 });return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Demo idarəsi üçün hesabına daxil ol.'},{status:401});}}
export async function POST(req:Request){try{
 sameOrigin(req);const s=await identity();requireOwner(s);
 const b=z.object({accountId:z.string().uuid(),operation:z.enum(['start','stop']),mode:z.enum(['AUTO','TELEGRAM']).default('TELEGRAM')}).strict().parse(await req.json());
 if(b.operation==='start'&&b.mode==='TELEGRAM'&&(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_WEBHOOK_SECRET))throw Error('TELEGRAM');
 const run=await tenantTx(s.tenant_id,db=>controlDemo(db,s.user_id,b.accountId,b.operation,b.mode));
 return NextResponse.json({ok:true,run});
 }catch(e){const code=e instanceof Error?e.message:'';const messages:Record<string,string>={CONNECTOR:'MT5 və VELA-nın yeni versiyası açıq olmalıdır. Bağlantıdan yeni məlumat gözlənilir.',DEMO_ONLY:'Bu funksiya yalnız demo hesabı üçündür.',TELEGRAM:'Əvvəl Bağlantılar bölməsində Telegramı qoş.',FORBIDDEN:'Bu hesabı idarə etmək üçün sahib icazəsi lazımdır.'};return NextResponse.json({error:messages[code]??'Dəyişiklik saxlanmadı. Yenidən yoxla.'},{status:400});}}
