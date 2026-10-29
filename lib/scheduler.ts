import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { db, run, one, now } from './db';
const globalScheduler = globalThis as unknown as {
    timecardMaintenance?: ReturnType<typeof setInterval>;
};
export async function startMaintenance() {
    if (globalScheduler.timecardMaintenance)
        return;
    await db.exec('CREATE TABLE IF NOT EXISTS job_leases(name TEXT PRIMARY KEY,expires INTEGER)');
    const tick = async () => {
        const expires = Date.now() + 3600000;
        const acquired = await one(`INSERT INTO job_leases(name,expires) VALUES('maintenance',?)
            ON CONFLICT(name) DO UPDATE SET expires=excluded.expires
            WHERE job_leases.expires<=? RETURNING name`, expires, Date.now());
        if (!acquired)
            return;
        const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('scripts/maintenance.ts')], { cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        child.stderr.on('data', () => console.error('Timecard maintenance reported an error; inspect provider configuration.'));
        const release = () => run("DELETE FROM job_leases WHERE name='maintenance' AND expires=?", expires).catch(() => console.error('Maintenance lease release failed.'));
        child.on('error', () => { void release(); console.error('Timecard maintenance could not start.'); });
        child.on('exit', (code) => {
            if (code)
                void release();
        });
        child.unref();
    };
    const safeTick = () => { void tick().catch(() => console.error('Timecard maintenance could not connect to storage; it will retry.')); };
    const first = setTimeout(safeTick, 30000);
    first.unref();
    globalScheduler.timecardMaintenance = setInterval(safeTick, 3600000);
    globalScheduler.timecardMaintenance.unref();
}
