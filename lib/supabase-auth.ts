import {cookies} from 'next/headers';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {id,one,run,now} from './db';
import {session,user,logout,rateLimit} from './auth';
import {supabaseConfigured,supabaseServer,linkSupabaseUser} from './supabase';
import {useSupabaseAuth} from './supabase-config';
import {authBaseUrl} from './auth-urls';
import {authRedirectError} from './auth-redirect-error';

const email=z.string().email().max(254).transform(v=>v.toLowerCase());
const password=z.string().min(10).max(128);
const base=()=>authBaseUrl();
const json=(data:object={})=>NextResponse.json({ok:true,...data},{headers:{'Cache-Control':'no-store'}});
function emailFailure(error:{code?:string;status?:number;message:string},operation:string){
 // Log diagnostic codes only: no addresses, tokens, passwords or SMTP details.
 console.warn('Supabase authentication email request failed',{operation,code:error.code||'unknown',status:error.status});
 if(error.code==='email_address_not_authorized'||/email address not authorized/i.test(error.message))return Error('Email delivery is restricted to authorized addresses. Ask your administrator to configure custom SMTP in Supabase.');
 if(error.code==='over_email_send_rate_limit'||error.code==='over_request_rate_limit'||error.status===429)return Error('The authentication email sending limit has been reached. Wait before requesting another email, or ask your administrator to check the email delivery limits.');
 if((error.code==='unexpected_failure'||(error.status||0)>=500)&&/email|smtp/i.test(error.message))return Error('The authentication service could not send the email. Ask your administrator to check Supabase SMTP settings and Auth logs.');
 return Error(error.message||'The authentication email could not be requested. Please try again later.');
}
function redirect(path:string){const response=NextResponse.redirect(new URL(path,base()));response.headers.set('Cache-Control','no-store');return response;}
function callback(flow?:string,invite?:string){const url=new URL('/api/auth/callback',base());url.searchParams.set('flow',flow||'signin');if(invite)url.searchParams.set('invite',invite);return url.href;}
function exchangeFailure(error:{code?:string;message:string}){
 console.warn('Supabase authentication callback failed',{code:error.code||'unknown'});
 if(['flow_state_expired','otp_expired'].includes(error.code||''))return Error('This link has expired or has already been used. Request a new email and open only the newest link.');
 if(['bad_code_verifier','flow_state_not_found'].includes(error.code||'')||/verifier|code exchange.*non-empty/i.test(error.message))return Error('The browser session for this link is missing. Request a new email in this browser and open the newest link here.');
 return Error('This sign-in link could not be completed. Request a new link and try again.');
}

export async function supabaseAuthGet(req:NextRequest,path:string){
 if(!['auth/google','auth/callback','auth/confirm'].includes(path))return null;
 if(!supabaseConfigured())return redirect('/?auth_error=Authentication+is+not+configured.');
 const client=await supabaseServer(),jar=await cookies();
 try{
  if(path==='auth/google'){
   const invite=req.nextUrl.searchParams.get('invite');
   if(invite&&/^[\w-]{1,100}$/.test(invite))jar.set('timecard_auth_invite',invite,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:600});
   else jar.delete('timecard_auth_invite');
   const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:callback(),skipBrowserRedirect:true}});
   if(error||!data.url)throw Error('Google sign-in is unavailable. Check the Google provider configuration in Supabase.');
   const response=NextResponse.redirect(data.url);response.headers.set('Cache-Control','no-store');return response;
  }
  const providerError=authRedirectError(req.nextUrl.search);if(providerError)throw Error(providerError);
  const code=req.nextUrl.searchParams.get('code'),token=req.nextUrl.searchParams.get('token_hash'),type=req.nextUrl.searchParams.get('type');
  const workspaceToken=req.nextUrl.searchParams.get('invite');
  const workspaceEmailFlow=type==='invite'||((type==='email'||type==='signup')&&req.nextUrl.searchParams.get('flow')==='invite');
  const workspaceInvite=workspaceEmailFlow&&workspaceToken?one('SELECT * FROM invites WHERE token=? AND accepted=0 AND revoked=0 AND expires>?',workspaceToken,now()):null;
  if(workspaceEmailFlow&&!workspaceInvite)throw Error('This workspace invitation has expired or was revoked. Ask your manager for a new invitation.');
  let recovery=req.nextUrl.searchParams.get('flow')==='recovery';
  if(token&&(type==='signup'||type==='recovery'||type==='invite'||type==='email')){
   const {error}=await client.auth.verifyOtp({token_hash:token,type});if(error)throw Error('This email link is invalid or has expired.');recovery=type==='recovery';
  }else if(code){const {data,error}=await client.auth.exchangeCodeForSession(code);if(error)throw exchangeFailure(error);if('redirectType' in data&&data.redirectType==='recovery')recovery=true;}
  else throw Error('This sign-in link is incomplete.');
  const {data,error}=await client.auth.getUser();if(error||!data.user)throw Error('Your identity could not be verified. Please sign in again.');
  if(workspaceInvite&&workspaceInvite.email.toLowerCase()!==data.user.email?.toLowerCase())throw Error('Sign in with the email address this workspace invitation was sent to.');
  const local=linkSupabaseUser(data.user);await session(local.id,'supabase');
  if(recovery){const token=id();run('INSERT INTO tokens VALUES(?,?,?,?)',token,local.id,'supabase-reset',new Date(Date.now()+600000).toISOString());return redirect('/?reset='+token);}
  const invite=workspaceInvite?.token||jar.get('timecard_auth_invite')?.value||req.nextUrl.searchParams.get('invite');jar.delete('timecard_auth_invite');
  return redirect(invite?'/?invite='+encodeURIComponent(invite):'/?auth=verified');
 }catch(e){return redirect('/?auth_error='+encodeURIComponent(e instanceof Error?e.message:'Sign-in could not finish.'));}
}

export async function supabaseAuthPost(path:string,b:Record<string,unknown>){
 if(!['auth/signup','auth/login','auth/reset-request','auth/reset','auth/verify','auth/resend'].includes(path)||!useSupabaseAuth())return null;
 const client=await supabaseServer();
 if(path==='auth/signup'){
  const input=z.object({name:z.string().trim().min(1).max(100),email,password,invite:z.string().regex(/^[\w-]{1,100}$/).optional()}).parse(b);rateLimit('signup:'+input.email,5);
  const {data,error}=await client.auth.signUp({email:input.email,password:input.password,options:{data:{name:input.name},emailRedirectTo:callback(undefined,input.invite)}});
  if(error)throw emailFailure(error,'signup');
  if(data.session&&data.user){const local=linkSupabaseUser(data.user);await session(local.id,'supabase');return json();}
  return json({confirmationRequired:true,email:input.email,message:'If this account needs confirmation, check your inbox and spam folder. Already registered? Sign in or reset your password.'});
 }
 if(path==='auth/login'){
  const input=z.object({email,password:z.string().min(1).max(128)}).parse(b);rateLimit('login:'+input.email);
  const {data,error}=await client.auth.signInWithPassword(input);if(error||!data.user)throw Error(error?.code==='email_not_confirmed'?'Please confirm your email before signing in.':'Email or password is incorrect.');
  const local=linkSupabaseUser(data.user);await session(local.id,'supabase');return json();
 }
 if(path==='auth/reset-request'){
  const address=email.parse(b.email);rateLimit('reset:'+address,3);
  const {error}=await client.auth.resetPasswordForEmail(address,{redirectTo:callback('recovery')});
  if(error)throw emailFailure(error,'recovery');
  return json({message:'If this account exists, a reset link has been sent.'});
 }
 if(path==='auth/resend'){
  const address=email.parse(b.email);rateLimit('verify:'+address,3);
  const {error}=await client.auth.resend({type:'signup',email:address,options:{emailRedirectTo:callback(undefined,typeof b.invite==='string'&&/^[\w-]{1,100}$/.test(b.invite)?b.invite:undefined)}});
  if(error)throw emailFailure(error,'resend');
  return json({message:'Confirmation email requested. If this account needs verification, check your inbox and spam folder. Already verified? Sign in.'});
 }
 if(path==='auth/reset'){
  const u=await user();if(!u)throw Error('Open the password-reset email in this browser first.');
  const input=z.object({password,token:z.string().uuid()}).parse(b);
  const token=one("SELECT id FROM tokens WHERE id=? AND user_id=? AND kind='supabase-reset' AND expires>?",input.token,u.id,now());if(!token)throw Error('This reset link is invalid or has expired.');
  const {error}=await client.auth.updateUser({password:input.password});if(error)throw Error(error.message);
  run('UPDATE users SET auth_version=auth_version+1 WHERE id=?',u.id);run("DELETE FROM tokens WHERE user_id=? AND kind='supabase-reset'",u.id);
  await client.auth.signOut({scope:'global'});await logout();return json();
 }
 throw Error('Use the verification link sent by Supabase.');
}
