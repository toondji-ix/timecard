import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {unlinkSync} from 'node:fs';
import Database from 'better-sqlite3';
import {hash} from 'bcryptjs';

const renderOrigin='https://timecard-y77q.onrender.com';
let providerRequests=0;let mailFailure:{code:string;status:number;msg:string}|null=null;
const file=resolve('data/supabase-test-'+randomUUID()+'.sqlite'),base='http://localhost:3118';
let provider:Server,server:ChildProcess,db:Database.Database,logs='',providerUrl='',newPassword='Long-provider-password!';
const subject=randomUUID(),address='existing@example.invalid';
const account=()=>({id:subject,aud:'authenticated',role:'authenticated',email:address,email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{name:'Existing Person'},created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'});
const token=()=>{const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');return encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:subject,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),aud:'authenticated',role:'authenticated',email:address})+'.test-signature';};
const credentials=()=>({access_token:token(),refresh_token:'mock-refresh-token',token_type:'bearer',expires_in:3600,user:account()});
type Client=Map<string,string>;const browser:Client=new Map();
async function call(path:string,body?:object,client=browser,extraHeaders:Record<string,string>={}){const r=await fetch(base+'/api/'+path,{redirect:'manual',method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:base}:{}),...extraHeaders,Cookie:Array.from(client).map(([k,v])=>k+'='+v).join('; ')},...(body?{body:JSON.stringify(body)}:{})});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],at=pair.indexOf('=');client.set(pair.slice(0,at),pair.slice(at+1));}return {status:r.status,location:r.headers.get('location'),data:r.headers.get('content-type')?.includes('json')?await r.json():null};}
before(async()=>{
 provider=createServer(async(req,res)=>{providerRequests++;let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},url=new URL(req.url!,'http://provider');res.setHeader('Content-Type','application/json');res.setHeader('X-Supabase-Api-Version','2024-01-01');if(mailFailure&&['/auth/v1/signup','/auth/v1/resend','/auth/v1/recover'].includes(url.pathname)){res.statusCode=mailFailure.status;res.end(JSON.stringify(mailFailure));return;}
  if(url.pathname==='/auth/v1/signup'){res.end(JSON.stringify({...account(),email_confirmed_at:null}));return;}
  if(url.pathname==='/auth/v1/token'){
   if(url.searchParams.get('grant_type')==='pkce'&&(!body.code_verifier||body.auth_code==='expired-code')){res.statusCode=400;res.end(JSON.stringify({code:body.auth_code==='expired-code'?'flow_state_expired':'bad_code_verifier',msg:'Invalid PKCE exchange'}));return;}
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
 server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--port','3118'],{env:{...process.env,NODE_ENV:'development',NEXT_DIST_DIR:'.next-auth-test',DATABASE_PATH:file,TIMECARD_MAINTENANCE:'off',SUPABASE_URL:providerUrl,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_isolated_test',NEXT_PUBLIC_SUPABASE_URL:'',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_ANON_KEY:'',NEXT_PUBLIC_SUPABASE_ANON_KEY:'',SUPABASE_SECRET_KEY:'',SESSION_SECRET:'isolated-supabase-test-session-secret',APP_URL:renderOrigin,RENDER_EXTERNAL_URL:renderOrigin,EMAIL_API_KEY:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
 server.stdout?.on('data',v=>logs=(logs+v).slice(-6000));server.stderr?.on('data',v=>logs=(logs+v).slice(-6000));let ready=false;for(let i=0;i<30;i++){try{if((await fetch(base+'/api/public/config',{signal:AbortSignal.timeout(30000)})).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}assert.ok(ready,logs);db=new Database(file);
 db.prepare('INSERT INTO users(id,email,name,password,verified) VALUES(?,?,?,?,1)').run('existing-local',address,'Existing Person',await hash('Old-local-password!',10));
 db.prepare("INSERT INTO organizations(id,name) VALUES('existing-org','Existing workspace')").run();db.prepare("INSERT INTO memberships(id,org_id,user_id,role) VALUES('existing-membership','existing-org','existing-local','owner')").run();
},{timeout:240000});

test('foreign browser origins are rejected before reaching Supabase',async()=>{
 const before=providerRequests;for(const path of ['auth/signup','auth/login']){const r=await call(path,{name:'Intruder',email:address,password:newPassword},new Map(),{Origin:'https://attacker.example','x-forwarded-host':'attacker.example','x-forwarded-proto':'https'});assert.equal(r.status,403);assert.equal(r.data.error,'Invalid request origin.');}assert.equal(providerRequests,before);
});

test('email sender restrictions, throttling and SMTP failures are surfaced instead of reporting success',async()=>{
 for(const [index,failure] of [{code:'email_address_not_authorized',status:403,msg:'Email address not authorized'},{code:'over_email_send_rate_limit',status:429,msg:'Email rate limit exceeded'},{code:'unexpected_failure',status:500,msg:'Error sending confirmation email'}].entries()){
  mailFailure=failure;try{for(const path of ['auth/signup','auth/resend']){const r=await call(path,{name:'Email Test',email:`mail-failure-${index}@example.invalid`,password:newPassword});assert.equal(r.status,400);assert.equal(r.data.confirmationRequired,undefined);assert.match(r.data.error,index===0?/custom SMTP/:index===1?/sending limit/:/SMTP settings/);}}finally{mailFailure=null;}
 }
});

test('Supabase signup requires confirmation and local-password fallback cannot bypass the provider',async()=>{
 let r=await call('auth/signup',{name:'Existing Person',email:address,password:'Long-provider-password!'},browser,{Origin:renderOrigin});assert.equal(r.status,200);assert.equal(r.data.confirmationRequired,true);assert.equal((await call('state')).status,401);
 r=await call('auth/login',{email:address,password:'Old-local-password!'});assert.equal(r.status,400);
 assert.equal((await call('auth/resend',{email:address})).status,200);
});
test('verified provider login links the existing account without changing memberships and rejects forged provider cookies',async()=>{
 assert.equal((await call('auth/login',{email:address,password:newPassword},browser,{Origin:renderOrigin})).status,200);
 const r=await call('state');assert.equal(r.status,200);assert.equal(r.data.user.id,'existing-local');assert.equal(r.data.organization.id,'existing-org');assert.equal(r.data.user.supabase_id,subject);
 const forged=new Map(Array.from(browser).filter(([k])=>k==='timecard_session'));assert.equal((await call('state',undefined,forged)).status,401);
 assert.equal((db.prepare('SELECT count(*) n FROM users').get() as {n:number}).n,1);
});
test('workspace creation accepts the deployed HTTPS origin and still rejects foreign or unauthenticated requests',async()=>{
 const input={name:'Semester Technologies',timezone:'Africa/Lagos',start_time:'09:00',end_time:'18:00'},before=(db.prepare('SELECT count(*) n FROM organizations').get() as {n:number}).n;
 for(const headers of [{Origin:'https://attacker.example','x-forwarded-host':'attacker.example','x-forwarded-proto':'https'},{Origin:renderOrigin,'sec-fetch-site':'cross-site'}] as Record<string,string>[]){const rejected=await call('workspace',input,browser,headers);assert.equal(rejected.status,403);assert.equal(rejected.data.error,'Invalid request origin.');}
 assert.equal((await call('workspace',input,new Map(),{Origin:renderOrigin})).status,401);assert.equal((db.prepare('SELECT count(*) n FROM organizations').get() as {n:number}).n,before);
 const created=await call('workspace',input,browser,{Origin:renderOrigin});assert.equal(created.status,200,JSON.stringify(created.data));const org=created.data.org;
 try{const state=await call('state?org='+org);assert.equal(state.status,200);assert.equal(state.data.organization.name,input.name);assert.equal(state.data.organization.timezone,'Africa/Lagos');assert.equal(state.data.organization.end_time,'18:00');assert.equal(state.data.membership.role,'owner');assert.equal(state.data.user.id,'existing-local');assert.equal(state.data.leaveTypes.length,4);}finally{db.prepare('DELETE FROM audit_logs WHERE org_id=?').run(org);db.prepare('DELETE FROM leave_types WHERE org_id=?').run(org);db.prepare('DELETE FROM memberships WHERE org_id=?').run(org);db.prepare('DELETE FROM organizations WHERE id=?').run(org);}
});

test('privacy consent saves from the public HTTPS origin and rejects unsafe or non-consenting requests',async()=>{
 const membership='existing-membership',before=db.prepare('SELECT consent FROM memberships WHERE id=?').get(membership) as {consent:string|null};
 for(const headers of [{Origin:'https://attacker.example'},{Origin:renderOrigin,'sec-fetch-site':'cross-site'}] as Record<string,string>[]){const rejected=await call('consent?org=existing-org',{accept:true},browser,headers);assert.equal(rejected.status,403);}
 assert.equal((await call('consent?org=existing-org',{accept:true},new Map(),{Origin:renderOrigin})).status,401);
 assert.equal((await call('consent?org=another-workspace',{accept:true},browser,{Origin:renderOrigin})).status,400);
 assert.equal((await call('consent?org=existing-org',{accept:false},browser,{Origin:renderOrigin})).status,400);
 assert.equal((db.prepare('SELECT consent FROM memberships WHERE id=?').get(membership) as {consent:string|null}).consent,before.consent);
 const accepted=await call('consent?org=existing-org',{accept:true},browser,{Origin:renderOrigin});assert.equal(accepted.status,200,JSON.stringify(accepted.data));const state=await call('state?org=existing-org');assert.ok(state.data.membership.consent);assert.ok(Number.isFinite(Date.parse(state.data.membership.consent)));const audit=db.prepare("SELECT * FROM audit_logs WHERE org_id='existing-org' AND action='consent.accepted'").all();assert.equal(audit.length,1);
});

test('managers can create email and shareable invitations from the public origin while unsafe requests stay blocked',async()=>{
 const input={email:'new-teammate@example.invalid',role:'staff',department:'Designer'},before=(db.prepare('SELECT count(*) n FROM invites').get() as {n:number}).n;
 assert.equal((await call('invite?org=existing-org',input,browser,{Origin:'https://attacker.example'})).status,403);
 assert.equal((await call('invite?org=existing-org',input,new Map(),{Origin:renderOrigin})).status,401);
 assert.equal((await call('invite?org=another-workspace',input,browser,{Origin:renderOrigin})).status,400);
 db.prepare("UPDATE memberships SET role='staff' WHERE id='existing-membership'").run();try{const denied=await call('invite?org=existing-org',input,browser,{Origin:renderOrigin});assert.equal(denied.status,400);assert.match(denied.data.error,/Manager access required/);}finally{db.prepare("UPDATE memberships SET role='owner' WHERE id='existing-membership'").run();}
 assert.equal((db.prepare('SELECT count(*) n FROM invites').get() as {n:number}).n,before);
 const created=await call('invite?org=existing-org',input,browser,{Origin:renderOrigin});assert.equal(created.status,200,JSON.stringify(created.data));assert.equal(new URL(created.data.url).origin,renderOrigin);assert.equal(created.data.emailStatus,'not_configured');assert.match(created.data.message,/email delivery is not configured/);const token=new URL(created.data.url).searchParams.get('invite');assert.ok(token);const saved=db.prepare('SELECT * FROM invites WHERE token=?').get(token) as {org_id:string;email:string;role:string;department:string;expires:string};assert.equal(saved.org_id,'existing-org');assert.equal(saved.email,input.email);assert.equal(saved.role,input.role);assert.equal(saved.department,input.department);assert.ok(Date.parse(saved.expires)>Date.now()+6*86400000);const preview=await call('invite?token='+token);assert.equal(preview.status,200);assert.equal(preview.data.email,input.email);
 const delivery=db.prepare('SELECT d.status,d.last_error FROM invite_deliveries d JOIN invites i ON i.id=d.invite_id WHERE i.token=?').get(token) as {status:string;last_error:string};assert.equal(delivery.status,'pending');assert.equal(delivery.last_error,'missing_configuration');
 const link=await call('invite?org=existing-org',{email:'',role:'manager',department:''},browser,{Origin:renderOrigin});assert.equal(link.status,200);assert.equal(link.data.emailStatus,'not_requested');assert.equal(new URL(link.data.url).origin,renderOrigin);assert.ok(new URL(link.data.url).searchParams.get('invite'));
});

test('Supabase invitation and existing-user email callbacks require explicit workspace acceptance',async()=>{
 for(const type of ['invite','email']){const org=randomUUID(),token=randomUUID(),key=randomUUID();db.prepare('INSERT INTO organizations(id,name) VALUES(?,?)').run(org,'Invited workspace');db.prepare('INSERT INTO invites(id,org_id,email,role,department,token,expires) VALUES(?,?,?,?,?,?,?)').run(key,org,address,'staff','Design',token,new Date(Date.now()+86400000).toISOString());const fresh=new Map<string,string>();
 try{const callback=await call('auth/confirm?token_hash=mock-invite-hash&type='+type+'&flow=invite&invite='+token,undefined,fresh);assert.equal(callback.status,307);assert.equal(new URL(callback.location!).searchParams.get('invite'),token);assert.equal(db.prepare('SELECT id FROM memberships WHERE org_id=?').get(org),undefined);const accepted=await call('invite/accept',{token},fresh);assert.equal(accepted.status,200,JSON.stringify(accepted.data));assert.equal(accepted.data.org,org);const state=await call('state?org='+org,undefined,fresh);assert.equal(state.data.membership.role,'staff');assert.equal(state.data.membership.department,'Design');assert.equal((await call('invite/accept',{token},fresh)).status,400);}finally{db.prepare('DELETE FROM audit_logs WHERE org_id=?').run(org);db.prepare('DELETE FROM memberships WHERE org_id=?').run(org);db.prepare('DELETE FROM invites WHERE org_id=?').run(org);db.prepare('DELETE FROM organizations WHERE id=?').run(org);}
 }
});

test('workspace email callbacks reject revoked invites and the wrong recipient',async()=>{
 const key=randomUUID(),token=randomUUID();db.prepare('INSERT INTO invites(id,org_id,email,role,department,token,expires) VALUES(?,?,?,?,?,?,?)').run(key,'existing-org','someone-else@example.invalid','staff','',token,new Date(Date.now()+86400000).toISOString());
 try{const fresh=new Map<string,string>();let r=await call('auth/confirm?token_hash=mock&type=invite&flow=invite&invite='+token,undefined,fresh);assert.match(new URL(r.location!).searchParams.get('auth_error')!,/email address this workspace invitation/);assert.equal((await call('state',undefined,fresh)).status,401);db.prepare('UPDATE invites SET revoked=1 WHERE id=?').run(key);const before=providerRequests;r=await call('auth/confirm?token_hash=mock&type=invite&flow=invite&invite='+token,undefined,new Map());assert.match(new URL(r.location!).searchParams.get('auth_error')!,/expired or was revoked/);assert.equal(providerRequests,before);}finally{db.prepare('DELETE FROM invites WHERE id=?').run(key);}
});

test('Google uses PKCE, keeps invitation context, and callback errors return to the sign-in screen',async()=>{
 const r=await call('auth/google?invite=invitation-token');assert.equal(r.status,307);const url=new URL(r.location!);assert.equal(url.origin,providerUrl);assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert.ok(url.searchParams.get('code_challenge'));
 const result=await call('auth/callback?code=mock-code');assert.equal(result.status,307);assert.equal(new URL(result.location!).searchParams.get('invite'),'invitation-token');
 const bad=await call('auth/callback?error=access_denied');assert.ok(new URL(bad.location!).searchParams.has('auth_error'));
});
test('Google codes returned to the landing URL are exchanged before the landing page renders',async()=>{
 const fresh=new Map<string,string>();assert.equal((await call('auth/google',undefined,fresh)).status,307);
 const root=await fetch(base+'/?code=mock-code',{redirect:'manual',headers:{Cookie:Array.from(fresh).map(([k,v])=>k+'='+v).join('; ')}});assert.equal(root.status,307);assert.equal(root.headers.get('cache-control'),'no-store');const callback=new URL(root.headers.get('location')!,base);assert.equal(callback.pathname,'/api/auth/callback');assert.equal(callback.searchParams.get('code'),'mock-code');
 const done=await call('auth/callback'+callback.search,undefined,fresh);assert.equal(done.status,307);const final=new URL(done.location!);assert.equal(final.searchParams.get('auth'),'verified');assert.ok(!final.searchParams.has('code'));assert.equal((await call('state',undefined,fresh)).status,200);
});

test('password recovery codes returned to Site URL keep their recovery flow',async()=>{
 const fresh=new Map<string,string>();assert.equal((await call('auth/reset-request',{email:address},fresh)).status,200);
 const root=await fetch(base+'/?code=mock-code',{redirect:'manual'});assert.equal(root.status,307);const callback=new URL(root.headers.get('location')!,base);const done=await call('auth/callback'+callback.search,undefined,fresh);assert.equal(done.status,307);const final=new URL(done.location!);assert.ok(final.searchParams.get('reset'));assert.ok(!final.searchParams.has('code'));assert.ok(!final.searchParams.has('auth'));
});

test('provider server errors on the callback return a visible, safe sign-in error',async()=>{
 const r=await call('auth/callback?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%3A+SECRET_CODE');assert.equal(r.status,307);const url=new URL(r.location!);assert.match(url.searchParams.get('auth_error')!,/Client ID and Client Secret/);assert.ok(!r.location!.includes('SECRET_CODE'));assert.ok(!url.searchParams.has('auth'));
});

test('recovery callbacks distinguish missing browser sessions from expired links',async()=>{
 const fresh=new Map<string,string>();let r=await call('auth/callback?code=mock-code&flow=recovery',undefined,fresh);assert.match(new URL(r.location!).searchParams.get('auth_error')!,/browser session/);
 assert.equal((await call('auth/reset-request',{email:address})).status,200);r=await call('auth/callback?code=expired-code&flow=recovery');assert.match(new URL(r.location!).searchParams.get('auth_error')!,/expired or has already been used/);
 r=await call('auth/callback?error=access_denied&error_code=otp_expired');assert.match(new URL(r.location!).searchParams.get('auth_error')!,/expired or has already been used/);
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
