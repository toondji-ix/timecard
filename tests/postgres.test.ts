import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const path = resolve('data/test-pg-' + randomUUID());
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: '', DATABASE_TEST_PGLITE_PATH: path });
const { db, run, one, all } = await import('../lib/db');
test('PostgreSQL creates the private application schema with compatible defaults and parameter binding', async () => {
    assert.equal(await db.kind(), 'postgres');
    await run('INSERT INTO users(id,email,name,password,verified,supabase_id) VALUES(?,?,?,?,?,?)', 'pg-user', 'pg@example.invalid', 'A name with ? and end', 'unused', 1, 'provider-user');
    const user = await one('SELECT * FROM users WHERE id=?', 'pg-user');
    assert.equal(user!.name, 'A name with ? and end');
    assert.equal(user!.verified, 1);
    assert.equal(user!.auth_version, 0);
    assert.match(user!.created, /^\d{4}-\d{2}-\d{2}T/);
});
test('PostgreSQL workspace and membership writes commit together and failed transactions roll back', async () => {
    await db.transaction(async () => { await run('INSERT INTO organizations(id,name,timezone) VALUES(?,?,?)', 'pg-org', 'Durable workspace', 'UTC'); await run('INSERT INTO memberships(id,org_id,user_id,role) VALUES(?,?,?,?)', 'pg-member', 'pg-org', 'pg-user', 'owner'); })();
    await assert.rejects(db.transaction(async () => { await run("INSERT INTO organizations(id,name) VALUES('rollback-org','Must roll back')"); throw Error('test rollback'); }), /test rollback/);
    assert.equal(await one("SELECT id FROM organizations WHERE id='rollback-org'"), undefined);
    await db.transaction(async () => { await assert.rejects(db.transaction(async () => { await run("UPDATE organizations SET name='Wrong name' WHERE id='pg-org'"); throw Error('nested rollback'); }), /nested rollback/); })();
    assert.equal((await one("SELECT name FROM organizations WHERE id='pg-org'"))!.name, 'Durable workspace');
});
test('workspace and account identity survive closing and reopening the PostgreSQL engine', async () => {
    await db.close();
    const rows = await all('SELECT o.id,o.name,m.role,u.supabase_id FROM organizations o JOIN memberships m ON m.org_id=o.id JOIN users u ON u.id=m.user_id WHERE u.email=?', 'pg@example.invalid');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'pg-org');
    assert.equal(rows[0].role, 'owner');
    assert.equal(rows[0].supabase_id, 'provider-user');
});
test('PostgreSQL supports upserts, invitation retry matching and millisecond lease values', async () => {
    await run('INSERT OR IGNORE INTO webhook_events VALUES(?,?)', 'event', '2026-10-29');
    await run('INSERT OR IGNORE INTO webhook_events VALUES(?,?)', 'event', '2026-10-29');
    assert.equal((await one('SELECT COUNT(*) n FROM webhook_events'))!.n, 1);
    await run('INSERT INTO rate_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset=excluded.reset', 'login', 1, Date.now() + 900000);
    assert.equal(typeof (await one('SELECT reset FROM rate_limits WHERE key=?', 'login'))!.reset, 'number');
    assert.equal((await one("SELECT instr('url?invite=abc','?invite=abc') n"))!.n, 4);
});
test('PostgreSQL attendance and reports retain existing geofence and checkout behavior', async () => {
    const { verifyLocation, writeAttendance } = await import('../lib/attendance');
    const { records } = await import('../lib/reports');
    await run('INSERT INTO locations VALUES(?,?,?,?,?,?)', 'pg-location', 'pg-org', 'Office', 6.5244, 3.3792, 100);
    const location = await verifyLocation('pg-org', { lat: 6.5244, lng: 3.3792, accuracy: 10 });
    assert.equal(location.id, 'pg-location');
    const org = (await one("SELECT * FROM organizations WHERE id='pg-org'"))!;
    await writeAttendance(org, 'pg-user', 'in', { timestamp: '2026-10-29T09:00:00Z', lat: 6.5244, lng: 3.3792, location: 'pg-location', score: .98 });
    await writeAttendance(org, 'pg-user', 'out', { timestamp: '2026-10-29T17:00:00Z', lat: 6.5244, lng: 3.3792, location: 'pg-location', score: .97 });
    const rows = await records(org, 'pg-user', false, new URLSearchParams({ start: '2026-10-29', end: '2026-10-29' }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].total_hours, 8);
    assert.equal(rows[0].checkout_score, .97);
});
after(async () => { await db.close(); if (!path.startsWith(resolve('data') + sep))
    throw Error('Unexpected test path'); rmSync(path, { recursive: true, force: true }); });
