import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {pool} from '../../../src/server/db';
import {digest} from '../../../src/server/security';
import {sameOrigin} from '../../../src/server/auth';
export async function POST(req:Request){try{sameOrigin(req);const jar=await cookies();const raw=jar.get('session')?.value;if(raw)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[digest(raw)]);jar.delete('session');return NextResponse.json({ok:true});}catch{return NextResponse.json({error:'Oturum kapatılamadı'},{status:503});}}
