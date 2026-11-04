import {schema,additions} from './db-schema';
import {postgresSql} from './db-sql';

// Migrations and application writes acquire this lock before any table locks.
export const POSTGRES_WRITE_LOCK=739285105;
export const POSTGRES_SCHEMA_VERSION=1;
type SchemaConnection={
 query:(sql:string,params?:unknown[])=>Promise<{rows:Record<string,any>[]}>;
 exec:(sql:string)=>Promise<void>;
};

export async function initializePostgresSchema(connection:SchemaConnection){
 for(let attempt=0;attempt<3;attempt++){
  try{
   await connection.exec('BEGIN');
   await connection.query('SELECT pg_advisory_xact_lock($1)',[POSTGRES_WRITE_LOCK]);
   const registry=await connection.query("SELECT to_regclass('timecard.schema_migrations') name");
   const applied=registry.rows[0]?.name
    ? await connection.query('SELECT version FROM timecard.schema_migrations WHERE version=$1',[POSTGRES_SCHEMA_VERSION])
    : {rows:[]};
   if(!applied.rows.length){
    await connection.exec('CREATE SCHEMA IF NOT EXISTS timecard; REVOKE ALL ON SCHEMA timecard FROM PUBLIC');
    await connection.exec(postgresSql(schema));
    for(const [table,columns] of Object.entries(additions))for(const [column,type] of Object.entries(columns))
     await connection.exec(postgresSql(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "${column}" ${type}`));
    await connection.exec('CREATE OR REPLACE FUNCTION timecard.instr(text,text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT strpos($1,$2) $$');
    await connection.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_id ON timecard.users(supabase_id) WHERE supabase_id IS NOT NULL');
    await connection.exec(postgresSql('UPDATE memberships SET created=CURRENT_TIMESTAMP WHERE created IS NULL'));
    await connection.exec('CREATE TABLE IF NOT EXISTS timecard.schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await connection.query('INSERT INTO timecard.schema_migrations(version) VALUES($1)',[POSTGRES_SCHEMA_VERSION]);
   }
   await connection.exec('COMMIT');
   return;
  }catch(error){
   // Only retry fully rolled-back schema work. Application callbacks may send
   // email or call providers and must never be replayed automatically.
   await connection.exec('ROLLBACK');
   if((error as {code?:string})?.code!=='40P01'||attempt===2)throw error;
   await new Promise(r=>setTimeout(r,50*(attempt+1)+Math.random()*50));
  }
 }
}
