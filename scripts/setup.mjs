import {existsSync,readFileSync,appendFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const path='.env.local',existing=existsSync(path)?readFileSync(path,'utf8'):'';
for(const name of ['SESSION_SECRET','DATA_ENCRYPTION_KEY'])if(!new RegExp('^'+name+'=.+','m').test(existing))appendFileSync(path,`\n${name}=${randomBytes(32).toString('hex')}\n`);
console.log('Local encryption and session keys are ready.');
