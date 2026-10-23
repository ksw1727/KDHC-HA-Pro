import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { SafeError, limits, uuid, parseInput, providerConfig, context, callProvider, checkedResult, ensureTitle, rejectReasons, freshTemplates, isNewForm, type Turn } from './ai';
import { makeStore, type Store } from './store';
export type Request = IncomingMessage & {body?:unknown};
export interface Dependencies { env?:NodeJS.ProcessEnv; store?:Store; provider?:typeof callProvider }
async function body(req:Request):Promise<unknown> {
  if(req.body!==undefined) { if(typeof req.body==='string') { if(Buffer.byteLength(req.body)>limits.request) throw new SafeError(413,'요청이 너무 커요.'); return JSON.parse(req.body); } return req.body; }
  const chunks:Buffer[]=[]; let n=0;
  for await (const c of req) { const b=Buffer.from(c); n+=b.length; if(n>limits.request) throw new SafeError(413,'요청이 너무 커요.'); chunks.push(b); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function handler(route:'health'|'chat'|'form'|'account', deps:Dependencies={}) {
  return async (req:Request,res:ServerResponse) => {
    const env=deps.env ?? process.env; let streaming=false; let timedOut=false; let store:Store|undefined; let user=''; let chatId=''; let lease=''; let reserved=false; let saved=false;
    const controller=new AbortController();
    const abort=()=>controller.abort(); const closed=()=>{if(!res.writableEnded) abort();};
    req.on('aborted',abort); res.on('close',closed);
    const started=Date.now();
    const timeout=setTimeout(()=>{timedOut=true;abort();},limits.timeout);
    // 시간 초과로 멈춘 것은 연결이 살아 있으니 안내 문구를 보낸다 (안 보내면 화면에 '(답이 없어요)'만 남는다)
    const emit=(value:unknown)=>{ if(!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value)+'\n'); };
    const json=(status:number,value:unknown)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.end(JSON.stringify(value));};
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const origin=req.headers.origin;
      const forwarded=req.headers['x-forwarded-host']; const host=typeof forwarded==='string'?forwarded:req.headers.host;
      const proto=req.headers['x-forwarded-proto'] ?? 'https';
      if(origin && origin!==env.SERVER_APP_ORIGIN && origin!==`${proto}://${host}`) throw new SafeError(403,'허용되지 않은 접근이에요.');
      if(origin && env.SERVER_APP_ORIGIN===origin) {res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
      if(req.method==='OPTIONS') {res.statusCode=204;res.end();return;}
      if(req.method!==(route==='chat'?'POST':'GET')) {res.setHeader('Allow',route==='chat'?'POST':'GET');throw new SafeError(405,'지원하지 않는 요청이에요.');}
      const authorization=req.headers.authorization;
      if(!authorization || !/^Bearer [^\s]+$/i.test(authorization)) throw new SafeError(401,'로그인이 필요해요.');
      store=deps.store ?? makeStore(env);
      if(route==='account') {
        if(!store.account) throw new SafeError(503,'계정 확인을 사용할 수 없어요.');
        const identity=await store.account(authorization.slice(7));json(200,{...identity,approved:true});return;
      }
      user=await store.user(authorization.slice(7));
      if(controller.signal.aborted) throw new SafeError(408,'요청 시간이 지났어요.');
      if(route==='health') {json(200,{mode:'cloud',engines:{claude:!!providerConfig('claude',env),codex:!!providerConfig('codex',env)}});return;}
      if(route==='form') { const id=new URL(req.url ?? '', 'https://local.invalid').searchParams.get('chatId'); if(!uuid(id)) throw new SafeError(400,'대화 번호가 올바르지 않아요.');const chat=await store.chat(id,user);if(!chat || chat.user_id!==user) throw new SafeError(404,'대화를 찾을 수 없어요.');json(200,chat.form);return; }
      let raw:unknown; try {raw=await body(req);} catch(e) {if(e instanceof SafeError) throw e;throw new SafeError(400,'JSON 요청이 올바르지 않아요.');}
      const input=parseInput(raw);
      const cfg=providerConfig(input.engine,env); if(!cfg) throw new SafeError(503,'인공지능 키와 모델 설정이 필요해요.');
      chatId=input.chatId ?? randomUUID();
      const chat=input.chatId ? await store.chat(chatId,user) : null;
      if(input.chatId && !chat) throw new SafeError(404,'대화를 찾을 수 없어요.');
      if(chat && chat.user_id!==user) throw new SafeError(404,'대화를 찾을 수 없어요.');
      const previous=input.form ?? chat?.form ?? null;
      const history:Turn[]=(chat?.conversation ?? []).slice(-12);
      while(Buffer.byteLength(JSON.stringify(history))>limits.history) history.shift();
      const fresh=freshTemplates();   // 사용자가 다른 새 양식을 원하면 AI가 이 번호로 만든다
      const prompt=context(input,previous,history,fresh);
      lease=randomUUID();
      if(controller.signal.aborted) throw new SafeError(408,'요청 시간이 지났어요.');
      await store.reserve(user,chatId,lease);reserved=true;
      res.statusCode=200;res.setHeader('content-type','application/x-ndjson; charset=utf-8');res.setHeader('X-Accel-Buffering','no');streaming=true;
      emit({type:'chat',chatId});emit({type:'status',text:'양식을 준비하고 있어요.'});
      let result:ReturnType<typeof checkedResult>=null;
      const secrets=[env.ANTHROPIC_API_KEY,env.OPENAI_API_KEY,env.DATABASE_URL].filter((s):s is string=>!!s);
      let reasons:string[]=[];
      for(let attempt=0;attempt<3 && !controller.signal.aborted;attempt++) {
        // 남은 시간이 첫 시도에 걸린 시간보다 짧으면 다시 시도하지 않는다(시간 초과로 아무 답도 못 받는 것보다 낫다)
        if(attempt && Date.now()-started>limits.timeout*0.6) break;
        const retry=attempt?`\n이전 응답은 계약/내보내기/식별자 검사에 실패했다.${reasons.length?` 실패 이유: ${reasons.join(' / ')}.`:''} 같은 요구를 다시 검토하고 유효한 JSON으로 고쳐라. 확신 없으면 form:null로 설명하라.`:'';
        try { const raw=await (deps.provider ?? callProvider)(input.engine,cfg,prompt+retry,controller.signal); result=checkedResult(raw,previous,secrets,fresh); if(!result) reasons=rejectReasons(raw,previous,fresh); } catch(e) { if(controller.signal.aborted) break; if(e instanceof SafeError) throw e; }
        if(result) break;
      }
      if(timedOut) throw new SafeError(504,'AI 답이 오래 걸려 멈췄어요. 같은 말을 한 번 더 보내거나, 요청을 조금 나눠 보내 주세요.');
      if(controller.signal.aborted) throw new SafeError(408,'요청 시간이 지났거나 연결이 끊겼어요.');
      if(!result) throw new SafeError(502,'안전한 양식을 만들지 못했어요. 요청을 나눠 다시 시도해 주세요.');
      if(result.form) result={...result,form:ensureTitle(result.form,input.message,isNewForm(result.form,previous,fresh)?null:previous)};
      const conversation:Turn[]=[...history,{role:'user',content:input.message},{role:'assistant',content:result.text}];
      while(Buffer.byteLength(JSON.stringify(conversation))>limits.history) conversation.shift();
      await store.finish(user,chatId,lease,conversation,result.form ?? previous);saved=true;
      emit({type:'text',text:result.text});if(result.form) emit({type:'form',schema:result.form});emit({type:'done'});res.end();
    } catch(error) {
      const safe=error instanceof SafeError ? error : new SafeError(500,'요청을 처리하지 못했어요. 다시 시도해 주세요.');
      if(!res.destroyed) {if(streaming) {emit({type:'error',text:safe.message});emit({type:'done'});res.end();} else json(safe.status,{error:safe.message});}
    } finally {
      clearTimeout(timeout);req.off('aborted',abort);res.off('close',closed);
      if(reserved && !saved && store) {try {await store.finish(user,chatId,lease,null,null);} catch { /* retain lease until expiry; fail closed */ }}
    }
  };
}
