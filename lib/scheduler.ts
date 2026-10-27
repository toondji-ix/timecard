import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {db,run,one,now} from './db';
const globalScheduler=globalThis as unknown as {timecardMaintenance?:ReturnType<typeof setInterval>};
export function startMaintenance(){if(globalScheduler.timecardMaintenance)return;db.exec('CREATE TABLE IF NOT EXISTS job_leases(name TEXT PRIMARY KEY,expires INTEGER)');
 const tick=()=>{const expires=Date.now()+3600000;const acquired=db.transaction(()=>{const lease=one("SELECT expires FROM job_leases WHERE name='maintenance'");if(lease&&lease.expires>Date.now())return false;run("INSERT INTO job_leases VALUES('maintenance',?) ON CONFLICT(name) DO UPDATE SET expires=excluded.expires",expires);return true;})();if(!acquired)return;
  const child=spawn(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('scripts/maintenance.ts')],{cwd:process.cwd(),env:{...process.env},stdio:['ignore','ignore','pipe'],windowsHide:true});
  child.stderr.on('data',()=>console.error('Timecard maintenance reported an error; inspect provider configuration.'));
  child.on('error',()=>{run("DELETE FROM job_leases WHERE name='maintenance'");console.error('Timecard maintenance could not start.');});child.on('exit',code=>{if(code)run("DELETE FROM job_leases WHERE name='maintenance'");});child.unref();
 };
 const first=setTimeout(tick,30000);first.unref();globalScheduler.timecardMaintenance=setInterval(tick,3600000);globalScheduler.timecardMaintenance.unref();
}
