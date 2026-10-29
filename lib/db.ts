import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {database,query,type Row} from './db-engine';
export const db=database;
export type {Row};
export async function one(sql:string,...args:unknown[]):Promise<Row|undefined>{return (await query(sql,args)).rows[0];}
export async function all(sql:string,...args:unknown[]):Promise<Row[]>{return (await query(sql,args)).rows;}
export async function run(sql:string,...args:unknown[]):Promise<{changes:number}>{return {changes:(await query(sql,args)).changes};}
export function id(){return crypto.randomUUID();}
export function now(){return new Date().toISOString();}
export async function audit(org:string,user:string,action:string,details:unknown){await run('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)',id(),org,user,action,JSON.stringify(details),now());}
export function encrypt(value:string){const key=process.env.DATA_ENCRYPTION_KEY;if(!key||Buffer.from(key,'hex').length!==32)throw Error('Configure DATA_ENCRYPTION_KEY as 64 hexadecimal characters before face enrollment.');const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);return [iv.toString('hex'),Buffer.concat([c.update(value,'utf8'),c.final()]).toString('hex'),c.getAuthTag().toString('hex')].join('.');}
export function decrypt(value:string){const [iv,data,tag]=value.split('.');const c=createDecipheriv('aes-256-gcm',Buffer.from(process.env.DATA_ENCRYPTION_KEY!,'hex'),Buffer.from(iv,'hex'));c.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([c.update(Buffer.from(data,'hex')),c.final()]).toString();}
