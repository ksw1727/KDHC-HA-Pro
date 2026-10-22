// @vitest-environment node
import { beforeAll, describe,it,expect,vi } from 'vitest';
import { createLocalJWKSet, generateKeyPair, exportJWK, SignJWT, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { authSettings, verifyAuthToken, type Identity } from './auth';
import { makeStore, type Query } from './store';
import { handler, type Request } from './http';
const base='https://test.neonauth.example/neondb/auth';
const env={NEON_AUTH_BASE_URL:base,DATABASE_URL:'postgresql://test:fake@localhost/neondb'};
const identity:Identity={id:'08065277-5ca0-43d2-9df4-d31fb93b1249',email:'approved@example.com',emailVerified:true};
let keys:Awaited<ReturnType<typeof generateKeyPair>>;
let local:JWTVerifyGetKey;
beforeAll(async()=>{keys=await generateKeyPair('EdDSA');const jwk=await exportJWK(keys.publicKey);jwk.kid='test';local=createLocalJWKSet({keys:[jwk]});});
async function token(extra:JWTPayload={},omit:string[]=[]) {
 const now=Math.floor(Date.now()/1000);
 const payload:JWTPayload={sub:identity.id,email:identity.email,emailVerified:true,banned:false,iat:now,exp:now+900,iss:new URL(base).origin,aud:new URL(base).origin,...extra};
 omit.forEach(k=>delete payload[k]);return new SignJWT(payload).setProtectedHeader({alg:'EdDSA',kid:'test'}).sign(keys.privateKey);
}
describe('Neon signed authentication',()=>{
 it('derives origin issuer and base-path JWKS endpoint',()=>{expect(authSettings(env)).toEqual({origin:'https://test.neonauth.example',jwks:new URL(base+'/.well-known/jwks.json')});expect(()=>authSettings({NEON_AUTH_BASE_URL:'http://insecure.example/auth'})).toThrow();});
 it('accepts valid EdDSA token and normalizes approved email',async()=>{expect(await verifyAuthToken(await token({email:'Approved@Example.com'}),env,local)).toEqual(identity);});
 it.each([{banned:null},{banned:undefined}])('accepts tokens whose banned claim is empty %j (users added from the admin page)',async claims=>{await expect(verifyAuthToken(await token(claims),env,local)).resolves.toMatchObject({id:identity.id});});
 it.each([{iss:'https://wrong.example'},{aud:'https://wrong.example'},{emailVerified:false},{banned:true},{exp:1},{iat:Math.floor(Date.now()/1000)+3600},{sub:''},{sub:'not-a-uuid'},{email:'bad-email'}])('rejects invalid claims %j',async claims=>{await expect(verifyAuthToken(await token(claims),env,local)).rejects.toThrow('인증을 확인');});
 it.each(['exp','iat','sub','email','emailVerified'])('requires %s',async claim=>{await expect(verifyAuthToken(await token({},[claim]),env,local)).rejects.toThrow();});
 it('rejects other signing algorithms',async()=>{const now=Math.floor(Date.now()/1000);const jwt=await new SignJWT({sub:identity.id,email:identity.email,emailVerified:true,iat:now,exp:now+900,iss:new URL(base).origin,aud:new URL(base).origin}).setProtectedHeader({alg:'HS256'}).sign(new Uint8Array(32));await expect(verifyAuthToken(jwt,env,local)).rejects.toThrow();});
 it('rejects mismatched signature',async()=>{const wrong=await generateKeyPair('EdDSA');const jwk=await exportJWK(wrong.publicKey);jwk.kid='test';await expect(verifyAuthToken(await token(),env,createLocalJWKSet({keys:[jwk]}))).rejects.toThrow();});
});
describe('Neon approval gate and SQL binding',()=>{
 const verify=vi.fn(async()=>identity);
 it('requires approved, matching verified DB user',async()=>{const sql=vi.fn<Query>(async()=>[{id:identity.id,email:identity.email}]);const store=makeStore(env,{sql,verify});expect(await store.user('jwt')).toBe(identity.id);const [strings,...values]=sql.mock.calls[0];expect(strings.join('')).toContain('u."emailVerified" is true');expect(strings.join('')).toContain('a.enabled is true');expect(strings.join('')).toContain("coalesce(to_jsonb(u)->>'banned','false')='false'");expect(values).toEqual([identity.id,identity.email]);});
 it.each([{rows:[]},{rows:[{id:'other-user',email:identity.email}]},{rows:[{id:identity.id,email:'different@example.com'}]}])('rejects missing/mismatched approval %j',async ({rows})=>{const store=makeStore(env,{sql:vi.fn<Query>(async()=>rows),verify});await expect(store.user('jwt')).rejects.toMatchObject({status:403});});
 it('fails closed on DB verification failure without exposing raw errors',async()=>{const store=makeStore(env,{sql:vi.fn<Query>(async()=>{throw new Error('secret-password');}),verify});await expect(store.user('jwt')).rejects.toMatchObject({status:503,message:'계정 승인을 확인하지 못했어요.'});});
 it('maps every reserve result to a clear message',async()=>{
  const cases:[string,number,RegExp][]=[['user_limit',429,/오늘 AI 사용 한도/],['global_limit',429,/전체 AI 사용 한도/],['busy',429,/진행 중인 요청/],['denied',403,/권한이 없어요/],['unexpected',403,/권한이 없어요/]];
  for(const [result,status,message] of cases){const st=makeStore(env,{sql:vi.fn<Query>(async()=>[{result}]),verify});await expect(st.reserve(identity.id,'chat','lease')).rejects.toMatchObject({status,message:expect.stringMatching(message)});}
  const ok=makeStore(env,{sql:vi.fn<Query>(async()=>[{result:'ok'}]),verify});await expect(ok.reserve(identity.id,'chat','lease')).resolves.toBeUndefined();
 });
 it('fails closed on denied and failed quota calls',async()=>{const denied=makeStore(env,{sql:vi.fn<Query>(async()=>[{result:'user_limit'}]),verify});await expect(denied.reserve(identity.id,'chat','lease')).rejects.toMatchObject({status:429});const failed=makeStore(env,{sql:vi.fn<Query>(async()=>{throw new Error('raw db credentials');}),verify});await expect(failed.reserve(identity.id,'chat','lease')).rejects.toMatchObject({status:503,message:'사용 한도를 확인하지 못했어요.'});});
 it('binds arbitrary chat inputs as SQL params',async()=>{const sql=vi.fn<Query>(async()=>[]);const store=makeStore(env,{sql,verify});await store.chat("x'; drop table forms;--",'user');const [strings,...values]=sql.mock.calls[0];expect(strings.join('')).not.toContain('drop table');expect(values).toEqual(["x'; drop table forms;--",'user']);});
 it('does not invoke AI or quota for signed but unapproved user',async()=>{const sql=vi.fn<Query>(async()=>[]);const store=makeStore(env,{sql,verify:async jwt=>verifyAuthToken(jwt,env,local)});const provider=vi.fn();let output='';const req=Object.assign(new EventEmitter(),{method:'POST',headers:{authorization:'Bearer '+await token()},body:{engine:'claude',message:'x'},url:'/api/ai/chat'}) as Request;const res=Object.assign(new EventEmitter(),{statusCode:200,writableEnded:false,destroyed:false,setHeader(){},end(x:string){output=x;}});await handler('chat',{env,store,provider})(req,res as unknown as ServerResponse);expect(res.statusCode).toBe(403);expect(provider).not.toHaveBeenCalled();expect(sql).toHaveBeenCalledTimes(1);expect(output).not.toContain('postgresql');});
 it('account returns flat approved identity without provider settings',async()=>{const store=makeStore(env,{sql:vi.fn<Query>(async()=>[{id:identity.id,email:identity.email}]),verify});let output='';const req=Object.assign(new EventEmitter(),{method:'GET',headers:{authorization:'Bearer fake'},url:'/api/account'}) as Request;const res=Object.assign(new EventEmitter(),{statusCode:200,writableEnded:false,destroyed:false,setHeader(){},end(x:string){output=x;}});await handler('account',{env,store})(req,res as unknown as ServerResponse);expect(JSON.parse(output)).toEqual({...identity,approved:true});});
 it('static SQL requires allowlist plus own-row RLS and owner-only leases',()=>{const sql=readFileSync(new URL('../neon/migrations/202610220001_cloud_ai.sql',import.meta.url),'utf8');expect(sql).toContain('user_id uuid');expect(sql).toContain('public.moa_is_allowed()');expect(sql).toContain('auth.user_id()');expect(sql).toContain('u.id::text=(select auth.user_id())');expect(sql).toContain('(select auth.user_id())=user_id::text');expect(sql).not.toContain('user_id text');expect(sql).toContain('p_user uuid');expect(sql).toContain('u."emailVerified" is true');expect(sql).toContain('revoke all on schema moa_private from public,anonymous,authenticated');expect(sql).not.toContain('service_role');expect(sql).not.toContain('auth.users');expect(sql).not.toContain('auth.uid()');expect(sql).not.toMatch(/insert into moa_private\.moa_allowed_users/i);for(const name of ['moa_forms_owner','moa_drafts_owner','moa_ai_owner_read'])expect(sql.split('\n').find(l=>l.startsWith('create policy '+name))).toContain('public.moa_is_allowed()');expect(sql).toContain('revoke all on function moa_private.moa_ai_reserve(uuid,uuid,uuid,integer,integer) from public,anonymous,authenticated');});
});
