import {NextResponse} from 'next/server';
import {getNewsContext} from '../../../src/server/public-news';
export const maxDuration=20;
// Only public publisher headlines and health metadata. No tenant data or AI results.
export async function GET(){try{return NextResponse.json(await getNewsContext(),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Xəbər mənbələrinin vəziyyəti oxunmadı.'},{status:503});}}
