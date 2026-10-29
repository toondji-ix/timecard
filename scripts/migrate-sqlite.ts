import nextEnv from '@next/env';
import Database from 'better-sqlite3';
import {resolve} from 'node:path';
nextEnv.loadEnvConfig(process.cwd());
if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL to the destination Supabase PostgreSQL database.');
const sourcePath=process.argv[2];if(!sourcePath)throw Error('Usage: npm run migrate:sqlite -- path/to/source.sqlite');
const source=new Database(resolve(sourcePath),{readonly:true,fileMustExist:true});
const {db,one,run}=await import('../lib/db');const {tables}=await import('../lib/db-schema');
const selected=tables.filter(t=>t!=='job_leases'&&source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t));
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
try{
 if(await db.kind()!=='postgres')throw Error('A PostgreSQL destination is required.');
 const snapshot=source.transaction(()=>Object.fromEntries(selected.map(table=>[table,source.prepare('SELECT * FROM '+quote(table)).all() as Record<string,unknown>[]])))();
 if(!snapshot.users?.length)throw Error('Source backup has no user records.');
 let rows=0;
 await db.transaction(async()=>{
  await db.exec('LOCK TABLE '+tables.join(',')+' IN EXCLUSIVE MODE');
  for(const table of tables.filter(t=>t!=='job_leases'))if((await one('SELECT COUNT(*) n FROM '+table))!.n>0)throw Error('Destination is not empty. Import stopped to protect existing records.');
  for(const table of selected)for(const row of snapshot[table]){const columns=Object.keys(row);await run('INSERT INTO '+table+'('+columns.map(quote).join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',...columns.map(c=>row[c]));rows++;}
 })();
 console.log(`Imported ${rows} records without changing IDs, memberships or encrypted identifiers. Keep DATA_ENCRYPTION_KEY unchanged.`);
}catch(e){console.error(e instanceof Error&&e.message.startsWith('Destination is not empty')?e.message:'Import failed; no destination changes were committed. Check the source backup and database configuration.');process.exitCode=1;}
finally{source.close();await db.close();}
