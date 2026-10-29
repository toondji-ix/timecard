import { createClient } from '@supabase/supabase-js';
import { all, one, run, now } from './db';
import { supabaseConfig } from './supabase-config';
import { authBaseUrl } from './auth-urls';
export function supabaseInvitesConfigured() { return !!(supabaseConfig() && process.env.SUPABASE_SECRET_KEY?.trim()); }
export type InviteEmailStatus = 'sent' | 'queued' | 'not_configured' | 'not_requested';
// Stateless clients keep the invited user's authentication separate from the
// manager's browser session. Only local acceptance grants workspace membership.
export async function sendWorkspaceInvite(inviteId: string): Promise<InviteEmailStatus> {
    const invite = await one('SELECT * FROM invites WHERE id=?', inviteId);
    if (!invite?.email)
        return 'not_requested';
    await run("INSERT OR IGNORE INTO invite_deliveries(invite_id,status,updated) VALUES(?,'pending',?)", inviteId, now());
    if (invite.revoked || invite.accepted || invite.expires <= now()) {
        await run("UPDATE invite_deliveries SET status='cancelled',updated=? WHERE invite_id=?", now(), inviteId);
        return 'not_requested';
    }
    const delivery = (await one('SELECT * FROM invite_deliveries WHERE invite_id=?', inviteId))!;
    if (delivery.status === 'sent')
        return 'sent';
    if (!supabaseInvitesConfigured()) {
        await run("UPDATE invite_deliveries SET status='pending',last_error='missing_configuration',updated=? WHERE invite_id=?", now(), inviteId);
        return 'not_configured';
    }
    const claimed = await run("UPDATE invite_deliveries SET status='sending',attempts=attempts+1,updated=? WHERE invite_id=? AND (status='pending' OR (status='sending' AND updated<?))", now(), inviteId, new Date(Date.now() - 15 * 60000).toISOString());
    if (!claimed.changes)
        return 'queued';
    try {
        const config = supabaseConfig()!;
        const deliveryFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
        const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' as const }, global: { fetch: deliveryFetch } };
        const admin = createClient(config.url, process.env.SUPABASE_SECRET_KEY!.trim(), options);
        const redirect = new URL('/api/auth/confirm', authBaseUrl());
        redirect.searchParams.set('flow', 'invite');
        redirect.searchParams.set('invite', invite.token);
        let { error } = await admin.auth.admin.inviteUserByEmail(invite.email, { redirectTo: redirect.href });
        // Supabase's admin invitation API rejects already registered accounts. Send
        // those recipients a magic link instead, without creating another account.
        if (error && (error.code === 'email_exists' || error.code === 'user_already_exists' || /already.*registered|already.*exists/i.test(error.message))) {
            const client = createClient(config.url, config.key, options);
            ({ error } = await client.auth.signInWithOtp({ email: invite.email, options: { shouldCreateUser: false, emailRedirectTo: redirect.href } }));
        }
        if (error) {
            await run("UPDATE invite_deliveries SET status='pending',last_error=?,updated=? WHERE invite_id=?", error.code || 'provider_error', now(), inviteId);
            console.warn('Workspace invitation email deferred', { code: error.code || 'provider_error', status: error.status });
            return 'queued';
        }
        await run("UPDATE invite_deliveries SET status='sent',last_error=NULL,updated=? WHERE invite_id=?", now(), inviteId);
        // Supersede legacy Resend outbox entries only after Supabase accepts delivery.
        await run('UPDATE outbox SET sent=1 WHERE sent=0 AND lower(address)=lower(?) AND instr(body,?)>0', invite.email, '?invite=' + invite.token);
        return 'sent';
    }
    catch {
        await run("UPDATE invite_deliveries SET status='pending',last_error='delivery_error',updated=? WHERE invite_id=?", now(), inviteId);
        return 'queued';
    }
}
export async function retryWorkspaceInvites() {
    // Recover unsent invitation messages queued by the previous Resend transport.
    for (const invite of await all("SELECT DISTINCT i.id FROM invites i JOIN outbox o ON lower(o.address)=lower(i.email) AND instr(o.body,'?invite='||i.token)>0 WHERE o.sent=0 AND o.subject LIKE 'You''re invited to %' AND i.revoked=0 AND i.accepted=0 AND i.expires>? LIMIT 100", now())) {
        await run("INSERT OR IGNORE INTO invite_deliveries(invite_id,status,updated) VALUES(?,'pending',?)", invite.id, now());
    }
    for (const delivery of await all("SELECT invite_id FROM invite_deliveries WHERE status='pending' OR (status='sending' AND updated<?) ORDER BY updated LIMIT 100", new Date(Date.now() - 15 * 60000).toISOString()))
        await sendWorkspaceInvite(delivery.invite_id);
}
