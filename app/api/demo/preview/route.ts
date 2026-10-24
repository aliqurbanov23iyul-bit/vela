import {NextResponse} from 'next/server';
import {identity} from '../../../../src/server/auth';
import {proposalMessage} from '../../../../src/server/telegram';

export async function GET(){
 try{
  const session=await identity();
  if(session.role!=='OWNER')return NextResponse.json({error:'Bu nümunəyə yalnız hesab sahibi baxa bilər.'},{status:403});
  const expiresAt=new Date(Date.now()+2*60_000);
  const html=proposalMessage('Nümunə demo hesabı',{demo:true,testMode:true,symbol:'EURUSD',side:'BUY',entry:1.0842,stop:1.0822,take:1.0872,volume:0.1,riskMoney:25,riskPercent:0.25,riskCapPercent:0.25,currency:'USD'},expiresAt);
  return NextResponse.json({html,buttons:['✅ Təsdiqlə','❌ Rədd et'],expiresAt:expiresAt.toISOString(),previewOnly:true},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Nümunəni görmək üçün hesabına daxil ol.'},{status:401});}
}

