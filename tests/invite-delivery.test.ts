import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: resolve('data/invite-delivery-' + randomUUID() + '.sqlite'), SUPABASE_URL: 'https://mock.supabase.invalid', SUPABASE_PUBLISHABLE_KEY: 'mock-publishable-key', SUPABASE_SECRET_KEY: '', APP_URL: 'https://timecard.example.com' });
Object.assign(process.env,{DATABASE_URL:'',DATABASE_TEST_PGLITE_PATH:'',NODE_ENV:'test'});
const { db, one, run, id, now } = await import('../lib/db');
const { sendWorkspaceInvite, retryWorkspaceInvites } = await import('../lib/invite-delivery');
const originalFetch = globalThis.fetch;
await run("INSERT INTO organizations(id,name) VALUES('org','Example Studio')");
async function invite(email = 'new-person@example.invalid') { const key = id(), token = id(); await run('INSERT INTO invites(id,org_id,email,role,department,token,expires) VALUES(?,?,?,?,?,?,?)', key, 'org', email, 'staff', 'Design', token, new Date(Date.now() + 7 * 86400000).toISOString()); return { id: key, token, email }; }
const success = () => new Response(JSON.stringify({ id: randomUUID(), email: 'new-person@example.invalid' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
test('missing server secret queues an invitation without attempting delivery', async () => {
    const row = await invite();
    globalThis.fetch = async () => { throw Error('Unexpected network call'); };
    try {
        assert.equal(await sendWorkspaceInvite(row.id), 'not_configured');
        assert.equal((await one('SELECT status FROM invite_deliveries WHERE invite_id=?', row.id))!.status, 'pending');
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test('new users receive a Supabase admin invite with the public URL and workspace token', async () => {
    process.env.SUPABASE_SECRET_KEY = 'mock-server-secret';
    const row = await invite();
    let count = 0;
    globalThis.fetch = async (input, init) => { count++; const url = new URL(String(input)); assert.equal(url.pathname, '/auth/v1/invite'); assert.equal(new Headers(init?.headers).get('apikey'), 'mock-server-secret'); const body = JSON.parse(String(init?.body)); assert.equal(body.email, row.email); const callback = new URL(url.searchParams.get('redirect_to')!); assert.equal(callback.origin, process.env.APP_URL); assert.equal(callback.pathname, '/api/auth/confirm'); assert.equal(callback.searchParams.get('invite'), row.token); assert.equal(callback.searchParams.get('flow'), 'invite'); return success(); };
    try {
        assert.equal(await sendWorkspaceInvite(row.id), 'sent');
        assert.equal(await sendWorkspaceInvite(row.id), 'sent');
        assert.equal(count, 1);
        assert.equal((await one('SELECT count(*) n FROM memberships'))!.n, 0);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test('already registered recipients get a Supabase magic link without creating a second account', async () => {
    const row = await invite('existing@example.invalid');
    const paths: string[] = [];
    globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        if (url.pathname.endsWith('/invite'))
            return new Response(JSON.stringify({ code: 'email_exists', msg: 'A user with this email address has already been registered' }), { status: 422, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' } });
        assert.equal(url.pathname, '/auth/v1/otp');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.create_user, false);
        assert.equal(new URL(url.searchParams.get('redirect_to')!).searchParams.get('invite'), row.token);
        assert.equal(new Headers(init?.headers).get('apikey'), 'mock-publishable-key');
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
        assert.equal(await sendWorkspaceInvite(row.id), 'sent');
        assert.deepEqual(paths, ['/auth/v1/invite', '/auth/v1/otp']);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test('SMTP failures stay pending and never grant access', async () => {
    const row = await invite();
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'over_email_send_rate_limit', msg: 'Rate limited' }), { status: 429, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' } });
    try {
        assert.equal(await sendWorkspaceInvite(row.id), 'queued');
        assert.equal((await one('SELECT status FROM invite_deliveries WHERE invite_id=?', row.id))!.status, 'pending');
        assert.equal((await one('SELECT count(*) n FROM memberships'))!.n, 0);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test('legacy unsent Resend invitations retry through Supabase and preserve workspace tokens', async () => {
    const row = await invite(), mail = id();
    await run('INSERT INTO outbox VALUES(?,?,?,?,?,0)', mail, row.email, "You're invited to Example Studio", 'Join: http://localhost:3000/?invite=' + row.token, now());
    globalThis.fetch = async () => success();
    try {
        await retryWorkspaceInvites();
        assert.equal((await one('SELECT status FROM invite_deliveries WHERE invite_id=?', row.id))!.status, 'sent');
        assert.equal((await one('SELECT sent FROM outbox WHERE id=?', mail))!.sent, 1);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test('revoked, accepted and expired invitations are not emailed', async () => {
    globalThis.fetch = async () => { throw Error('Unexpected network call'); };
    try {
        for (const flag of ['revoked', 'accepted', 'expired']) {
            const row = await invite();
            if (flag === 'expired')
                await run('UPDATE invites SET expires=? WHERE id=?', '2000-01-01T00:00:00Z', row.id);
            else
                await run(`UPDATE invites SET ${flag}=1 WHERE id=?`, row.id);
            assert.equal(await sendWorkspaceInvite(row.id), 'not_requested');
            assert.equal((await one('SELECT status FROM invite_deliveries WHERE invite_id=?', row.id))!.status, 'cancelled');
        }
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
