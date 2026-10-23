import {NextResponse} from 'next/server';
import {tenantTx} from '../../../../src/server/db';
import {demoCandidate,demoClaim,prepareDemo,claimDemo,demoOutcome,reportDemo,demoHalt,haltDemo} from '../../../../src/server/demo-control';
import {telegram,proposalMessage,approvalKeyboard} from '../../../../src/server/telegram';
export const maxDuration=30;
export async function POST(req:Request){try{
 const raw=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!raw)throw Error('AUTH');
 const text=await req.text();if(text.length>12000)throw Error('PAYLOAD');const input=JSON.parse(text);
 if(input.operation==='report'){const b=demoOutcome.parse(input);return NextResponse.json(await tenantTx(b.tenantId,db=>reportDemo(db,b,raw)));}
 if(input.operation==='halt'){const b=demoHalt.parse(input);return NextResponse.json(await tenantTx(b.tenantId,db=>haltDemo(db,b,raw)));}
 if(input.operation==='claim'){
  const b=demoClaim.parse(input);return NextResponse.json(await tenantTx(b.tenantId,db=>claimDemo(db,b,raw)));
 }
 const b=demoCandidate.parse(input),result=await tenantTx(b.tenantId,db=>prepareDemo(db,b,raw));
 if(result.notification){const n=result.notification,r=n.request;
  try{
   await telegram('sendMessage',{chat_id:n.chat,text:proposalMessage(n.label,{demo:true,symbol:b.symbol,side:r.type===0?'BUY':'SELL',entry:r.price,stop:r.sl,take:r.tp,volume:r.volume},n.expiresAt),reply_markup:approvalKeyboard(b.tenantId,n.approvalId)});
   await tenantTx(b.tenantId,async db=>{
    await db.query('UPDATE demo_candidates SET notified_at=now() WHERE id=$1',[n.id]);
    await db.query("INSERT INTO audit(tenant_id,actor_id,account_id,event,data) SELECT $1,user_id,$2,'TELEGRAM_PROPOSAL_SENT',$3 FROM approvals WHERE id=$4",[b.tenantId,b.accountId,JSON.stringify({approvalId:n.approvalId}),n.approvalId]);
   });
  }catch{/* A bounded leased retry on the next authenticated poll; never execute while pending. */}
 }
 const {notification,...safe}=result;return NextResponse.json(safe,{headers:{'Cache-Control':'no-store'}});
 }catch(e){const reason=e instanceof Error?e.message:'';return NextResponse.json({ok:false,state:['EXPIRED','STOPPED','LIMIT','APPROVAL_REQUIRED','STALE_SIGNAL','TELEGRAM','COUNT_PENDING','COOLDOWN','UNRESOLVED'].includes(reason)?reason:'REJECTED'},{status:400});}}
