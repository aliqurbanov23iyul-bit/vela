import {cookies} from 'next/headers';
import {identity} from './auth';

export async function adminSession(){
  const actor=await identity();
  if(!actor.super_admin)throw Error('ADMIN_REQUIRED');
  const raw=(await cookies()).get('session')?.value;
  if(!raw)throw Error('UNAUTHORIZED');
  return raw;
}

export function adminError(error:unknown){
  const e=error as {code?:string;message?:string};
  if(e.message==='REAUTH_REQUIRED')return {status:409,error:'Güvenlik için çıkış yapıp yeniden admin girişi yapın. Sonra işlemi tekrarlayın.'};
  if(e.code==='23505')return {status:409,error:'Bu kullanıcı adı zaten kullanılıyor.'};
  if(e.code==='P0002')return {status:404,error:'Kullanıcı bulunamadı.'};
  if(e.code==='42883'||e.code==='42P01')return {status:503,error:'Kullanıcı yönetimi güncellemesi henüz veritabanına uygulanmadı.'};
  if(e.code==='42501'||e.message==='ADMIN_REQUIRED')return {status:403,error:'Bu alan yalnızca admin hesabına açıktır.'};
  if(e.message==='UNAUTHORIZED')return {status:401,error:'Önce giriş yapın.'};
  if(e.message==='ORIGIN')return {status:403,error:'İstek kaynağı doğrulanamadı.'};
  return {status:400,error:'İşlem tamamlanamadı. Bilgileri ve bağlantıyı kontrol edin.'};
}
