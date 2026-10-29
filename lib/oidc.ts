import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { one, run, id, now, audit } from './db';
import { session, rateLimit } from './auth';
export const ssoConfigured = () => !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && process.env.OIDC_WORKSPACE_ID);
const redirectUri = () => new URL('/api/auth/sso/callback', process.env.APP_URL || 'http://localhost:3000').href;
async function discovery() {
    if (!ssoConfigured())
        throw Error('Enterprise SSO is not configured.');
    const issuer = process.env.OIDC_ISSUER!.replace(/\/$/, '');
    if (new URL(issuer).protocol !== 'https:')
        throw Error('The SSO issuer must use HTTPS.');
    const r = await fetch(issuer + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(10000) });
    if (!r.ok)
        throw Error('The identity provider is unavailable.');
    const d = await r.json();
    if (d.issuer !== issuer || [d.authorization_endpoint, d.token_endpoint, d.jwks_uri].some(u => !u || new URL(u).protocol !== 'https:'))
        throw Error('The identity provider configuration is invalid.');
    return d;
}
export async function beginSso() {
    const org = await one("SELECT * FROM organizations WHERE id=? AND plan='enterprise'", process.env.OIDC_WORKSPACE_ID || '');
    if (!org)
        throw Error('Enterprise SSO is unavailable for this workspace.');
    const d = await discovery(), state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    await run('INSERT INTO oidc_states VALUES(?,?,?,?,?)', state, nonce, verifier, org.id, new Date(Date.now() + 600000).toISOString());
    (await cookies()).set('timecard_oidc', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/sso', maxAge: 600 });
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({ client_id: process.env.OIDC_CLIENT_ID!, response_type: 'code', scope: 'openid email profile', redirect_uri: redirectUri(), state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return NextResponse.redirect(url);
}
export async function finishSso(req: NextRequest) {
    const state = req.nextUrl.searchParams.get('state'), code = req.nextUrl.searchParams.get('code'), jar = await cookies(), stored = state && jar.get('timecard_oidc')?.value === state ? await one('SELECT * FROM oidc_states WHERE id=? AND expires>?', state, now()) : null;
    jar.delete('timecard_oidc');
    if (!stored || !code)
        throw Error('Your SSO session expired or was cancelled. Please try again.');
    await run('DELETE FROM oidc_states WHERE id=?', state);
    await rateLimit('sso:' + stored.org_id, 50);
    const d = await discovery(), form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: stored.verifier });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (d.token_endpoint_auth_methods_supported?.includes('client_secret_post') && !d.token_endpoint_auth_methods_supported?.includes('client_secret_basic')) {
        form.set('client_id', process.env.OIDC_CLIENT_ID!);
        form.set('client_secret', process.env.OIDC_CLIENT_SECRET!);
    }
    else
        headers.Authorization = 'Basic ' + Buffer.from(encodeURIComponent(process.env.OIDC_CLIENT_ID!) + ':' + encodeURIComponent(process.env.OIDC_CLIENT_SECRET!)).toString('base64');
    const response = await fetch(d.token_endpoint, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(15000) });
    if (!response.ok)
        throw Error('SSO sign-in could not finish.');
    const tokens = await response.json();
    if (!tokens.id_token)
        throw Error('No identity token was returned.');
    const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(d.jwks_uri)), { issuer: d.issuer, audience: process.env.OIDC_CLIENT_ID!, algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'iat', 'exp', 'nonce'] });
    if (payload.nonce !== stored.nonce || payload.email_verified !== true || typeof payload.email !== 'string' || (payload.azp && payload.azp !== process.env.OIDC_CLIENT_ID) || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== process.env.OIDC_CLIENT_ID))
        throw Error('The identity token could not be verified.');
    const person = await one("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.org_id WHERE lower(u.email)=? AND m.org_id=? AND m.active=1 AND o.plan='enterprise'", payload.email.toLowerCase(), stored.org_id);
    if (!person)
        throw Error('Ask your manager for a workspace invitation before signing in with SSO.');
    const linked = await one('SELECT * FROM oidc_identities WHERE issuer=? AND subject=?', d.issuer, payload.sub);
    if (linked && linked.user_id !== person.id)
        throw Error('This identity is linked to another account.');
    await run('INSERT OR IGNORE INTO oidc_identities VALUES(?,?,?)', d.issuer, payload.sub, person.id);
    await run('UPDATE users SET verified=1 WHERE id=?', person.id);
    await session(person.id, 'oidc');
    await audit(stored.org_id, person.id, 'auth.sso', {});
    return NextResponse.redirect(new URL('/', process.env.APP_URL || req.nextUrl.origin));
}
