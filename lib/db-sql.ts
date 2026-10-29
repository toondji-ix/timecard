import {tables} from './db-schema';
const tableNames=new Set(tables);
const timestamp="to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";

// Keep parameters bound. Only application-owned SQL identifiers are adapted;
// quoted strings, user values and quoted column names are never rewritten.
export function postgresSql(input:string){
 let sql=input.trim(),ignore=/^INSERT OR IGNORE\b/i.test(sql),index=0;
 if(ignore)sql=sql.replace(/^INSERT OR IGNORE/i,'INSERT');
 if(/^CREATE|^ALTER/i.test(sql))sql=sql.replace(/\bINTEGER\b/g,'BIGINT').replace(/\bREAL\b/g,'DOUBLE PRECISION');
 sql=sql.replace(/\bMAX\(synced_late,\s*\?\)/gi,'GREATEST(synced_late,?)');
 sql=sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\b[A-Za-z_][A-Za-z_0-9]*\b|\?/g,(token,offset:number,source:string)=>{
  if(token==='?')return '$'+(++index);
  if(token[0]==="'"||token[0]==='"')return token;
  if(token==='CURRENT_TIMESTAMP')return timestamp;
  if(tableNames.has(token)&&source[offset-1]!=='.')return 'timecard."'+token+'"';
  if(token==='start'||token==='end')return '"'+token+'"';
  if(token==='instr'&&source[offset-1]!=='.')return 'timecard.instr';
  return token;
 });
 if(ignore)sql=sql.replace(/;$/,'')+' ON CONFLICT DO NOTHING';
 return sql;
}
