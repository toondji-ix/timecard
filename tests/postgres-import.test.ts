import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdirSync,mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {schema} from '../lib/db-schema';

test('SQLite import preserves identities, rejects a nonempty destination and produces a consistent PostgreSQL backup',async()=>{
 mkdirSync(resolve('data'),{recursive:true});
 const root=mkdtempSync(resolve('data/import-test-')),source=resolve(root,'source.sqlite'),destination=resolve(root,'postgres'),backups=resolve(root,'backups');
 const sqlite=new Database(source);sqlite.exec(schema);
 sqlite.prepare("INSERT INTO users(id,email,name,password,verified) VALUES('preserved-user','import@example.invalid','Imported person','!supabase',1)").run();
 sqlite.prepare("INSERT INTO organizations(id,name) VALUES('preserved-org','Imported workspace')").run();
 sqlite.prepare("INSERT INTO memberships(id,org_id,user_id,role) VALUES('preserved-member','preserved-org','preserved-user','owner')").run();sqlite.close();
 const execute=(script:string,args:string[]=[])=>new Promise<{code:number|null;output:string}>((done,reject)=>{
  const child=spawn(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve(script),...args],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'test',DATABASE_URL:'postgresql://fixture:fixture@localhost/fixture',DATABASE_TEST_PGLITE_PATH:destination,BACKUP_DIRECTORY:backups}});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.on('error',reject);child.on('exit',code=>done({code,output}));
 });
 try{
  let result=await execute('scripts/migrate-sqlite.ts',[source]);assert.equal(result.code,0,result.output);assert.match(result.output,/Imported 3 records/);
  result=await execute('scripts/migrate-sqlite.ts',[source]);assert.equal(result.code,1,result.output);assert.match(result.output,/Destination is not empty/);
  result=await execute('scripts/backup.ts');assert.equal(result.code,0,result.output);
  const snapshot=JSON.parse(readFileSync(resolve(backups,readdirSync(backups).find(f=>f.endsWith('.json'))!),'utf8'));
  assert.equal(snapshot.tables.users.length,1);assert.equal(snapshot.tables.users[0].id,'preserved-user');assert.equal(snapshot.tables.memberships[0].org_id,'preserved-org');assert.equal(snapshot.tables.memberships[0].role,'owner');
 }finally{if(root.startsWith(resolve('data')+sep))rmSync(root,{recursive:true,force:true});}
},{timeout:120000});
