import {NextResponse} from 'next/server';
import {z} from 'zod';
import {pool} from '../../../../../src/server/db';
import {sameOrigin} from '../../../../../src/server/auth';
import {adminSession,adminError} from '../../../../../src/server/admin';
const headers={'Cache-Control':'no-store'};
type Context={params:Promise<{id:string}>};

export async function GET(_req:Request,ctx:Context){try{
  const session=await adminSession();const id=z.string().uuid().parse((await ctx.params).id);
  const r=await pool.query('SELECT public.vela_customer_detail($1,$2) AS data',[session,id]);
  return NextResponse.json(r.rows[0].data,{headers});
}catch(e){const f=adminError(e);return NextResponse.json({error:f.error},{status:f.status,headers});}}

export async function PATCH(req:Request,ctx:Context){try{
  sameOrigin(req);const session=await adminSession();const id=z.string().uuid().parse((await ctx.params).id);
  const b=z.object({enabled:z.boolean()}).strict().parse(await req.json());
  await pool.query('SELECT public.vela_set_customer_access($1,$2,$3)',[session,id,b.enabled]);
  return NextResponse.json({ok:true},{headers});
}catch(e){const f=adminError(e);return NextResponse.json({error:f.error},{status:f.status,headers});}}
