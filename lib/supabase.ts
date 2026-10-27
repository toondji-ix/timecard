import { createServerClient } from '@supabase/ssr';
import { createClient, type User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { db,one,run,id } from './db';

export function supabaseConfigured(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!!url!==!!key)throw Error('Configure both the Supabase project URL and publishable key.');return !!(url&&key);}
export async function supabaseServer(){
 if(!supabaseConfigured())throw Error('Supabase authentication is not configured.');
 const jar=await cookies();
 return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
  cookies:{getAll:()=>jar.getAll(),setAll:items=>{for(const {name,value,options} of items)jar.set(name,value,{...options,secure:process.env.NODE_ENV==='production'});}},
 });
}

// Called only with a user returned by Supabase Auth, never browser-supplied claims.
// Existing workspace IDs and memberships survive the provider change.
export function linkSupabaseUser(account:User){
 if(!account.email||!account.email_confirmed_at)throw Error('Please verify your email before signing in.');
 const email=account.email.toLowerCase();
 return db.transaction(()=>{
  let local=one('SELECT * FROM users WHERE supabase_id=?',account.id);
  if(!local){
   local=one('SELECT * FROM users WHERE lower(email)=?',email);
   if(local?.supabase_id&&local.supabase_id!==account.id)throw Error('This email is linked to another identity.');
   if(local)run('UPDATE users SET supabase_id=?,verified=1,password=? WHERE id=?',account.id,'!supabase',local.id);
   else{const uid=id(),name=String(account.user_metadata?.full_name||account.user_metadata?.name||email.split('@')[0]).slice(0,100);run('INSERT INTO users(id,email,name,password,verified,supabase_id) VALUES(?,?,?,?,1,?)',uid,email,name,'!supabase',account.id);}
  }
  if(local&&local.email!==email)run('UPDATE users SET email=?,verified=1 WHERE id=?',email,local.id);
  return one('SELECT * FROM users WHERE supabase_id=?',account.id)!;
 })();
}

// Reauthentication must not replace the current session or its recovery cookies.
export async function confirmSupabasePassword(email:string,password:string,expectedId:string){
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.auth.signInWithPassword({email,password});
 if(error||data.user?.id!==expectedId)throw Error('Your password is incorrect. Google users can set a password using the password-reset email.');
 await client.auth.signOut({scope:'local'});
}
export function supabaseAdminConfigured(){return !!process.env.SUPABASE_SECRET_KEY;}
export async function deleteSupabaseUser(uid:string){
 if(!supabaseAdminConfigured())throw Error('Account deletion requires the server-only Supabase secret key. Ask your workspace administrator to finish configuration.');
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await admin.auth.admin.deleteUser(uid);if(error)throw Error('Supabase could not delete your account. Please try again.');
}
