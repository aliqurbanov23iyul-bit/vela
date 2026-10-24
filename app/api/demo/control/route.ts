import {NextResponse} from 'next/server';
import {z} from 'zod';
import {identity,requireOwner,sameOrigin} from '../../../../src/server/auth';
import {tenantTx} from '../../../../src/server/db';
import {controlDemo,demoOptions,demoRun} from '../../../../src/server/demo-control';
import {observeDemo} from '../../../../src/core/demo-status';
export async function GET(){try{
 const s=await identity();
 const data=await tenantTx(s.tenant_id,async db=>{
  const accounts=(await db.query('SELECT a.id,a.label,a.account_type,a.heartbeat,a.snapshot,d.session_id,d.enabled,d.mode,d.test_mode,d.started_at,d.expires_at,d.permission_version=a.permission_version AS current_permission,d.duration_hours,d.trade_limit,d.frequency,d.stop_reason FROM accounts a LEFT JOIN demo_control d ON d.account_id=a.id ORDER BY a.label')).rows;
  for(const a of accounts){
   const run=await demoRun(db,a.id),snapshot=a.snapshot as {demoPilot?:{enabled?:boolean;phase?:string;reason?:string}}|null;
   const observed=observeDemo({desired:run?.enabled===true&&a.current_permission===true,accountType:a.account_type,heartbeatAt:a.heartbeat?new Date(a.heartbeat as string).toISOString():null,startedAt:run?.startedAt??null,pilot:snapshot?.demoPilot});
   Object.assign(a,{enabled:run?.enabled??false,completedTrades:run?.completedTrades??0,openedTrades:run?.openedTrades??0,stop_reason:run?.stopReason??null,observedState:observed.state,observedReason:observed.reason});
  }
  const deals=(await db.query('SELECT d.account_id,a.label,d.payload FROM demo_deals d JOIN accounts a ON a.id=d.account_id ORDER BY d.deal_at DESC LIMIT 100')).rows;
  const proposals=(await db.query("SELECT c.id,c.account_id,c.symbol,c.mode,c.created_at,c.expires_at,c.claimed_at,c.request,c.execution_state,p.decision FROM demo_candidates c LEFT JOIN approvals p ON p.id=c.approval_id ORDER BY c.created_at DESC LIMIT 20")).rows;
  const linked=!!(await db.query('SELECT 1 FROM telegram_links WHERE user_id=$1 AND telegram_id IS NOT NULL',[s.user_id])).rowCount;
  return {accounts,deals,proposals,telegramConnected:linked,canManage:s.role==='OWNER'};
 });return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Demo idarəsi üçün hesabına daxil ol.'},{status:401});}}
export async function POST(req:Request){try{
 sameOrigin(req);const s=await identity();requireOwner(s);
 const b=demoOptions.extend({accountId:z.string().uuid(),operation:z.enum(['start','stop']),mode:z.enum(['AUTO','TELEGRAM']).default('TELEGRAM')}).strict().parse(await req.json());
 if(b.operation==='start'&&b.testMode&&b.mode!=='TELEGRAM')throw Error('TEST_REQUIRES_TELEGRAM');
 if(b.operation==='start'&&b.mode==='TELEGRAM'&&(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_WEBHOOK_SECRET))throw Error('TELEGRAM');
 const run=await tenantTx(s.tenant_id,db=>controlDemo(db,s.user_id,b.accountId,b.operation,b.mode,b));
 return NextResponse.json({ok:true,run});
 }catch(e){const code=e instanceof Error?e.message:'';const messages:Record<string,string>={STOP_FIRST:'Ayarları dəyişmək üçün əvvəl botu dayandır.',CONNECTOR:'MT5 və VELA-nın yeni versiyası açıq olmalıdır. Bağlantıdan yeni məlumat gözlənilir.',DEMO_ONLY:'Bu funksiya yalnız demo hesabı üçündür.',TELEGRAM:'Əvvəl Bağlantılar bölməsində Telegramı qoş.',TEST_REQUIRES_TELEGRAM:'Test rejimi üçün Telegram təsdiqini seç.',QUICK_REQUIRES_TEST:'Sürətli rejim yalnız TEST və Telegram təsdiqi ilə işləyir.',QUICK_CONNECTOR:'Sürətli test üçün VELA-nın yenilənmiş versiyasını aç.',FORBIDDEN:'Bu hesabı idarə etmək üçün sahib icazəsi lazımdır.'};return NextResponse.json({error:messages[code]??'Dəyişiklik saxlanmadı. Yenidən yoxla.'},{status:400});}}
