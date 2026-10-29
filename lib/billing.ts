import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { all, one, run, db, id, now } from './db';
export const businessPrice = { amount: Number(process.env.BUSINESS_MONTHLY_AMOUNT || 1500000), currency: process.env.BUSINESS_CURRENCY || 'NGN', interval: 'monthly' };
export const businessPriceLabel = () => new Intl.NumberFormat('en-NG', { style: 'currency', currency: businessPrice.currency, maximumFractionDigits: 0 }).format(businessPrice.amount / 100);
function secret() {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key?.startsWith('sk_test_'))
        throw Error('Configure a Paystack test secret key. Live billing is disabled.');
    return key;
}
export async function paystack(path: string, body?: Record<string, unknown>, method?: string) {
    const response = await fetch('https://api.paystack.co/' + path, { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || result.status !== true) {
        const reason = typeof result.message === 'string' ? result.message.replaceAll(secret(), '[redacted]').replace(/sk_(test|live)_[a-zA-Z0-9]+/g, '[redacted]').slice(0, 180) : 'Please try again.';
        throw Error('Paystack test billing: ' + reason);
    }
    return result.data;
}
export function verifiedEvent(raw: string, signature: string, key: string) {
    const expected = createHmac('sha512', key).update(raw).digest(), actual = Buffer.from(signature, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
        throw Error('Invalid webhook signature.');
    const event = JSON.parse(raw);
    return { ...event, id: createHash('sha256').update(raw).digest('hex') };
}
async function workspacePlan(org: string) {
    let plan = await one('SELECT * FROM paystack_plans WHERE org_id=?', org);
    if (!plan) {
        const result = await paystack('plan', { name: 'Timecard Business ' + org, amount: businessPrice.amount, interval: businessPrice.interval, currency: businessPrice.currency, description: 'Business workspace subscription. Test mode.', send_invoices: true });
        await run('INSERT OR IGNORE INTO paystack_plans VALUES(?,?,?)', org, result.plan_code, now());
        plan = (await one('SELECT * FROM paystack_plans WHERE org_id=?', org))!;
    }
    const verified = await paystack('plan/' + encodeURIComponent(plan.code));
    if (verified.currency !== businessPrice.currency || verified.amount !== businessPrice.amount || verified.interval !== businessPrice.interval)
        throw Error('The Paystack plan must be NGN 15,000 per workspace monthly.');
    return plan;
}
export async function createCheckout(org: string, email: string, appUrl: string) {
    secret();
    const existing = await one("SELECT * FROM paystack_checkouts WHERE org_id=? AND status='pending' AND url IS NOT NULL ORDER BY created DESC LIMIT 1", org);
    if (existing)
        return existing.url;
    const plan = await workspacePlan(org), reference = 'timecard-' + id();
    await run('INSERT INTO paystack_checkouts(reference,org_id,plan_code,amount,currency,email,created) VALUES(?,?,?,?,?,?,?)', reference, org, plan.code, businessPrice.amount, businessPrice.currency, email, now());
    const result = await paystack('transaction/initialize', { email, amount: businessPrice.amount, currency: businessPrice.currency, plan: plan.code, reference, callback_url: new URL('/?billing=return&org=' + encodeURIComponent(org), appUrl).href, metadata: { org_id: org, plan: 'business' } });
    await run('UPDATE paystack_checkouts SET url=? WHERE reference=?', result.authorization_url, reference);
    return result.authorization_url;
}
function planCode(value: any) { return typeof value === 'string' ? value : value?.plan_code; }
function customerCode(value: any) { return typeof value === 'string' ? value : value?.customer_code; }
export async function refreshSubscription(code: string) {
    const sub = await paystack('subscription/' + encodeURIComponent(code));
    if (sub.domain !== 'test')
        throw Error('Live payment data is not accepted.');
    const plan = await one('SELECT * FROM paystack_plans WHERE code=?', planCode(sub.plan));
    if (!plan || sub.plan.amount !== businessPrice.amount || sub.plan.currency !== businessPrice.currency)
        throw Error('Subscription does not match a Timecard Business test plan.');
    const customer = customerCode(sub.customer), current = await one('SELECT * FROM subscriptions WHERE org_id=?', plan.org_id);
    if (current && current.customer !== customer)
        throw Error('Subscription customer does not match this workspace.');
    const paid = !!await one("SELECT reference FROM paystack_checkouts WHERE org_id=? AND status='paid'", plan.org_id);
    await db.transaction(async () => { await run('INSERT INTO subscriptions(org_id,customer,subscription,item,status,quantity,cancel_at_period_end,last_event,updated) VALUES(?,?,?,?,?,1,?,0,?) ON CONFLICT(org_id) DO UPDATE SET customer=excluded.customer,subscription=excluded.subscription,item=excluded.item,status=excluded.status,quantity=1,cancel_at_period_end=excluded.cancel_at_period_end,updated=excluded.updated', plan.org_id, customer, sub.subscription_code, plan.code, sub.status, sub.status === 'non-renewing' ? 1 : 0, now()); const active = paid && ['active', 'attention', 'non-renewing'].includes(sub.status); await run("UPDATE organizations SET plan=CASE WHEN plan='enterprise' THEN plan ELSE ? END WHERE id=?", active ? 'business' : 'free', plan.org_id); })();
    return sub;
}
export async function verifyPayment(reference: string) {
    const transaction = await paystack('transaction/verify/' + encodeURIComponent(reference));
    if (transaction.domain !== 'test' || transaction.status !== 'success' || transaction.amount !== businessPrice.amount || transaction.currency !== businessPrice.currency)
        throw Error('The successful workspace test payment could not be verified.');
    const checkout = await one('SELECT * FROM paystack_checkouts WHERE reference=?', reference), plan = await one('SELECT * FROM paystack_plans WHERE code=?', planCode(transaction.plan_object) || planCode(transaction.plan));
    if (!checkout && !plan)
        throw Error('This payment does not belong to a Timecard workspace.');
    const org = checkout?.org_id || plan!.org_id;
    if (checkout && (checkout.email.toLowerCase() !== transaction.customer.email.toLowerCase() || (plan && checkout.plan_code !== plan.code)))
        throw Error('The payment does not match this checkout.');
    const previous = await one('SELECT * FROM subscriptions WHERE org_id=?', org);
    if (!checkout && (!previous || previous.customer !== customerCode(transaction.customer)))
        throw Error('The renewal does not match this workspace.');
    // Replaying an old transaction must never restore a cancelled subscription.
    if (previous) {
        await refreshSubscription(previous.subscription);
        return org;
    }
    await db.transaction(async () => {
        if (checkout)
            await run("UPDATE paystack_checkouts SET status='paid' WHERE reference=?", reference);
        await run("UPDATE organizations SET plan=CASE WHEN plan='enterprise' THEN plan ELSE 'business' END WHERE id=?", org);
    })();
    try {
        if (transaction.customer?.id) {
            const subscriptions = await paystack('subscription?customer=' + encodeURIComponent(transaction.customer.id));
            const match = Array.isArray(subscriptions) ? subscriptions.find((s: any) => planCode(s.plan) === (checkout?.plan_code || plan?.code)) : null;
            if (match?.subscription_code)
                await refreshSubscription(match.subscription_code);
        }
    }
    catch { /* The signed webhook or maintenance retries linking if creation is still pending. */ }
    return org;
}
export async function handleBillingEvent(event: any) {
    if (await one('SELECT id FROM webhook_events WHERE id=?', event.id))
        return;
    const data = event.data;
    if (data?.domain && data.domain !== 'test')
        throw Error('Live payment events are not accepted.');
    if (event.event === 'charge.success')
        await verifyPayment(data.reference);
    else if (['subscription.create', 'subscription.disable', 'subscription.not_renew', 'invoice.create', 'invoice.payment_failed', 'invoice.update'].includes(event.event)) {
        const code = data.subscription_code || data.subscription?.subscription_code;
        if (code)
            await refreshSubscription(code);
    }
    await run('INSERT OR IGNORE INTO webhook_events VALUES(?,?)', event.id, now());
}
// Flat workspace billing has no per-seat charge. Keep this hook for membership changes.
export async function syncSeats(_org: string) { }
export async function reconcileBilling() {
    for (const checkout of await all("SELECT c.reference FROM paystack_checkouts c LEFT JOIN subscriptions s ON s.org_id=c.org_id WHERE c.status='paid' AND s.org_id IS NULL"))
        try {
            await verifyPayment(checkout.reference);
        }
        catch {
            console.error('Paystack payment reconciliation deferred.');
        }
    for (const sub of await all('SELECT * FROM subscriptions'))
        try {
            await refreshSubscription(sub.subscription);
        }
        catch {
            console.error('Paystack subscription reconciliation deferred.');
        }
}
