import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {spawn, type ChildProcess} from 'node:child_process';
import {resolve, sep} from 'node:path';
import {rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const directory=resolve('data/pg-http-'+randomUUID()),base='http://localhost:3121';
let provider:Server,app:ChildProcess,logs='',workspace='';
const cookies=new Map<string,string>();
const account={id:randomUUID(),aud:'authenticated',role:'authenticated',email:'pg-owner@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{name:'Postgres owner'},created_at:'2026-01-01T00:00:00Z'};
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
const token=()=>encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:account.id,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})+'.fixture';
async function call(path:string,body?:object){
 const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},...(body?{body:JSON.stringify(body)}:{})});
 for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
 return {status:response.status,data:await response.json()};
}
before(async()=>{
 provider=createServer(async(req,res)=>{for await(const chunk of req){}res.setHeader('Content-Type','application/json');
  if(req.url?.startsWith('/auth/v1/token'))res.end(JSON.stringify({access_token:token(),refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user:account}));
  else if(req.url==='/auth/v1/user')res.end(JSON.stringify(account));
  else if(req.url?.startsWith('/auth/v1/logout'))res.end('{}');
  else {res.statusCode=404;res.end('{}');}
 });await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 const providerUrl='http://127.0.0.1:'+(provider.address() as {port:number}).port;
 app=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--port','3121'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'development',DATABASE_URL:'',DATABASE_TEST_PGLITE_PATH:directory,NEXT_DIST_DIR:'.next-pg-test',TIMECARD_MAINTENANCE:'off',APP_URL:base,RENDER_EXTERNAL_URL:'',SUPABASE_URL:providerUrl,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'',SESSION_SECRET:'postgres-http-fixture-stable-session-secret',DATA_ENCRYPTION_KEY:'ab'.repeat(32),EMAIL_API_KEY:'',PAYSTACK_SECRET_KEY:''}});
 app.stdout?.on('data',v=>logs=(logs+v).slice(-8000));app.stderr?.on('data',v=>logs=(logs+v).slice(-8000));
 let ready=false;for(let i=0;i<40;i++){try{if((await fetch(base+'/api/public/config',{signal:AbortSignal.timeout(30000)})).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}assert.ok(ready,logs);
},{timeout:240000});
test('PostgreSQL HTTP onboarding, dashboard, consent and invitation keep their existing behavior',async()=>{
 let response=await call('auth/login',{email:account.email,password:'Fixture-password!'});assert.equal(response.status,200,JSON.stringify(response.data));
 assert.equal((await call('state')).data.organization,null);
 response=await call('workspace',{name:'Durable HTTP workspace',timezone:'Africa/Lagos',start_time:'09:00',end_time:'17:00'});assert.equal(response.status,200,JSON.stringify(response.data));workspace=response.data.org;
 response=await call('state');assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.organization.id,workspace);assert.equal(response.data.membership.role,'owner');
 response=await call('consent?org='+workspace,{accept:true});assert.equal(response.status,200,JSON.stringify(response.data));
 response=await call('invite?org='+workspace,{email:'',role:'staff',department:'Engineering'});assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(new URL(response.data.url).origin,base);
 response=await call('state');assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.invites.length,1);
});
test('PostgreSQL sign-out and verified sign-in restore the same workspace without onboarding',async()=>{
 const id=(await call('state')).data.user.id;
 assert.equal((await call('auth/logout',{})).status,200);assert.equal((await call('state')).status,401);
 assert.equal((await call('auth/login',{email:account.email,password:'Fixture-password!'})).status,200);
 const response=await call('state');assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.organization.id,workspace);assert.equal(response.data.user.id,id);assert.equal(response.data.workspaces.length,1);
});
test('PostgreSQL sums reserved leave as numbers when checking the remaining balance',async()=>{
 const state=(await call('state')).data,type=state.leaveTypes.find((t:any)=>t.name==='Annual');
 const monday=new Date(Date.UTC(new Date().getUTCFullYear()+1,0,5));while(monday.getUTCDay()!==1)monday.setUTCDate(monday.getUTCDate()+1);
 const day=(offset:number)=>new Date(monday.getTime()+offset*86400000).toISOString().slice(0,10);
 for(const [start,end] of [[0,1],[2,4]]){const response=await call('leave?org='+workspace,{type_id:type.id,start:day(start),end:day(end),note:'PostgreSQL numeric balance check'});assert.equal(response.status,200,JSON.stringify(response.data));}
 assert.equal((await call('state')).data.leaveRequests.length,2);
});
after(async()=>{
 if(app&&!app.killed){app.kill();await new Promise<void>(r=>{app.once('exit',()=>r());setTimeout(r,5000);});}
 if(provider)await new Promise<void>(r=>provider.close(()=>r()));
 // Only remove this test's randomly named database directory.
 if(directory.startsWith(resolve('data')+sep))try{rmSync(directory,{recursive:true,force:true});}catch{}
});
