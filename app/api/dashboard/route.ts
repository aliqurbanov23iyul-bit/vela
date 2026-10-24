import {NextResponse} from 'next/server';
const disabled=()=>NextResponse.json({error:'Bu VELA buraxılışında broker və ticarət idarəetməsi söndürülüb.'},{status:410,headers:{'Cache-Control':'no-store'}});
export async function GET(){return disabled();}
export async function POST(){return disabled();}
export async function PUT(){return disabled();}
export async function PATCH(){return disabled();}
export async function DELETE(){return disabled();}

