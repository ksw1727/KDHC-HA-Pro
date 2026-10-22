import { neon } from '@neondatabase/serverless';
import { SafeError, type Turn } from './ai';
import { verifyAuthToken, type Identity } from './auth';
import type { FormSchema } from '../src/contract/schema';
export interface Chat { id:string; user_id:string; conversation:Turn[]; form:FormSchema|null }
export interface Store {
  user(token:string):Promise<string>;
  account?(token:string):Promise<Identity>;
  chat(id:string,user:string):Promise<Chat|null>;
  reserve(user:string,id:string,lease:string):Promise<void>;
  finish(user:string,id:string,lease:string,conversation:Turn[]|null,form:FormSchema|null):Promise<void>;
}
export type Query=(strings:TemplateStringsArray,...values:unknown[])=>Promise<Record<string,unknown>[]>;
export interface StoreOptions { sql?:Query; verify?:(token:string,env:NodeJS.ProcessEnv)=>Promise<Identity> }
export function makeStore(env:NodeJS.ProcessEnv, options:StoreOptions={}):Store {
  if(!env.DATABASE_URL) throw new SafeError(503,'서버 연결 설정이 필요해요.');
  const sql=options.sql ?? neon(env.DATABASE_URL) as unknown as Query;
  const account=async(token:string):Promise<Identity>=>{
    const identity=await (options.verify ?? verifyAuthToken)(token,env);
    let rows:Record<string,unknown>[];
    try {
      rows=await sql`select u.id, lower(btrim(u.email)) as email from neon_auth."user" u
        join moa_private.moa_allowed_users a on a.email=lower(btrim(u.email))
        where u.id=${identity.id}::uuid and lower(btrim(u.email))=${identity.email}
          and u."emailVerified" is true and coalesce(to_jsonb(u)->>'banned','false')='false'
          and a.enabled is true and (a.user_id is null or a.user_id=u.id) limit 1`;
    } catch {throw new SafeError(503,'계정 승인을 확인하지 못했어요.');}
    if(rows.length!==1 || rows[0].id!==identity.id || rows[0].email!==identity.email) throw new SafeError(403,'승인된 계정만 이용할 수 있어요. 관리자에게 승인을 요청해 주세요.');
    return identity;
  };
  return {
    account,
    async user(token) {return (await account(token)).id;},
    async chat(id,user) {try {const rows=await sql`select id,user_id,conversation,form from public.moa_ai_chats where id=${id}::uuid and user_id=${user}::uuid limit 1`;return rows[0] as unknown as Chat ?? null;} catch {throw new SafeError(503,'대화를 확인하지 못했어요.');}},
    async reserve(user,id,lease) {
      let result:unknown;
      try {const rows=await sql`select moa_private.moa_ai_reserve(${user}::uuid,${id}::uuid,${lease}::uuid) as result`;result=rows[0]?.result;}
      catch {throw new SafeError(503,'사용 한도를 확인하지 못했어요.');}
      if(result==='ok') return;
      if(result==='user_limit') throw new SafeError(429,'오늘 AI 사용 한도에 도달했어요. 내일 오전 9시에 다시 쓸 수 있어요. 더 필요하면 관리자에게 요청해 주세요.');
      if(result==='global_limit') throw new SafeError(429,'오늘 전체 AI 사용 한도에 도달했어요. 내일 오전 9시에 다시 쓸 수 있어요.');
      if(result==='busy') throw new SafeError(429,'진행 중인 요청이 있어요. 끝난 뒤 다시 보내 주세요.');
      throw new SafeError(403,'AI를 사용할 권한이 없어요.');
    },
    async finish(user,id,lease,conversation,form) {
      try {const rows=await sql`select moa_private.moa_ai_finish(${user}::uuid,${id}::uuid,${lease}::uuid,${conversation===null?null:JSON.stringify(conversation)}::jsonb,${form===null?null:JSON.stringify(form)}::jsonb) as accepted`;if(rows[0]?.accepted!==true) throw new Error('finish');}
      catch {throw new SafeError(503,'대화를 저장하지 못했어요.');}
    },
  };
}
