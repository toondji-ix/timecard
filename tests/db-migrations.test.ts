import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {initializePostgresSchema,POSTGRES_WRITE_LOCK} from '../lib/db-migrations';

async function fixture(){
 const pg=new PGlite();const statements:string[]=[];const locks:unknown[][]=[];
 const connection={
  async query(sql:string,params:unknown[]=[]){statements.push(sql);if(sql.includes('pg_advisory_xact_lock'))locks.push(params);return pg.query<Record<string,any>>(sql,params);},
  async exec(sql:string){statements.push(sql);await pg.exec(sql);},
 };
 return {pg,connection,statements,locks};
}
test('legacy PostgreSQL tables migrate once while preserving existing user records',async()=>{
 const {pg,connection,locks}=await fixture();
 try{
  await pg.exec("CREATE SCHEMA timecard; CREATE TABLE timecard.users(id text PRIMARY KEY,email text UNIQUE NOT NULL,name text NOT NULL,password text NOT NULL,verified integer DEFAULT 0,created text); INSERT INTO timecard.users VALUES('existing','existing@example.invalid','Existing person','unchanged',1,'2026-01-01')");
  await initializePostgresSchema(connection);
  assert.deepEqual(locks,[[POSTGRES_WRITE_LOCK]]);
  const user=(await pg.query<any>("SELECT * FROM timecard.users WHERE id='existing'")).rows[0];
  assert.equal(user.name,'Existing person');assert.equal(user.password,'unchanged');assert.equal(user.auth_version,0);
  assert.equal((await pg.query('SELECT * FROM timecard.schema_migrations')).rows.length,1);
 }finally{await pg.close();}
});
test('subsequent server and maintenance starts skip table changes and backfills',async()=>{
 const {pg,connection,statements}=await fixture();
 try{
  await initializePostgresSchema(connection);statements.length=0;
  await initializePostgresSchema(connection);await initializePostgresSchema(connection);
  assert.equal(statements.filter(s=>/^(CREATE|ALTER|UPDATE|INSERT|REVOKE)\b/i.test(s)).length,0);
  assert.equal(statements.filter(s=>s==='COMMIT').length,2);
 }finally{await pg.close();}
});
test('a migration deadlock rolls back partial changes before a bounded retry',async()=>{
 const {pg,connection,statements}=await fixture();let failed=false;
 const original=connection.exec;connection.exec=async sql=>{if(!failed&&sql.startsWith('CREATE OR REPLACE FUNCTION')){failed=true;throw Object.assign(Error('fixture deadlock'),{code:'40P01'});}await original(sql);};
 try{
  await initializePostgresSchema(connection);
  assert.ok(failed);assert.equal(statements.filter(s=>s==='BEGIN').length,2);assert.equal(statements.filter(s=>s==='ROLLBACK').length,1);
  assert.equal((await pg.query('SELECT * FROM timecard.schema_migrations')).rows.length,1);
 }finally{await pg.close();}
});
test('persistent deadlocks stop after three attempts without marking the migration complete',async()=>{
 const {pg,connection,statements}=await fixture();const original=connection.query;
 connection.query=async(sql,params=[])=>{if(sql.includes('pg_advisory_xact_lock'))throw Object.assign(Error('fixture deadlock'),{code:'40P01'});return original(sql,params);};
 try{
  await assert.rejects(initializePostgresSchema(connection),/fixture deadlock/);
  assert.equal(statements.filter(s=>s==='BEGIN').length,3);assert.equal(statements.filter(s=>s==='ROLLBACK').length,3);
  assert.equal((await pg.query<any>("SELECT to_regclass('timecard.schema_migrations') name")).rows[0].name,null);
 }finally{await pg.close();}
});
test('configuration and permission failures are rolled back without retrying',async()=>{
 const {pg,connection,statements}=await fixture();const original=connection.exec;
 connection.exec=async sql=>{if(sql.startsWith('CREATE SCHEMA'))throw Object.assign(Error('fixture permission denied'),{code:'42501'});await original(sql);};
 try{
  await assert.rejects(initializePostgresSchema(connection),/fixture permission denied/);
  assert.equal(statements.filter(s=>s==='BEGIN').length,1);assert.equal(statements.filter(s=>s==='ROLLBACK').length,1);
 }finally{await pg.close();}
});
