import {equal} from './security';

export function validSetupToken(provided:string,configured=process.env.SETUP_TOKEN) {
  return !!configured && /^[A-Za-z0-9_-]{32,128}$/.test(configured) && equal(provided,configured);
}
export function challengeUsable(challenge:{attempts:number;expires_at:Date;setup_key_hash:string},keyHash:string,now=Date.now()) {
  return challenge.attempts<5 && challenge.expires_at.getTime()>now && equal(challenge.setup_key_hash,keyHash);
}
export function setupEncryptionConfigured(){return /^[a-fA-F0-9]{64}$/.test(process.env.SECRET_KEY_HEX??'');}
