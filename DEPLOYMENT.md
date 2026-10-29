# Render deployment

Timecard is a Next.js application. `app/page.tsx` is the entry page, `app/layout.tsx` is the document layout, and `app/api/[...path]/route.ts` contains server endpoints. There is no source `index.html`; Next.js generates page output when it builds. A `src` directory is optional in Next.js; this project keeps `app` and `lib` at its root.

## Render Web Service

Connect the repository and create a **Web Service**, using the Node runtime.

| Setting | Value |
| --- | --- |
| Root directory | Directory containing `package.json`; leave blank if it is at the repository root |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm run start -- --hostname 0.0.0.0 --port $PORT` |
| Node version environment variable | `NODE_VERSION=22` |
| Instance type | Free, with Supabase PostgreSQL |
| Health check path | `/api/public/config` |

Use the existing Supabase PostgreSQL database for workspace storage. No Render disk is needed. Production Render refuses temporary SQLite when DATABASE_URL is missing.

In Supabase **Connect**, select **Transaction pooler**, copy the PostgreSQL URI and replace the password placeholder. Save it as server-only `DATABASE_URL` in **Render Environment**. Use the database password, not the publishable API key; URL-encode special characters in the password. The app uses verified TLS, a small connection pool and no named prepared statements. Never use a NEXT_PUBLIC_ prefix for this secret.

The first runtime connection creates tables in the private `timecard` schema, preserving Supabase's `auth` tables. Schema changes are additive and serialized. The database user needs schema/table creation permission. Builds do not connect to the database. The `/api/public/config` health check verifies runtime database initialization.

After deploying, create a workspace, sign out and in, then restart the Render service and verify the same workspace appears. Records live independently of Render's filesystem. Free services still sleep: maintenance only runs while awake. For guaranteed cleanup and retries, run `npm run maintenance` with a separate scheduler and the same environment.

### Import existing SQLite records

If an existing SQLite backup is available, stop source writes, retain the original DATA_ENCRYPTION_KEY and import before creating any new records in PostgreSQL:

```powershell
npm run migrate:sqlite -- path/to/timecard.sqlite
```

Run from a trusted machine with the destination DATABASE_URL configured locally. The importer preserves IDs, memberships and encrypted identifiers in one transaction. It refuses a nonempty destination and rolls back failed imports. Keep the source backup until verified. Already erased Render files cannot be recovered by this migration.

## Environment

Enter variables in Render's **Environment** settings. `.env.local` is ignored and will not be uploaded by Git. Keep production values separate from development and never commit secrets.

```dotenv
NODE_VERSION=22
NODE_ENV=production
APP_URL=https://YOUR-SERVICE.onrender.com
DATABASE_URL=YOUR_SUPABASE_TRANSACTION_POOLER_URI
SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
SESSION_SECRET=YOUR_EXISTING_STABLE_SESSION_SECRET
DATA_ENCRYPTION_KEY=YOUR_EXISTING_64_HEX_CHARACTER_KEY
BUSINESS_MONTHLY_AMOUNT=1500000
BUSINESS_CURRENCY=NGN
NEXT_PUBLIC_BUSINESS_PRICE_LABEL=₦15,000
TIMECARD_MAINTENANCE=on
```

Copy the applicable Paystack test, AWS and Resend variables listed in `.env.example` into Render as well. Keep `SESSION_SECRET` and `DATA_ENCRYPTION_KEY` stable across deploys. Never regenerate the data key if encrypted face identifiers already exist. Supabase workspace invitations and account deletion require server-only `SUPABASE_SECRET_KEY`, which must never use a `NEXT_PUBLIC_` prefix. The publishable key is sufficient for ordinary authentication.

If signup reports missing email verification, check these two Supabase values in **Render → your Web Service → Environment**. Local `.env.local` values are not deployed. Authentication reads the server runtime values above; the older `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` names are also supported. Save the environment changes and redeploy. Production authentication does not fall back to Resend/local signup when Supabase settings are missing.

## Supabase email and Google setup

1. In **Authentication → URL Configuration**, set Site URL to the Render HTTPS origin. Add `https://YOUR-SERVICE.onrender.com/api/auth/callback` to Redirect URLs. Keep `http://localhost:3000/api/auth/callback` for local development. `APP_URL` must match the origin for each deployment. App callback URLs add flow/invitation query parameters.
2. In **Authentication → Sign In / Providers → Email**, enable email/password and email confirmation. Configure custom SMTP with a verified sender for real users.
3. In **Google Cloud Console → Google Auth Platform → Clients**, create a Web application OAuth client. Add the application origins to Authorized JavaScript origins. Add the callback URL displayed in Supabase's Google settings to Authorized redirect URIs, normally `https://<project-ref>.supabase.co/auth/v1/callback`.
4. In **Supabase → Authentication → Sign In / Providers → Google**, enter the Google Client ID and Secret, enable the provider and save. The Google secret belongs in Supabase, not the application environment.

Standard Supabase templates use PKCE links, which should be opened in the browser that requested them. For confirmation across browsers, the application also supports token-hash links: use `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup` in the confirmation template and `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery` in the recovery template. App-generated RedirectTo URLs already include a flow query parameter.

Existing local account IDs and memberships are preserved when a verified Supabase identity signs in with the same email. Local password hashes are not bulk-imported. Existing users need a Supabase identity with that email; already registered Supabase users can reset their password. Google users can use **Profile → Account and ownership → Send password setup email** before password-protected ownership transfer or deletion. Account deletion requires the server-only secret key and fails before deleting local data when that key is absent.

Authentication uses cookie-backed Supabase SSR clients in API handlers, which validate the user and refresh tokens. A signed, versioned application cookie also preserves application-side session revocation on password reset. Workspace permissions remain in application membership records stored in PostgreSQL. Enterprise OIDC remains a separate sign-in path.

Authentication and storage use separate settings: the Supabase URL/publishable key handles authentication; DATABASE_URL handles business records.

## Other callbacks and verification

Set the Paystack **test** webhook URL to `https://YOUR-SERVICE.onrender.com/api/billing/webhook`. AWS face verification still requires its region, IAM credentials and liveness role. Supabase sends authentication and workspace invitation emails through its configured SMTP. The existing Resend mailer remains for leave notifications and sales email.

Local PostgreSQL tests use an isolated embedded PostgreSQL engine and do not contact live Supabase or send real emails. Verify the live Render connection after deployment; DATABASE_URL is currently stored only in Render.

References: [Render free storage](https://render.com/docs/free), [Supabase PostgreSQL connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## Authentication callback troubleshooting

For this configured Supabase project, the authorization redirect inspected from Supabase is `https://qjygegissguhxwhrpifg.supabase.co/auth/v1/callback`. Register this exact URL in **Google Auth Platform → Clients → the Web application client → Authorized redirect URIs**. That client must match the Client ID saved in Supabase's Google provider. This fixes Google's `redirect_uri_mismatch`; the application's `/api/auth/callback` is a separate redirect registered in Supabase, not the Google callback.

Set Supabase Site URL and Render `APP_URL` to the application's public HTTPS origin. Authentication also falls back to Render's server-provided HTTPS URL if APP_URL is absent or still localhost. Production cannot generate localhost reset links. Keep the app callback in Supabase's Redirect URLs.

For password reset across browsers, set the **Reset password** email template in Supabase to use this link (Site URL must be your app origin):

```html
<a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a>
```

The app verifies this recovery token with Supabase and creates a short-lived, single-use application reset token. Standard PKCE links instead require the browser cookies from the browser that requested the reset. Request a fresh email after changing the settings; use only the newest email. A genuinely expired, already-used, or scanner-consumed provider link cannot be revived by the application. Do not share full reset URLs or tokens in logs/chat.

If Supabase returns an authorization code to Site URL as `/?code=...`, authentication middleware forwards it to `/api/auth/callback` before the landing page renders. The callback exchanges the code for verified cookies and returns a code-free URL. Recovery intent is retained from the PKCE flow even if the fallback redirect omitted its query parameter. Continue to allow the canonical callback path in Supabase Redirect URLs.

## Workspace invitation email through Supabase and Gmail SMTP

Your `onrender.com` address remains the app URL. No Resend account or custom web domain is needed for workspace invitations. Supabase uses the Gmail SMTP settings already configured in its dashboard; keep the Gmail app password in Supabase, not in application source or public environment variables. Gmail sending quotas and delivery policies still apply.

In Render Environment, add `SUPABASE_SECRET_KEY` using the Supabase project's secret key (or legacy service-role key). It is server-only and must never have a `NEXT_PUBLIC_` prefix. Keep the existing Supabase project URL and publishable key, plus `APP_URL` set to the app's HTTPS origin. Missing administrative credentials leave the invitation queued and display an actionable status while preserving the shareable link.

In Supabase **Authentication → URL Configuration**, set Site URL to the Render HTTPS origin and allow both `/api/auth/callback` and `/api/auth/confirm` on that origin. The invitation callback adds flow and workspace-invite query parameters. Local development can retain its localhost callback entries.

In **Authentication → Email Templates**, configure these links. Keep the existing password-reset template unchanged:

**Invite user**:

```html
<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=invite">Join your workspace</a>
```

**Magic Link** and **Confirm signup**:

```html
<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email">Continue to Timecard</a>
```

App-generated RedirectTo URLs always contain a flow query parameter. These token-hash links work in the recipient's browser and do not depend on the inviting manager's browser cookies. Supabase admin invites do not support PKCE. Using the default implicit invite link instead of the templates above will not establish the server-side app session.

New recipients get a Supabase admin invitation. Already registered accounts receive a Supabase email sign-in link with account creation disabled. The verified email must match the local invitation before the app presents workspace acceptance. Membership, role and department come from the local invitation only after explicit acceptance; sending or opening email never grants membership by itself. Invited users can use password reset to set a password, or use Google with the same email.

The invitation dialog distinguishes provider acceptance, queued delivery and missing configuration. SMTP acceptance is not proof of inbox delivery. Pending native invitations and legacy unsent Resend invitation messages are retried through Supabase by the existing maintenance worker; expired, revoked and accepted invitations are skipped. Old localhost invitation URLs are not reused: each Supabase retry carries the saved workspace token on the public HTTPS callback. Generic Resend outbox processing excludes invitation messages.

No real Gmail messages were sent during automated checks. Verify one manager-initiated invitation after configuring the secret key/templates and deploying. If it is accepted by Supabase but does not arrive, check Supabase Auth logs and Gmail delivery/sending limits.
