import nextEnv from '@next/env';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { unlinkSync } from 'node:fs';
nextEnv.loadEnvConfig(process.cwd());
const file = resolve('data/paystack-smoke-' + randomUUID() + '.sqlite');
Object.assign(process.env,{DATABASE_URL:'',DATABASE_TEST_PGLITE_PATH:'',RENDER:''});
process.env.DATABASE_PATH = file;
const { db, run, id } = await import('../lib/db');
const { createCheckout } = await import('../lib/billing');
const org = id();
await run('INSERT INTO organizations(id,name) VALUES(?,?)', org, 'Paystack test verification');
try {
    const url = await createCheckout(org, 'timecard-test@example.com', 'http://localhost:3000');
    if (new URL(url).hostname !== 'checkout.paystack.com')
        throw Error('Unexpected checkout host.');
    console.log('Paystack test plan created: NGN 15,000 per workspace monthly. Hosted test checkout initialized. No payment was submitted.');
}
catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
}
finally {
    await db.close();
    for (const suffix of ['', '-wal', '-shm'])
        try {
            unlinkSync(file + suffix);
        }
        catch { }
}
