import test from 'node:test';
import assert from 'node:assert/strict';
import {supabaseConfig,useSupabaseAuth} from '../lib/supabase-config';

test('server-only credentials enable production Supabase authentication without public build variables',()=>{
 const env={NODE_ENV:'production',SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
 assert.equal(useSupabaseAuth(env),true);
 assert.deepEqual(supabaseConfig(env),{url:env.SUPABASE_URL,key:env.SUPABASE_PUBLISHABLE_KEY});
});
test('existing public names and legacy anon keys remain compatible',()=>{
 for(const keyName of ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_ANON_KEY']){
  assert.equal(useSupabaseAuth({NODE_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',[keyName]:'test-key'}),true);
 }
});
test('configuration is read again when runtime settings change',()=>{
 const env:Record<string,string|undefined>={NODE_ENV:'development'};
 assert.equal(useSupabaseAuth(env),false);
 env.SUPABASE_URL='https://project.supabase.co';env.SUPABASE_PUBLISHABLE_KEY='runtime-key';
 assert.equal(useSupabaseAuth(env),true);assert.equal(supabaseConfig(env)?.key,'runtime-key');
});
test('missing production configuration cannot fall through to legacy email signup',()=>{
 assert.throws(()=>useSupabaseAuth({NODE_ENV:'production'}),/SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY/);
 assert.equal(useSupabaseAuth({NODE_ENV:'development'}),false);
 assert.equal(useSupabaseAuth({NODE_ENV:'test'}),false);
});
test('incomplete and invalid configuration fails clearly without leaking values',()=>{
 for(const env of [{SUPABASE_URL:'https://project.supabase.co'},{SUPABASE_PUBLISHABLE_KEY:'private-value'},{SUPABASE_URL:'invalid',SUPABASE_PUBLISHABLE_KEY:'private-value'}]){
  assert.throws(()=>supabaseConfig(env),e=>e instanceof Error&&!e.message.includes('private-value'));
 }
});
test('server credentials take priority over older public build settings',()=>{
 assert.deepEqual(supabaseConfig({SUPABASE_URL:' https://runtime.supabase.co/ ',SUPABASE_PUBLISHABLE_KEY:' runtime-key ',NEXT_PUBLIC_SUPABASE_URL:'https://old.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'old-key'}),{url:'https://runtime.supabase.co',key:'runtime-key'});
});
