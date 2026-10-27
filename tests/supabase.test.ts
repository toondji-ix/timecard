import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {unlinkSync} from 'node:fs';
import Database from 'better-sqlite3';
import {hash} from 'bcryptjs';

const file=resolve('data/supabase-test-'+randomUUID()+'.sqlite'),base='http://localhost:3118';
let provider:Server,server:ChildProcess,db:Database.Database,logs='',providerUrl='',newPassword='Long-provider-password!';
const subject=randomUUID(),address='existing@example.invalid';
const account=()=>({id:subject,aud:'authenticated',role:'authenticated',email:address,email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{name:'Existing Person'},created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'});
const token=()=>{const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');return encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:subject,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),aud:'authenticated',role:'authenticated',email:address})+'.test-signature';};
const credentials=()=>({access_token:token(),refresh_token:'mock-refresh-token',token_type:'bearer',expires_in:3600,user:account()});
type Client=Map<string,string>;const browser:Client=new Map();
async function call(path:string,body?:object,client=browser){const r=await fetch(base+'/api/'+path,{redirect:'manual',method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),Cookie:Array.from(client).map(([k,v])=>k+'='+v).join('; ')},...(body?{body:JSON.stringify(body)}:{})});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],at=pair.indexOf('=');client.set(pair.slice(0,at),pair.slice(at+1));}return {status:r.status,location:r.headers.get('location'),data:r.headers.get('content-type')?.includes('json')?await r.json():null};}
before(async()=>{
 provider=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},url=new URL(req.url!,'http://provider');res.setHeader('Content-Type','application/json');
  if(url.pathname==='/auth/v1/signup'){res.end(JSON.stringify({...account(),email_confirmed_at:null}));return;}
  if(url.pathname==='/auth/v1/token'){
   if(url.searchParams.get('grant_type')==='password'&&(body.email!==address||body.password!==newPassword)){res.statusCode=400;res.end(JSON.stringify({code:'invalid_credentials',msg:'Invalid login credentials'}));return;}
   res.end(JSON.stringify(credentials()));return;
  }
  if(url.pathname==='/auth/v1/user'){
   if(!req.headers.authorization?.startsWith('Bearer ')){res.statusCode=401;res.end('{}');return;}
   if(req.method==='PUT')newPassword=body.password;
   res.end(JSON.stringify(account()));return;
  }
  if(url.pathname==='/auth/v1/verify'){res.end(JSON.stringify(credentials()));return;}
  if(['/auth/v1/recover','/auth/v1/resend','/auth/v1/logout'].includes(url.pathname)){res.end('{}');return;}
  res.statusCode=404;res.end('{}');
 });await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));providerUrl='http://127.0.0.1:'+(provider.address() as {port:number}).port;
 server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--port','3118'],{env:{...process.env,NODE_ENV:'development',NEXT_DIST_DIR:'.next-auth-test',DATABASE_PATH:file,TIMECARD_MAINTENANCE:'off',NEXT_PUBLIC_SUPABASE_URL:providerUrl,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_isolated_test',SUPABASE_SECRET_KEY:'',SESSION_SECRET:'isolated-supabase-test-session-secret',APP_URL:base,EMAIL_API_KEY:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
 server.stdout?.on('data',v=>logs=(logs+v).slice(-6000));server.stderr?.on('data',v=>logs=(logs+v).slice(-6000));let ready=false;for(let i=0;i<30;i++){try{if((await fetch(base+'/api/public/config',{signal:AbortSignal.timeout(30000)})).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}assert.ok(ready,logs);db=new Database(file);
 db.prepare('INSERT INTO users(id,email,name,password,verified) VALUES(?,?,?,?,1)').run('existing-local',address,'Existing Person',await hash('Old-local-password!',10));
 db.prepare("INSERT INTO organizations(id,name) VALUES('existing-org','Existing workspace')").run();db.prepare("INSERT INTO memberships(id,org_id,user_id,role) VALUES('existing-membership','existing-org','existing-local','owner')").run();
},{timeout:240000});

test('Supabase signup requires confirmation and local-password fallback cannot bypass the provider',async()=>{
 let r=await call('auth/signup',{name:'Existing Person',email:address,password:'Long-provider-password!'});assert.equal(r.status,200);assert.equal(r.data.confirmationRequired,true);assert.equal((await call('state')).status,401);
 r=await call('auth/login',{email:address,password:'Old-local-password!'});assert.equal(r.status,400);
 assert.equal((await call('auth/resend',{email:address})).status,200);
});
test('verified provider login links the existing account without changing memberships and rejects forged provider cookies',async()=>{
 assert.equal((await call('auth/login',{email:address,password:newPassword})).status,200);
 const r=await call('state');assert.equal(r.status,200);assert.equal(r.data.user.id,'existing-local');assert.equal(r.data.organization.id,'existing-org');assert.equal(r.data.user.supabase_id,subject);
 const forged=new Map(Array.from(browser).filter(([k])=>k==='timecard_session'));assert.equal((await call('state',undefined,forged)).status,401);
 assert.equal((db.prepare('SELECT count(*) n FROM users').get() as {n:number}).n,1);
});
test('Google uses PKCE, keeps invitation context, and callback errors return to the sign-in screen',async()=>{
 const r=await call('auth/google?invite=invitation-token');assert.equal(r.status,307);const url=new URL(r.location!);assert.equal(url.origin,providerUrl);assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert.ok(url.searchParams.get('code_challenge'));
 const result=await call('auth/callback?code=mock-code');assert.equal(result.status,307);assert.equal(new URL(result.location!).searchParams.get('invite'),'invitation-token');
 const bad=await call('auth/callback?error=access_denied');assert.ok(new URL(bad.location!).searchParams.has('auth_error'));
});
test('recovery requires its one-time token and invalidates earlier application sessions',async()=>{
 const earlier=new Map(browser);
 assert.equal((await call('auth/reset-request',{email:address})).status,200);
 assert.equal((await call('auth/reset',{token:randomUUID(),password:'New-provider-password!'})).status,400);
 const r=await call('auth/confirm?token_hash=mock-recovery-hash&type=recovery');const recovery=new URL(r.location!).searchParams.get('reset');assert.ok(recovery);
 assert.equal((await call('auth/reset',{token:recovery,password:'New-provider-password!'})).status,200);
 assert.equal((await call('state',undefined,earlier)).status,401);assert.equal((await call('state')).status,401);
 assert.equal((await call('auth/login',{email:address,password:'New-provider-password!'})).status,200);
 assert.equal((await call('auth/reset',{token:recovery,password:'Another-long-password!'})).status,400);
});
test('ownership transfer reauthenticates with Supabase and missing admin configuration never deletes local data',async()=>{
 const r=await call('owner/transfer?org=existing-org',{id:'missing',password:'Old-local-password!'});assert.match(r.data.error,/password is incorrect/);
 db.prepare("UPDATE memberships SET role='staff' WHERE id='existing-membership'").run();
 const deleted=await call('profile/delete?org=existing-org',{confirm:'DELETE',password:newPassword});assert.equal(deleted.status,400);assert.match(deleted.data.error,/SUPABASE_SECRET_KEY/);assert.ok(db.prepare("SELECT id FROM users WHERE id='existing-local'").get());
});
after(async()=>{server?.kill();await new Promise(r=>setTimeout(r,1500));provider?.closeAllConnections();await new Promise<void>(r=>provider?provider.close(()=>r()):r());db?.close();for(const suffix of ['','-wal','-shm'])try{unlinkSync(file+suffix);}catch{}});
