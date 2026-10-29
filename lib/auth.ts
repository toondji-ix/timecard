import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { one, run } from './db';
import { supabaseConfigured, supabaseServer } from './supabase';
const developmentSecret = randomBytes(32).toString('hex');
function secret() {
    if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32))
        throw Error('Set SESSION_SECRET (32+ characters).');
    return new TextEncoder().encode(process.env.SESSION_SECRET || developmentSecret);
}
export async function session(userId: string, provider = 'local') { const u = (await one('SELECT auth_version FROM users WHERE id=?', userId))!; const token = await new SignJWT({ uid: userId, v: u.auth_version, provider }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(secret()); (await cookies()).set('timecard_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 604800 }); }
export async function user() {
    try {
        const token = (await cookies()).get('timecard_session')?.value;
        if (!token)
            return null;
        const { payload } = await jwtVerify(token, secret());
        const u = await one('SELECT id,email,name,verified,auth_version,supabase_id FROM users WHERE id=?', payload.uid);
        if (!u || u.auth_version !== payload.v)
            return null;
        if (payload.provider === 'supabase') {
            if (!supabaseConfigured())
                return null;
            const client = await supabaseServer();
            const { data, error } = await client.auth.getUser();
            if (error || !data.user?.email_confirmed_at || data.user.id !== u.supabase_id)
                return null;
        }
        else if (supabaseConfigured() && payload.provider !== 'oidc')
            return null;
        return u;
    }
    catch {
        return null;
    }
}
export async function logout() {
    if (supabaseConfigured()) {
        const client = await supabaseServer();
        await client.auth.signOut({ scope: 'local' });
    }
    (await cookies()).delete('timecard_session');
}
export async function rateLimit(key: string, limit = 10) {
    const t = Date.now();
    const row = await one(`INSERT INTO rate_limits(key,count,reset) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN rate_limits.reset<=? THEN 1 ELSE rate_limits.count+1 END,
      reset=CASE WHEN rate_limits.reset<=? THEN excluded.reset ELSE rate_limits.reset END
      RETURNING count`, key, t + 900000, t, t);
    if (row!.count > limit) throw Error('Too many attempts. Please try again in 15 minutes.');
}
