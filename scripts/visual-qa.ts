import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
const qaRequire = createRequire(resolve('.verify/package.json'));
const { chromium } = qaRequire('playwright-core');
const AxeBuilder = qaRequire('@axe-core/playwright').default;
const file = resolve('data/visual-' + randomUUID() + '.sqlite');
Object.assign(process.env,{DATABASE_URL:'',DATABASE_TEST_PGLITE_PATH:'',RENDER:''});
process.env.DATABASE_PATH = file;
process.env.TIMECARD_MAINTENANCE = 'off';
const { db, run, id, now } = await import('../lib/db');
const { dateAt } = await import('../lib/domain');
const org = id(), owner = id(), password = randomBytes(24).toString('hex'), hashValue = await hash(password, 12), day = dateAt(new Date(), 'Africa/Lagos');
await run('INSERT INTO users(id,email,name,password,verified) VALUES(?,?,?,?,1)', owner, 'qa-owner@example.invalid', 'Rukayat Akinola', hashValue);
await run("INSERT INTO organizations(id,name,timezone,plan) VALUES(?,?,'Africa/Lagos','business')", org, 'Example Studio · QA');
await run("INSERT INTO memberships(id,org_id,user_id,role,consent) VALUES(?,?,?,'owner',?)", id(), org, owner, now());
const location = id();
await run('INSERT INTO locations VALUES(?,?,?,?,?,?)', location, org, 'Lagos studio', 6.5244, 3.3792, 100);
const annual = id();
await run('INSERT INTO leave_types VALUES(?,?,?,?)', annual, org, 'Annual', 20);
await run('INSERT INTO leave_types VALUES(?,?,?,?)', id(), org, 'Sick', 10);
for (const [i, name] of ['Ada Okafor', 'Tunde Bakare', 'Chiamaka Obi', 'Daniel Bello', 'Amara Eze', 'Seyi Adeyemi'].entries()) {
    const uid = id();
    await run('INSERT INTO users(id,email,name,password,verified) VALUES(?,?,?,?,1)', uid, `qa-person-${i}@example.invalid`, name, hashValue);
    await run('INSERT INTO memberships(id,org_id,user_id,role,department,consent) VALUES(?,?,?,?,?,?)', id(), org, uid, 'staff', i % 2 ? 'Operations' : 'Design', now());
    if (i < 4)
        await run('INSERT INTO attendance(id,org_id,user_id,day,check_in,lat,lng,location_id,match_score,status,late) VALUES(?,?,?,?,?,?,?,?,?,?,?)', id(), org, uid, day, day + (i === 3 ? 'T08:17:00Z' : 'T07:55:00Z'), 6.5244, 3.3792, location, .98, i === 3 ? 'late' : 'present', i === 3 ? 1 : 0);
    if (i === 4)
        await run("INSERT INTO leave_requests(id,org_id,user_id,type_id,start,end,days,note,status,created) VALUES(?,?,?,?,?,?,1,'Rest day','approved',?)", id(), org, uid, annual, day, day, now());
    if (i < 2) {
        const next = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        await run("INSERT INTO leave_requests(id,org_id,user_id,type_id,start,end,days,note,status,created) VALUES(?,?,?,?,?,?,1,'Family time','pending',?)", id(), org, uid, annual, next, next, now());
    }
}
const server = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '--port', '3120'], { env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', DATABASE_PATH: file, TIMECARD_MAINTENANCE: 'off' }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let browser: any;
const out = resolve('.impeccable/review');
mkdirSync(out, { recursive: true });
try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
        try {
            const r = await fetch('http://localhost:3120/api/public/config', { signal: AbortSignal.timeout(3000) });
            if (r.ok) {
                ready = true;
                break;
            }
        }
        catch { }
        await new Promise(r => setTimeout(r, 1000));
    }
    if (!ready)
        throw Error('Preview server did not start.');
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--disable-gpu'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto('http://localhost:3120', { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: resolve(out, 'landing-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Email address').fill('qa-owner@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await page.getByRole('heading', { name: /Rukayat/ }).waitFor();
    const findings: any[] = [];
    const inspect = async (label: string) => { const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); findings.push({ surface: label, violations: result.violations.map((v: any) => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map((n: any) => ({ target: n.target, summary: n.failureSummary })) })) }); };
    await page.screenshot({ path: resolve(out, 'desktop.png'), fullPage: true });
    await inspect('manager desktop');
    await page.getByRole('button', { name: 'Team Attendance', exact: true }).click();
    await page.getByRole('heading', { name: 'Every workday, in view.' }).waitFor();
    await page.getByRole('button', { name: 'Weekly', exact: true }).click();
    await page.getByLabel('Search people').fill('Ada');
    await page.locator('tbody').getByText('Ada Okafor', { exact: true }).first().waitFor();
    await inspect('filtered attendance');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export XLSX', exact: true }).click()]);
    await download.saveAs(resolve(out, 'filtered-report.xlsx'));
    await page.setViewportSize({ width: 360, height: 920 });
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.screenshot({ path: resolve(out, 'mobile.png'), fullPage: true });
    await inspect('manager mobile');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) {
        errors.push('Mobile page has horizontal overflow.');
        console.log(await page.evaluate(() => Array.from(document.querySelectorAll('*')).map(e => ({ tag: e.tagName, cls: e.className, rect: e.getBoundingClientRect().toJSON(), scroll: e.scrollWidth })).filter(e => e.rect.right > 361).slice(0, 40)));
    }
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Locations', exact: true }).click();
    await page.getByRole('button', { name: 'Add location', exact: true }).click();
    await page.getByLabel('Location name').fill('Second studio');
    await page.getByRole('button', { name: /Choose work location/ }).click({ position: { x: 150, y: 100 } });
    const lat = await page.getByLabel('Latitude', { exact: true }).inputValue();
    await page.getByRole('button', { name: /Choose work location/ }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    if (await page.getByLabel('Latitude', { exact: true }).inputValue() !== lat)
        errors.push('Map keyboard activation moved pin.');
    if (lat === '6.5244')
        errors.push('Map selection did not update latitude.');
    await page.screenshot({ path: resolve(out, 'map-mobile.png'), fullPage: true });
    await inspect('map dialog');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'My profile & check-in', exact: true }).click();
    await page.getByRole('heading', { name: 'Your workday, your space.' }).waitFor();
    await page.screenshot({ path: resolve(out, 'profile-mobile.png'), fullPage: true });
    await inspect('profile and consent');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(out, 'checks.json'), JSON.stringify({ pageErrors: errors, accessibility: findings }, null, 2));
    console.log(JSON.stringify({ screenshots: ['desktop.png', 'mobile.png', 'landing-desktop.png', 'map-mobile.png'], pageErrors: errors, accessibilityViolations: findings.map(r => ({ surface: r.surface, count: r.violations.length })) }, null, 2));
    if (errors.length || findings.some(r => r.violations.length))
        process.exitCode = 1;
}
finally {
    await browser?.close();
    server.kill();
    await new Promise(r => setTimeout(r, 1500));
    await db.close();
    for (const suffix of ['', '-wal', '-shm'])
        try {
            unlinkSync(file + suffix);
        }
        catch { }
}
