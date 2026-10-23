import {cookies} from 'next/headers';
import {pool,tenantTx} from './db';
import {digest} from './security';
export type Identity={user_id:string;tenant_id:string;role:string;super_admin:boolean};
export async function identity():Promise<Identity>{const jar=await cookies(),raw=jar.get('session')?.value;if(!raw)throw Error('UNAUTHORIZED');const {rows}=await pool.query<Omit<Identity,'role'>>('SELECT s.user_id,s.tenant_id,u.super_admin FROM sessions s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=s.tenant_id WHERE token_hash=$1 AND expires_at>now() AND NOT u.disabled AND NOT t.suspended',[digest(raw)]);if(!rows[0])throw Error('UNAUTHORIZED');const s=rows[0];return tenantTx(s.tenant_id,async db=>{const m=await db.query('SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2',[s.tenant_id,s.user_id]);if(!m.rows[0])throw Error('FORBIDDEN');return {...s,role:m.rows[0].role};});}
export function requireOwner(s:Identity){if(s.role!=='OWNER')throw Error('FORBIDDEN');}
export function sameOrigin(req:Request){if(req.headers.get('origin')!==process.env.APP_ORIGIN)throw Error('ORIGIN');}

