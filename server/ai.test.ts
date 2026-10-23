// @vitest-environment node
import { describe,it,expect,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { handler, type Request } from './http';
import { checkedResult, parseInput, callProvider, SafeError, validForm, limits, rejectReasons, freshTemplates, tidyAggregations } from './ai';
import { newSchema } from '../src/generator/state/newSchema';
import type { Store } from './store';
import type { ServerResponse } from 'node:http';
const USER='08065277-5ca0-43d2-9df4-d31fb93b1249';
const CHAT='c3a6eb32-5ee8-481a-a773-176f6787a5b2';
const env={ANTHROPIC_API_KEY:'test-secret-key',ANTHROPIC_MODEL:'explicit-test-model',OPENAI_API_KEY:'fake-openai-key',OPENAI_MODEL:'explicit-openai-model'};
function form() {const f=newSchema('list',new Date('2026-01-01'),{formId:CHAT,key:()=> 'f_abcd'});f.title='교육';f.org.orgs=['강남지사'];return f;}
function setup() {
 const store:Store={user:vi.fn(async()=>USER),chat:vi.fn(async()=>null),reserve:vi.fn(async()=>{}),finish:vi.fn(async()=>{})};
 const provider=vi.fn<typeof callProvider>(async()=>({text:'목록형으로 준비했어요.',form:form()}));
 return {store,provider};
}
async function run(route:'health'|'chat'|'form',body:unknown, deps:ReturnType<typeof setup>,auth=true,url='/api/ai/chat') {
 const req=Object.assign(new EventEmitter(),{method:route==='chat'?'POST':'GET',headers:auth?{authorization:'Bearer fake-token'}:{},body,url}) as Request;
 const res=Object.assign(new EventEmitter(),{statusCode:200,headers:{} as Record<string,unknown>,parts:[] as string[],destroyed:false,writableEnded:false,setHeader(k:string,v:unknown){this.headers[k]=v;},write(s:string){this.parts.push(s);},end(s?:string){if(s)this.parts.push(s);this.writableEnded=true;}});
 await handler(route,{...deps,env})(req,res as unknown as ServerResponse);return res;
}
describe('cloud AI fail closed',()=>{
 it.each(['list','header-list','matrix','fill-in','collect','free'] as const)('accepts all six valid layout starters: %s',layout=>{
   let n=0;const f=newSchema(layout,new Date(),{formId:CHAT,key:()=> 'f_'+String(++n).padStart(4,'0')});f.title='검증';f.org.orgs=['강남지사'];
   if(layout==='fill-in') {f.org.mode='input';}
   expect(validForm(f,true)).toBe(true);
 });
 it('rejects malformed JSON before reserve',async()=>{const d=setup();expect((await run('chat','{',d)).statusCode).toBe(400);expect(d.store.reserve).not.toHaveBeenCalled();});
 it('requires explicitly configured model for availability',async()=>{const d=setup();const req=Object.assign(new EventEmitter(),{method:'GET',headers:{authorization:'Bearer fake'},url:'/api/ai/health'}) as Request;let result='';const res=Object.assign(new EventEmitter(),{setHeader(){},end(x:string){result=x;},writableEnded:false,destroyed:false});await handler('health',{...d,env:{ANTHROPIC_API_KEY:'test-key'}})(req,res as unknown as ServerResponse);expect(JSON.parse(result).engines).toEqual({claude:false,codex:false});});

 it('rejects missing bearer before auth/provider',async()=>{const d=setup(),r=await run('chat',{},d,false);expect(r.statusCode).toBe(401);expect(d.store.user).not.toHaveBeenCalled();expect(d.provider).not.toHaveBeenCalled();});
 it('rejects auth verification failure',async()=>{const d=setup();vi.mocked(d.store.user).mockRejectedValue(new SafeError(401,'로그인이 필요해요.'));expect((await run('health',{},d)).statusCode).toBe(401);expect(d.provider).not.toHaveBeenCalled();});
 it('rejects another owner and nonexisting IDs',async()=>{const d=setup();vi.mocked(d.store.chat).mockResolvedValue({id:CHAT,user_id:'other',conversation:[],form:null});expect((await run('chat',{chatId:CHAT,engine:'claude',message:'만들어줘'},d)).statusCode).toBe(404);expect(d.store.reserve).not.toHaveBeenCalled();expect(d.provider).not.toHaveBeenCalled();});
 it.each([{engine:'other',message:'a'},{engine:'claude',message:1},{engine:'claude',message:'x'.repeat(6001)},{engine:'claude',message:'a',files:[]},{engine:'claude',message:'a',sources:[{name:'x',text:'a',base64:'x'}]},{engine:'claude',message:'a',form:{}}])('rejects malformed before provider %j',async body=>{const d=setup();expect((await run('chat',body,d)).statusCode).toBe(400);expect(d.provider).not.toHaveBeenCalled();expect(d.store.reserve).not.toHaveBeenCalled();});
 it('quota unavailable never calls provider',async()=>{const d=setup();vi.mocked(d.store.reserve).mockRejectedValue(new Error('internal provider key'));const r=await run('chat',{engine:'claude',message:'목록'},d);expect(r.statusCode).toBe(500);expect(d.provider).not.toHaveBeenCalled();expect(r.parts.join('')).not.toContain('internal provider key');});
 it('returns cloud engine availability and form owner result',async()=>{const d=setup();expect(JSON.parse((await run('health',null,d)).parts.join(''))).toEqual({mode:'cloud',engines:{claude:true,codex:true}});vi.mocked(d.store.chat).mockResolvedValue({id:CHAT,user_id:USER,conversation:[],form:form()});expect(JSON.parse((await run('form',null,d,true,`/api/ai/form?chatId=${CHAT}`)).parts.join('')).title).toBe('교육');});
 it('emits compatible NDJSON only after validated save',async()=>{const d=setup(),r=await run('chat',{engine:'claude',message:'목록'},d);const events=r.parts.map(x=>JSON.parse(x));expect(events.map(e=>e.type)).toEqual(['chat','status','text','form','done']);expect(d.store.finish).toHaveBeenCalledTimes(1);expect(events[3].schema.title).toBe('교육');});
 it('invalid repair output is never emitted',async()=>{const d=setup();d.provider.mockResolvedValue({text:'bad',form:{} as ReturnType<typeof form>});const r=await run('chat',{engine:'claude',message:'목록'},d);expect(d.provider).toHaveBeenCalledTimes(3);expect(r.parts.map(x=>JSON.parse(x).type)).toEqual(['chat','status','error','done']);expect(d.store.finish).toHaveBeenCalledWith(USER,expect.any(String),expect.any(String),null,null);});
 it('repairs once and preserves identifiers',async()=>{const f=form();expect(checkedResult({text:'ok',form:{...f,formId:USER}},f,[])).toBeNull();expect(checkedResult({text:'test-secret-key',form:f},f,['test-secret-key'])).toBeNull();expect(checkedResult({text:'ok',form:f},f,[])).not.toBeNull();});
 it('accepts a different new form only from this request templates',()=>{const f=form(),t=freshTemplates()[0];
   const fresh={...t,title:'[테스트] 버튼 확인',org:{...t.org,orgs:['강남지사']}};
   // 같은 이름 항목의 key가 달라도 새 양식이면 받는다 / 이번 요청에서 주지 않은 번호는 받지 않는다
   expect(checkedResult({text:'ok',form:fresh},f,[],[t])).not.toBeNull();
   expect(checkedResult({text:'ok',form:fresh},f,[],[])).toBeNull();
   expect(checkedResult({text:'ok',form:{...fresh,createdAt:'2020-01-01T00:00:00.000Z'}},f,[],[t])).toBeNull();
   expect(rejectReasons({text:'ok',form:{...fresh,formId:USER}},f,[t])[0]).toContain('templates');});
 it('fixes aggregations the form cannot use instead of asking again',()=>{const t=freshTemplates()[0];
   const none={...t,title:'명단',org:{mode:'none' as const}};   // 제출처 구분 없음 + 시작 양식의 제출 현황표
   expect(checkedResult({text:'ok',form:none},null,[])).toBeNull();
   const fixed=tidyAggregations({text:'ok',form:none}) as {form:typeof none};
   expect(fixed.form.aggregations).not.toContain('submission-status');
   expect(checkedResult(fixed,null,[])).not.toBeNull();
   expect(tidyAggregations({text:'x',form:null})).toEqual({text:'x',form:null});});
 it('uses fixed endpoints and suppresses provider error payload',async()=>{const fetcher=vi.fn(async()=>new Response('raw secret upstream',{status:400})) as unknown as typeof fetch;await expect(callProvider('codex',{key:'fake',model:'explicit'},'{}',new AbortController().signal,fetcher)).rejects.toThrow('인공지능 연결');expect(vi.mocked(fetcher).mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');});
 it('rejects unsupported source payload without storing it',()=>{expect(()=>parseInput({engine:'codex',message:'x',sources:[{name:'a',text:'x'.repeat(12001)}]})).toThrow();});
 it('aborts provider when HTTP response is disconnected',async()=>{
   const d=setup();let started!:()=>void;const ready=new Promise<void>(r=>started=r);let didAbort=false;
   d.provider.mockImplementation(async (_engine,_cfg,_prompt,signal)=>{started();await new Promise<void>(resolve=>{signal.addEventListener('abort',()=>{didAbort=true;resolve();},{once:true});});throw new Error('abort');});
   const server=createServer((req,res)=>{void handler('chat',{...d,env})(req,res);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string') throw new Error('address');
   const req=httpRequest({hostname:'127.0.0.1',port:address.port,path:'/api/ai/chat',method:'POST',headers:{authorization:'Bearer fake','content-type':'application/json'}},res=>res.resume());req.on('error',()=>{});req.end(JSON.stringify({engine:'claude',message:'목록'}));await ready;req.destroy();await new Promise(r=>setTimeout(r,30));expect(didAbort).toBe(true);await new Promise<void>(r=>server.close(()=>r()));
 });
 it('시간 초과면 화면에 안내 문구를 보낸다 (빈 답으로 끝나지 않게)',async()=>{
   const d=setup();const saved=limits.timeout;limits.timeout=20;
   d.provider.mockImplementation(async(_e,_c,_p,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('abort')),{once:true})));
   try {const r=await run('chat',{engine:'codex',message:'목록'},d);const events=r.parts.map(x=>JSON.parse(x));expect(events.map(e=>e.type)).toEqual(['chat','status','error','done']);expect(events[2].text).toMatch(/오래 걸려/);expect(d.provider).toHaveBeenCalledTimes(1);}
   finally {limits.timeout=saved;}
 });
 it('다시 시도할 때 실패 이유를 AI에게 알려 준다',async()=>{
   const d=setup();const bad={...form(),org:{mode:'preset' as const,orgs:[]}};d.provider.mockResolvedValueOnce({text:'x',form:bad});
   await run('chat',{engine:'codex',message:'목록'},d);
   expect(rejectReasons({text:'x',form:bad},null).length).toBeGreaterThan(0);
   expect(d.provider.mock.calls[1][2]).toContain('실패 이유');
 });
});
