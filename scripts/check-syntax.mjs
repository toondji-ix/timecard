import {createRequire} from 'node:module';
import {readdirSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const require=createRequire(import.meta.url);
let ts;
try{ts=require('typescript');}catch{ts=require(resolve('.verify/node_modules/typescript'));}
let failures=0,count=0;
function inspect(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())inspect(file);else if(/\.tsx?$/.test(file)){count++;const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);for(const d of source.parseDiagnostics){failures++;const p=source.getLineAndCharacterOfPosition(d.start||0);console.error(`${file}:${p.line+1}:${p.character+1}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`);}}}}
for(const dir of ['app','lib','scripts','tests'])inspect(dir);
console.log(`${count} TypeScript files parsed; ${failures} syntax errors. This does not replace type checking or a build.`);
process.exitCode=failures?1:0;
