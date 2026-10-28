import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
const databasePath=process.env.DATABASE_PATH||'data/timecard.sqlite';
mkdirSync('data',{recursive:true});
const globalDb=globalThis as unknown as {timecardDb?:Database.Database};
export const db=globalDb.timecardDb??new Database(databasePath);
globalDb.timecardDb=db;
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,verified INTEGER DEFAULT 0,created TEXT DEFAULT CURRENT_TIMESTAMP,auth_version INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,timezone TEXT DEFAULT 'Africa/Lagos',start_time TEXT DEFAULT '09:00',end_time TEXT DEFAULT '17:00',grace INTEGER DEFAULT 10,workdays TEXT DEFAULT '[1,2,3,4,5]',threshold REAL DEFAULT 0.95,retention INTEGER DEFAULT 365,photo_retention INTEGER DEFAULT 0,plan TEXT DEFAULT 'free',stripe_customer TEXT);
CREATE TABLE IF NOT EXISTS memberships(id TEXT PRIMARY KEY,org_id TEXT REFERENCES organizations(id),user_id TEXT REFERENCES users(id),role TEXT DEFAULT 'staff',department TEXT DEFAULT '',consent TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(org_id,user_id));
CREATE TABLE IF NOT EXISTS locations(id TEXT PRIMARY KEY,org_id TEXT REFERENCES organizations(id),name TEXT,lat REAL,lng REAL,radius INTEGER DEFAULT 100);
CREATE TABLE IF NOT EXISTS face_templates(user_id TEXT PRIMARY KEY,template TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,org_id TEXT REFERENCES organizations(id),email TEXT,role TEXT,department TEXT,token TEXT UNIQUE,expires TEXT,revoked INTEGER DEFAULT 0,accepted INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS invite_deliveries(invite_id TEXT PRIMARY KEY REFERENCES invites(id) ON DELETE CASCADE,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,last_error TEXT,updated TEXT);
CREATE TABLE IF NOT EXISTS attendance(id TEXT PRIMARY KEY,org_id TEXT REFERENCES organizations(id),user_id TEXT REFERENCES users(id),day TEXT,check_in TEXT,check_out TEXT,lat REAL,lng REAL,location_id TEXT,match_score REAL,status TEXT,late INTEGER DEFAULT 0,early INTEGER DEFAULT 0,break_minutes REAL DEFAULT 0,break_start TEXT,synced_late INTEGER DEFAULT 0,notes TEXT DEFAULT '',checkout_lat REAL,checkout_lng REAL,checkout_score REAL,checkout_location_id TEXT,UNIQUE(org_id,user_id,day));
CREATE TABLE IF NOT EXISTS manual_requests(id TEXT PRIMARY KEY,org_id TEXT,user_id TEXT,action TEXT,reason TEXT,created TEXT,status TEXT DEFAULT 'pending',comment TEXT,decided_by TEXT);
CREATE TABLE IF NOT EXISTS leave_types(id TEXT PRIMARY KEY,org_id TEXT,name TEXT,allowance INTEGER);
CREATE TABLE IF NOT EXISTS leave_requests(id TEXT PRIMARY KEY,org_id TEXT,user_id TEXT,type_id TEXT,start TEXT,end TEXT,days INTEGER,note TEXT,status TEXT DEFAULT 'pending',comment TEXT,created TEXT);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,org_id TEXT,user_id TEXT,message TEXT,created TEXT,seen INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,expires TEXT);
CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,prompt TEXT,expires TEXT,used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,org_id TEXT,user_id TEXT,action TEXT,details TEXT,created TEXT);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset INTEGER);
CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,created TEXT);
CREATE TABLE IF NOT EXISTS attendance_proofs(id TEXT PRIMARY KEY,org_id TEXT,user_id TEXT,session_id TEXT UNIQUE,kind TEXT,action TEXT,lat REAL,lng REAL,accuracy REAL,created TEXT,used INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,address TEXT,subject TEXT,body TEXT,created TEXT,sent INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS checkout_sessions(id TEXT PRIMARY KEY,org_id TEXT);
CREATE TABLE IF NOT EXISTS subscriptions(org_id TEXT PRIMARY KEY,customer TEXT,subscription TEXT UNIQUE,item TEXT,status TEXT,quantity INTEGER DEFAULT 1,cancel_at_period_end INTEGER DEFAULT 0,last_event INTEGER DEFAULT 0,updated TEXT);
CREATE TABLE IF NOT EXISTS leave_allowances(org_id TEXT,user_id TEXT,type_id TEXT,year INTEGER,allowance INTEGER,PRIMARY KEY(org_id,user_id,type_id,year));
CREATE TABLE IF NOT EXISTS oidc_states(id TEXT PRIMARY KEY,nonce TEXT,verifier TEXT,org_id TEXT,expires TEXT);
CREATE TABLE IF NOT EXISTS oidc_identities(issuer TEXT,subject TEXT,user_id TEXT REFERENCES users(id),PRIMARY KEY(issuer,subject));
CREATE TABLE IF NOT EXISTS paystack_plans(org_id TEXT PRIMARY KEY,code TEXT UNIQUE,created TEXT);
CREATE TABLE IF NOT EXISTS paystack_checkouts(reference TEXT PRIMARY KEY,org_id TEXT,plan_code TEXT,amount INTEGER,currency TEXT,email TEXT,url TEXT,created TEXT,status TEXT DEFAULT 'pending');
`);
// Additive migrations preserve existing local data when upgrading an earlier build.
const additions:Record<string,Record<string,string>>={users:{auth_version:'INTEGER DEFAULT 0',supabase_id:'TEXT'},memberships:{created:'TEXT',active:'INTEGER DEFAULT 1',ended:'TEXT'},attendance:{checkout_lat:'REAL',checkout_lng:'REAL',checkout_score:'REAL',checkout_location_id:'TEXT'}};
for(const [table,columns] of Object.entries(additions)){const existing=new Set((db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name));for(const [column,type] of Object.entries(columns))if(!existing.has(column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_id ON users(supabase_id) WHERE supabase_id IS NOT NULL');
db.prepare('UPDATE memberships SET created=CURRENT_TIMESTAMP WHERE created IS NULL').run();
export type Row=Record<string,any>;
export function one(sql:string,...args:unknown[]) { return db.prepare(sql).get(...args) as Row|undefined; }
export function all(sql:string,...args:unknown[]) { return db.prepare(sql).all(...args) as Row[]; }
export function run(sql:string,...args:unknown[]) { return db.prepare(sql).run(...args); }
export function id(){return crypto.randomUUID();}
export function now(){return new Date().toISOString();}
export function audit(org:string,user:string,action:string,details:unknown){run('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)',id(),org,user,action,JSON.stringify(details),now());}
export function encrypt(value:string){const key=process.env.DATA_ENCRYPTION_KEY;if(!key||Buffer.from(key,'hex').length!==32)throw Error('Configure DATA_ENCRYPTION_KEY as 64 hexadecimal characters before face enrollment.');const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);return [iv.toString('hex'),Buffer.concat([c.update(value,'utf8'),c.final()]).toString('hex'),c.getAuthTag().toString('hex')].join('.');}
export function decrypt(value:string){const [iv,data,tag]=value.split('.');const c=createDecipheriv('aes-256-gcm',Buffer.from(process.env.DATA_ENCRYPTION_KEY!,'hex'),Buffer.from(iv,'hex'));c.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([c.update(Buffer.from(data,'hex')),c.final()]).toString();}
