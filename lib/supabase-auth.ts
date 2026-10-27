import {cookies} from 'next/headers';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {id,one,run,now} from './db';
import {session,user,logout,rateLimit} from './auth';
import {supabaseConfigured,supabaseServer,linkSupabaseUser} from './supabase';

const email=z.string().email().max(254).transform(v=>v.toLowerCase());
const password=z.string().min(10).max(128);
const base=()=>process.env.APP_URL||'http://localhost:3000';
const json=(data:object={})=>NextResponse.json({ok:true,...data},{headers:{'Cache-Control':'no-store'}});
function redirect(path:string){const response=NextResponse.redirect(new URL(path,base()));response.headers.set('Cache-Control','no-store');return response;}
function callback(flow?:string,invite?:string){const url=new URL('/api/auth/callback',base());if(flow)url.searchParams.set('flow',flow);if(invite)url.searchParams.set('invite',invite);return url.href;}

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
  if(req.nextUrl.searchParams.has('error'))throw Error('Sign-in was cancelled or the link has expired. Please try again.');
  const code=req.nextUrl.searchParams.get('code'),token=req.nextUrl.searchParams.get('token_hash'),type=req.nextUrl.searchParams.get('type');
  let recovery=req.nextUrl.searchParams.get('flow')==='recovery';
  if(token&&(type==='signup'||type==='recovery')){
   const {error}=await client.auth.verifyOtp({token_hash:token,type});if(error)throw Error('This email link is invalid or has expired.');recovery=type==='recovery';
  }else if(code){const {error}=await client.auth.exchangeCodeForSession(code);if(error)throw Error('This sign-in link has expired or was opened in a different browser. Request a new link.');}
  else throw Error('This sign-in link is incomplete.');
  const {data,error}=await client.auth.getUser();if(error||!data.user)throw Error('Your identity could not be verified. Please sign in again.');
  const local=linkSupabaseUser(data.user);await session(local.id,'supabase');
  if(recovery){const token=id();run('INSERT INTO tokens VALUES(?,?,?,?)',token,local.id,'supabase-reset',new Date(Date.now()+600000).toISOString());return redirect('/?reset='+token);}
  const invite=jar.get('timecard_auth_invite')?.value||req.nextUrl.searchParams.get('invite');jar.delete('timecard_auth_invite');
  return redirect(invite?'/?invite='+encodeURIComponent(invite):'/?auth=verified');
 }catch(e){return redirect('/?auth_error='+encodeURIComponent(e instanceof Error?e.message:'Sign-in could not finish.'));}
}

export async function supabaseAuthPost(path:string,b:Record<string,unknown>){
 if(!supabaseConfigured()||!['auth/signup','auth/login','auth/reset-request','auth/reset','auth/verify','auth/resend'].includes(path))return null;
 const client=await supabaseServer();
 if(path==='auth/signup'){
  const input=z.object({name:z.string().trim().min(1).max(100),email,password,invite:z.string().regex(/^[\w-]{1,100}$/).optional()}).parse(b);rateLimit('signup:'+input.email,5);
  const {data,error}=await client.auth.signUp({email:input.email,password:input.password,options:{data:{name:input.name},emailRedirectTo:callback(undefined,input.invite)}});
  if(error)throw Error(error.message);
  if(data.session&&data.user){const local=linkSupabaseUser(data.user);await session(local.id,'supabase');return json();}
  return json({confirmationRequired:true,email:input.email,message:'Check your inbox to confirm your email, then sign in.'});
 }
 if(path==='auth/login'){
  const input=z.object({email,password:z.string().min(1).max(128)}).parse(b);rateLimit('login:'+input.email);
  const {data,error}=await client.auth.signInWithPassword(input);if(error||!data.user)throw Error(error?.code==='email_not_confirmed'?'Please confirm your email before signing in.':'Email or password is incorrect.');
  const local=linkSupabaseUser(data.user);await session(local.id,'supabase');return json();
 }
 if(path==='auth/reset-request'){
  const address=email.parse(b.email);rateLimit('reset:'+address,3);
  const {error}=await client.auth.resetPasswordForEmail(address,{redirectTo:callback('recovery')});
  if(error)throw Error('The reset email could not be requested. Please try again later.');
  return json({message:'If this account exists, a reset link has been sent.'});
 }
 if(path==='auth/resend'){
  const address=email.parse(b.email);rateLimit('verify:'+address,3);
  const {error}=await client.auth.resend({type:'signup',email:address,options:{emailRedirectTo:callback()}});
  if(error)throw Error('The verification email could not be requested. Please try again later.');
  return json({message:'If confirmation is needed, a verification email has been sent.'});
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
