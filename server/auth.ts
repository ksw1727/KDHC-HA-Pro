import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { SafeError, uuid } from './ai';
export interface Identity { id:string; email:string; emailVerified:true }
const keySets=new Map<string,JWTVerifyGetKey>();
export const normalizeEmail=(email:string)=>email.trim().toLowerCase();
export function authSettings(env:NodeJS.ProcessEnv):{origin:string;jwks:URL} {
  try {
    const base=new URL(env.NEON_AUTH_BASE_URL ?? '');
    if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash) throw new Error('config');
    return {origin:base.origin,jwks:new URL(base.toString().replace(/\/$/,'')+'/.well-known/jwks.json')};
  } catch {throw new SafeError(503,'인증 서버 설정이 필요해요.');}
}
export async function verifyAuthToken(token:string,env:NodeJS.ProcessEnv,resolveKey?:JWTVerifyGetKey):Promise<Identity> {
  const {origin,jwks}=authSettings(env);
  try {
    if(token.length>16_384) throw new Error('token');
    let key=resolveKey ?? keySets.get(jwks.href);
    if(!key) {key=createRemoteJWKSet(jwks,{timeoutDuration:5_000,cooldownDuration:30_000,cacheMaxAge:600_000});keySets.set(jwks.href,key);}
    const {payload}=await jwtVerify(token,key,{issuer:origin,audience:origin,algorithms:['EdDSA'],requiredClaims:['exp','iat','sub','email','emailVerified'],maxTokenAge:'20m',clockTolerance:5});
    if(!uuid(payload.sub) || typeof payload.email!=='string' || payload.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || payload.emailVerified!==true || (payload.banned!==undefined && payload.banned!==null && payload.banned!==false)) throw new Error('claims');
    return {id:payload.sub.toLowerCase(),email:normalizeEmail(payload.email),emailVerified:true};
  } catch {throw new SafeError(401,'인증을 확인하지 못했어요. 다시 로그인해 주세요.');}
}
