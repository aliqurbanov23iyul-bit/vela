import {NextResponse} from 'next/server';
import {identity} from '../../../src/server/auth';
import {getNewsContext} from '../../../src/server/public-news';

export const dynamic='force-dynamic';

export async function GET(){
 try{
  await identity();
  const data=await getNewsContext();
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  const unauthorized=code==='UNAUTHORIZED'||code==='FORBIDDEN';
  return NextResponse.json(
   {error:unauthorized?'Daxil ol və yenidən yoxla.':'Xəbər lentini yükləmək alınmadı.'},
   {status:unauthorized?401:503,headers:{'Cache-Control':'no-store'}}
  );
 }
}
