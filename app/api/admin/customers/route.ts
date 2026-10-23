import {NextResponse} from 'next/server';
import argon2 from 'argon2';
import {z} from 'zod';
import {pool} from '../../../../src/server/db';
import {sameOrigin} from '../../../../src/server/auth';
import {adminSession,adminError} from '../../../../src/server/admin';
const headers={'Cache-Control':'no-store'};

export async function GET(req:Request){try{
  const session=await adminSession();const url=new URL(req.url);
  const search=z.string().max(100).parse(url.searchParams.get('q')??'');
  const page=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('page')??0);
  const r=await pool.query('SELECT public.vela_list_customers($1,$2,$3) AS data',[session,search,page]);
  return NextResponse.json(r.rows[0].data,{headers});
}catch(e){const f=adminError(e);return NextResponse.json({error:f.error},{status:f.status,headers});}}

export async function POST(req:Request){try{
  sameOrigin(req);const session=await adminSession();
  const b=z.object({username:z.string().regex(/^[a-zA-Z0-9_.-]{3,64}$/),password:z.string().min(16).max(256),displayName:z.string().trim().max(100).default('')}).strict().parse(await req.json());
  const hash=await argon2.hash(b.password,{type:argon2.argon2id});
  const r=await pool.query('SELECT public.vela_create_customer($1,$2,$3,$4) AS id',[session,b.username,hash,b.displayName]);
  return NextResponse.json({id:r.rows[0].id},{status:201,headers});
}catch(e){const f=adminError(e);return NextResponse.json({error:f.error},{status:f.status,headers});}}
