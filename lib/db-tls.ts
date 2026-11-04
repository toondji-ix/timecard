import {readFileSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';
import type {ConnectionOptions} from 'node:tls';

// Keep URL SSL options from replacing the verified TLS object in node-postgres.
export function databaseConnectionOptions(url:string,env:NodeJS.ProcessEnv=process.env){
 let parsed:URL;
 try{parsed=new URL(url);if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error();}
 catch{throw Error('DATABASE_URL must be the Supabase PostgreSQL pooler connection string, not the project API URL.');}
 const file=env.DATABASE_SSL_CA_FILE?.trim()||parsed.searchParams.get('sslrootcert');
 let ca=env.DATABASE_SSL_CA?.trim().replace(/\\n/g,'\n');
 if(!ca&&file){try{ca=readFileSync(file,'utf8').trim();}catch{throw Error('Cannot read the database CA certificate. Check DATABASE_SSL_CA_FILE and the Render secret file.');}}
 if(ca){
  const certificates=ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  try{if(!certificates?.length)throw Error();for(const certificate of certificates)new X509Certificate(certificate);}
  catch{throw Error('Invalid database CA certificate. Set DATABASE_SSL_CA to the complete PEM certificate downloaded from Supabase, or use DATABASE_SSL_CA_FILE.');}
 }
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])parsed.searchParams.delete(key);
 const ssl:ConnectionOptions={rejectUnauthorized:true,...(ca?{ca}:{})};
 return {connectionString:parsed.href,ssl};
}

export function databaseConnectionError(error:unknown):Error{
 const code=(error as {code?:string})?.code;
 if(['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code||''))
  return Error('Database certificate is not trusted. Download the CA certificate from Supabase Database Settings → SSL Configuration and configure DATABASE_SSL_CA or DATABASE_SSL_CA_FILE in Render.');
 return error instanceof Error?error:Error('Database connection failed.');
}
