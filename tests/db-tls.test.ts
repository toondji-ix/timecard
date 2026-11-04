import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,connect,type Server,type ConnectionOptions} from 'node:tls';
import {Client} from 'pg';
import {databaseConnectionOptions,databaseConnectionError} from '../lib/db-tls';
import {startMaintenance} from '../lib/scheduler';

// These credentials are public, test-only localhost fixtures, never deployment credentials.
const ca=readFileSync(new URL('./fixtures/db-tls/localhost.crt',import.meta.url),'utf8');
const key=readFileSync(new URL('./fixtures/db-tls/localhost.key',import.meta.url),'utf8');
let server:Server,port:number;
before(async()=>{server=createServer({cert:ca,key},socket=>socket.end());server.on('tlsClientError',()=>{});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));port=(server.address() as {port:number}).port;});
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));});
const handshake=(options:ConnectionOptions)=>new Promise<boolean>((resolve,reject)=>{
 const socket=connect({...options,host:'127.0.0.1',port,servername:options.servername||'localhost'});
 socket.setTimeout(5000,()=>socket.destroy(Error('TLS fixture timed out')));
 socket.once('secureConnect',()=>{resolve(socket.authorized);socket.end();});socket.once('error',reject);
});

test('the configured private CA permits a verified TLS handshake',async()=>{
 const options=databaseConnectionOptions('postgresql://fixture:password@localhost/db',{DATABASE_SSL_CA:ca});
 assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(await handshake(options.ssl),true);
});
test('untrusted certificates and mismatched hostnames are still rejected',async()=>{
 await assert.rejects(handshake(databaseConnectionOptions('postgresql://fixture@localhost/db',{}).ssl),/self.signed/i);
 await assert.rejects(handshake({...databaseConnectionOptions('postgresql://fixture@localhost/db',{DATABASE_SSL_CA:ca}).ssl,servername:'wrong.example'}),/hostname|altnames/i);
});
test('PEM environment values support escaped newlines and URL SSL modes cannot disable verification',()=>{
 const options=databaseConnectionOptions('postgresql://fixture@localhost/db?sslmode=no-verify&uselibpqcompat=true',{DATABASE_SSL_CA:ca.trim().replaceAll('\n','\\n')});
 assert.equal(options.ssl.ca,ca.trim());assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);
 const client=new Client(options);assert.equal((client as any).connectionParameters.ssl.rejectUnauthorized,true);assert.equal((client as any).connectionParameters.ssl.ca,ca.trim());
});
test('Render secret files and URL sslrootcert paths are honored before URL cleanup',()=>{
 const directory=mkdtempSync(join(tmpdir(),'timecard-ca-')),file=join(directory,'root.crt');writeFileSync(file,ca);
 try{for(const options of [databaseConnectionOptions('postgresql://fixture@localhost/db',{DATABASE_SSL_CA_FILE:file}),databaseConnectionOptions('postgresql://fixture@localhost/db?sslrootcert='+encodeURIComponent(file),{})])assert.equal(options.ssl.ca,ca.trim());}
 finally{rmSync(directory,{recursive:true,force:true});}
});
test('invalid certificate settings fail with configuration guidance and no secret values',()=>{
 assert.throws(()=>databaseConnectionOptions('postgresql://fixture:private-password@localhost/db',{DATABASE_SSL_CA:'private-invalid-value'}),e=>e instanceof Error&&/Invalid database CA/.test(e.message)&&!e.message.includes('private-'));
 assert.throws(()=>databaseConnectionOptions('postgresql://fixture@localhost/db',{DATABASE_SSL_CA_FILE:'nonexistent-certificate-file'}),/Cannot read the database CA/);
 const message=databaseConnectionError(Object.assign(Error('raw internal message'),{code:'SELF_SIGNED_CERT_IN_CHAIN'})).message;assert.match(message,/DATABASE_SSL_CA/);assert.doesNotMatch(message,/raw internal/);
});
test('maintenance registration schedules work without connecting to the database at startup',async()=>{
 const saved=process.env.DATABASE_URL;process.env.DATABASE_URL='invalid-startup-url';
 try{await startMaintenance();const globalState=globalThis as any;assert.ok(globalState.timecardMaintenance);clearInterval(globalState.timecardMaintenance);delete globalState.timecardMaintenance;}
 finally{if(saved===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=saved;}
});
