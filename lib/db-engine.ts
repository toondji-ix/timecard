import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {schema,additions} from './db-schema';
import {postgresSql} from './db-sql';
export type Row=Record<string,any>;
type Result={rows:Row[];changes:number};
type Connection={query:(sql:string,params?:unknown[])=>Promise<Result>;exec:(sql:string)=>Promise<void>;release?:()=>void};
type Engine={kind:'sqlite'|'postgres';connection:()=>Promise<Connection>;close:()=>Promise<void>};
const contexts=new AsyncLocalStorage<Connection>();
let pending:Promise<Engine>|undefined,savepoint=0;
let queue:Promise<void>=Promise.resolve();
async function exclusive<T>(fn:()=>Promise<T>){const prior=queue;let release!:()=>void;queue=new Promise(r=>release=r);await prior;try{return await fn();}finally{release();}}
const normalize=(rows:Row[])=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='bigint'?Number(v):v])));

async function initialize():Promise<Engine>{
 const url=process.env.DATABASE_URL?.trim();
 const testPath=process.env.NODE_ENV!=='production'?process.env.DATABASE_TEST_PGLITE_PATH:undefined;
 if(url||testPath){
  let connect:()=>Promise<Connection>,close:()=>Promise<void>;
  if(testPath){
   const {PGlite}=await import('@electric-sql/pglite');const pg=new PGlite(testPath);
   const connection:Connection={query:async(sql,params=[])=>{const r=await pg.query<Row>(sql,params);return {rows:normalize(r.rows),changes:r.affectedRows||0};},exec:async sql=>{await pg.exec(sql);}};
   connect=async()=>connection;close=async()=>pg.close();
  }else{
   let parsed:URL;try{parsed=new URL(url!);if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error();}catch{throw Error('DATABASE_URL must be the Supabase PostgreSQL pooler connection string, not the project API URL.');}
   const {Pool,types}=await import('pg');
   // Verify TLS using trusted CAs. A real database URL is never printed.
   for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])parsed.searchParams.delete(key);
   const pool=new Pool({connectionString:parsed.href,ssl:{rejectUnauthorized:true},max:3,connectionTimeoutMillis:15000,idleTimeoutMillis:30000,types:{getTypeParser:(oid:number,format?:any)=>oid===20?Number:types.getTypeParser(oid,format)}});
   pool.on('error',()=>console.error('Database connection interrupted; the next request will reconnect.'));
   connect=async()=>{const client=await pool.connect();return {query:async(sql,params=[])=>{const r=await client.query(sql,params);return {rows:normalize(r.rows),changes:r.rowCount||0};},exec:async sql=>{await client.query(sql);},release:()=>client.release()};};close=async()=>pool.end();
  }
  const connection=await connect();
  try{
   await connection.exec('BEGIN');
   await connection.query('SELECT pg_advisory_xact_lock(739285104)');
   await connection.exec('CREATE SCHEMA IF NOT EXISTS timecard; REVOKE ALL ON SCHEMA timecard FROM PUBLIC');
   await connection.exec(postgresSql(schema));
   for(const [table,columns] of Object.entries(additions))for(const [column,type] of Object.entries(columns))await connection.exec(postgresSql(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "${column}" ${type}`));
   await connection.exec('CREATE OR REPLACE FUNCTION timecard.instr(text,text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT strpos($1,$2) $$');
   await connection.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_id ON timecard.users(supabase_id) WHERE supabase_id IS NOT NULL');
   await connection.exec(postgresSql('UPDATE memberships SET created=CURRENT_TIMESTAMP WHERE created IS NULL'));
   await connection.exec('COMMIT');
  }catch(e){await connection.exec('ROLLBACK').catch(()=>{});connection.release?.();connection.release=undefined;await close().catch(()=>{});throw e;}finally{connection.release?.();}
  return {kind:'postgres',connection:connect,close};
 }
 if(process.env.NODE_ENV==='production'&&process.env.RENDER&&process.env.DATABASE_DRIVER!=='sqlite')throw Error('DATABASE_URL is required on Render. Configure the Supabase PostgreSQL connection; refusing to create a temporary workspace database.');
 const Database=(await import('better-sqlite3')).default;
 const path=resolve(process.env.DATABASE_PATH||'data/timecard.sqlite');mkdirSync(dirname(path),{recursive:true});const sqlite=new Database(path);
 sqlite.pragma('journal_mode = WAL');sqlite.pragma('foreign_keys = ON');sqlite.exec(schema);
 for(const [table,columns] of Object.entries(additions)){const existing=new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name));for(const [column,type] of Object.entries(columns))if(!existing.has(column))sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);}
 sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_id ON users(supabase_id) WHERE supabase_id IS NOT NULL');sqlite.exec('UPDATE memberships SET created=CURRENT_TIMESTAMP WHERE created IS NULL');
 const connection:Connection={query:async(sql,params=[])=>{const stmt=sqlite.prepare(sql);if(stmt.reader)return {rows:stmt.all(...params) as Row[],changes:0};const r=stmt.run(...params);return {rows:[],changes:r.changes};},exec:async sql=>{sqlite.exec(sql);}};
 return {kind:'sqlite',connection:async()=>connection,close:async()=>{sqlite.close();}};
}
async function engine(){if(!pending)pending=initialize().catch(e=>{pending=undefined;throw e;});return pending;}
export async function query(sql:string,params:unknown[]=[]):Promise<Result>{
 const current=contexts.getStore(),backend=await engine();
 const execute=async()=>{const connection=current||await backend.connection();try{return await connection.query(backend.kind==='postgres'?postgresSql(sql):sql,params);}finally{if(!current)connection.release?.();}};
 return backend.kind==='sqlite'&&!current?exclusive(execute):execute();
}
export const database={
 async exec(sql:string){const current=contexts.getStore(),backend=await engine();const execute=async()=>{const c=current||await backend.connection();try{await c.exec(backend.kind==='postgres'?postgresSql(sql):sql);}finally{if(!current)c.release?.();}};return backend.kind==='sqlite'&&!current?exclusive(execute):execute();},
 transaction<T>(fn:()=>T|Promise<T>, options:{readOnly?:boolean}={}){return async()=>{
  const backend=await engine(),current=contexts.getStore();
  const execute=async()=>{const c=current||await backend.connection(),point='nested_'+(++savepoint);await c.exec(current?'SAVEPOINT '+point:options.readOnly&&backend.kind==='postgres'?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');try{if(!current&&backend.kind==='postgres'&&!options.readOnly)await c.query('SELECT pg_advisory_xact_lock(739285105)');const value=await contexts.run(c,fn);await c.exec(current?'RELEASE SAVEPOINT '+point:'COMMIT');return value;}catch(e){await c.exec(current?'ROLLBACK TO SAVEPOINT '+point:'ROLLBACK').catch(()=>{});throw e;}finally{if(!current)c.release?.();}};
  return backend.kind==='sqlite'&&!current?exclusive(execute):execute();
 };},
 async close(){if(pending){const backend=await pending;await backend.close();pending=undefined;}},
 async kind(){return (await engine()).kind;},
};
