import nextEnv from '@next/env';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
nextEnv.loadEnvConfig(process.cwd());
const folder=resolve(process.env.BACKUP_DIRECTORY||'data/backups');mkdirSync(folder,{recursive:true});
if(!process.env.DATABASE_URL){
 const Database=(await import('better-sqlite3')).default;const source=new Database(process.env.DATABASE_PATH||'data/timecard.sqlite',{readonly:true});
 try{await source.backup(resolve(folder,'timecard-'+Date.now()+'.sqlite'));console.log('Consistent SQLite backup created.');}finally{source.close();}
}else{
 const {db,all}=await import('../lib/db');const {tables}=await import('../lib/db-schema');
 try{const snapshot=await db.transaction(async()=>{const data:Record<string,unknown>={};for(const table of tables)data[table]=await all('SELECT * FROM '+table);return data;},{readOnly:true})();
 const target=resolve(folder,'timecard-'+Date.now()+'.json'),temporary=target+'.tmp';writeFileSync(temporary,JSON.stringify({version:1,created:new Date().toISOString(),schema:'timecard',tables:snapshot}));renameSync(temporary,target);console.log('Consistent PostgreSQL logical backup created. Store it securely outside the ephemeral Render filesystem.');
 }finally{await db.close();}
}
