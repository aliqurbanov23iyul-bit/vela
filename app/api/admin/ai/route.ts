import {NextResponse} from 'next/server';
import {identity,sameOrigin} from '../../../../src/server/auth';
import {tenantTx} from '../../../../src/server/db';
import {adminSession,adminError} from '../../../../src/server/admin';
import {serviceInput} from '../../../../src/server/ai-settings';
export async function PUT(req:Request){try{sameOrigin(req);const raw=await adminSession(),s=await identity(),p=serviceInput.parse(await req.json());await tenantTx(s.tenant_id,db=>db.query('SELECT public.vela_save_ai_service($1,$2,$3,$4,$5)',[raw,p.order,JSON.stringify(p.models),p.minInterval,p.dailyLimit]));return NextResponse.json({ok:true});}catch(e){const r=adminError(e);return NextResponse.json({error:r.error},{status:r.status});}}
