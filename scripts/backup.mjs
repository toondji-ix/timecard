import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const source=process.env.DATABASE_PATH||'data/timecard.sqlite',folder=resolve('data/backups');mkdirSync(folder,{recursive:true});
const db=new Database(source,{readonly:true}),target=resolve(folder,'timecard-'+new Date().toISOString().replaceAll(':','-')+'.sqlite');await db.backup(target);db.close();console.log('Consistent database backup created in data/backups. Keep this folder on encrypted storage.');
