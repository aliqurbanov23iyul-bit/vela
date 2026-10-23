import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {identity,requireOwner,sameOrigin} from '../../../src/server/auth';
import {audit,tenantTx} from '../../../src/server/db';
export async function POST(req:Request){try{sameOrigin(req);const s=await identity();requireOwner(s);const b=z.object({label:z.string().min(1).max(80)}).parse(await req.json());const id=randomUUID();await tenantTx(s.tenant_id,async db=>{await db.query('INSERT INTO accounts(id,tenant_id,owner_id,label) VALUES($1,$2,$3,$4)',[id,s.tenant_id,s.user_id,b.label]);await audit(db,s.tenant_id,s.user_id,'ACCOUNT_CREATED',id);});return NextResponse.json({id});}catch{return NextResponse.json({error:'Hesap oluşturulamadı.'},{status:403});}}
