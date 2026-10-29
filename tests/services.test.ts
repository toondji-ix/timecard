import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.DATABASE_PATH = resolve('data/mail-test-' + randomUUID() + '.sqlite');
Object.assign(process.env,{DATABASE_URL:'',DATABASE_TEST_PGLITE_PATH:'',NODE_ENV:'test'});
const { db, one } = await import('../lib/db');
const { email, emailConfigured } = await import('../lib/services');
const originalFetch = globalThis.fetch;
test('unconfigured invitation email is retained for retry and is never marked as sent', async () => {
    process.env.EMAIL_API_KEY = '';
    process.env.EMAIL_FROM = '';
    assert.equal(emailConfigured(), false);
    await email('unconfigured@example.invalid', 'Invitation', 'Share link');
    const row = (await one('SELECT * FROM outbox WHERE address=?', 'unconfigured@example.invalid'))!;
    assert.equal(row.sent, 0);
});
test('an email is marked sent only after the delivery provider accepts it', async () => {
    process.env.EMAIL_API_KEY = 'isolated-mock-key';
    process.env.EMAIL_FROM = 'Timecard <invites@example.invalid>';
    globalThis.fetch = async (input, init) => { assert.equal(String(input), 'https://api.resend.com/emails'); const payload = JSON.parse(String(init?.body)); assert.equal(payload.to, 'accepted@example.invalid'); assert.equal(payload.from, process.env.EMAIL_FROM); assert.equal(payload.text, 'https://timecard.example.com/?invite=test'); return new Response('{"id":"mock-delivery-id"}', { status: 200 }); };
    try {
        assert.equal(await email('accepted@example.invalid', 'Invitation', 'https://timecard.example.com/?invite=test'), 'sent');
        assert.equal((await one('SELECT sent FROM outbox WHERE address=?', 'accepted@example.invalid'))!.sent, 1);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test('rejected email stays queued rather than being reported as sent', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 429 });
    try {
        await assert.rejects(async () => await email('rejected@example.invalid', 'Invitation', 'Share link'), /queued/);
        assert.equal((await one('SELECT sent FROM outbox WHERE address=?', 'rejected@example.invalid'))!.sent, 0);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
after(async () => {
    globalThis.fetch = originalFetch;
    await db.close();
    for (const suffix of ['', '-wal', '-shm'])
        try {
            unlinkSync(process.env.DATABASE_PATH! + suffix);
        }
        catch { }
});
