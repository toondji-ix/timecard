# Render deployment

Timecard is a Next.js application. `app/page.tsx` is the entry page, `app/layout.tsx` is the document layout, and `app/api/[...path]/route.ts` contains server endpoints. There is no source `index.html`; Next.js generates page output when it builds. A `src` directory is optional in Next.js; this project keeps `app` and `lib` at its root.

## Render Web Service

Connect the repository and create a **Web Service**, using the Node runtime.

| Setting | Value |
| --- | --- |
| Root directory | Directory containing `package.json`; leave blank if it is at the repository root |
| Build command | `npm ci && npm run build` |
| Start command | `npm run start -- --hostname 0.0.0.0 --port $PORT` |
| Node version environment variable | `NODE_VERSION=22` |
| Instances | One, while using SQLite |
| Health check path | `/api/public/config` |

Choose a service plan that supports a persistent disk. With the application at the repository root, mount the disk at `/opt/render/project/src/data`. Set `DATABASE_PATH=data/timecard.sqlite`. If you specify a Root Directory subfolder, include that subfolder in the disk mount path. The relative database path stays the same. Backups under `data/backups` will also reside on this disk.

The disk is available only at runtime. The build can create a temporary database in its own `data` folder; the mounted disk replaces that folder at runtime. Schema migrations run when the server opens its persistent database. Do not run SQLite migrations against the disk in a pre-deploy command. Use the same persistent disk and encryption key when restoring existing data; deployment does not automatically upload the local database.

## Environment

Enter variables in Render's **Environment** settings. `.env.local` is ignored and will not be uploaded by Git. Keep production values separate from development and never commit secrets.

```dotenv
NODE_VERSION=22
NODE_ENV=production
APP_URL=https://YOUR-SERVICE.onrender.com
DATABASE_PATH=data/timecard.sqlite
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
SESSION_SECRET=YOUR_EXISTING_STABLE_SESSION_SECRET
DATA_ENCRYPTION_KEY=YOUR_EXISTING_64_HEX_CHARACTER_KEY
BUSINESS_MONTHLY_AMOUNT=1500000
BUSINESS_CURRENCY=NGN
NEXT_PUBLIC_BUSINESS_PRICE_LABEL=₦15,000
TIMECARD_MAINTENANCE=on
```

Copy the applicable Paystack test, AWS and Resend variables listed in `.env.example` into Render as well. Keep `SESSION_SECRET` and `DATA_ENCRYPTION_KEY` stable across deploys. Never regenerate the data key if encrypted face identifiers already exist. Supabase account deletion additionally requires server-only `SUPABASE_SECRET_KEY`, which must never use a `NEXT_PUBLIC_` prefix. The publishable key is sufficient for ordinary authentication.

## Supabase email and Google setup

1. In **Authentication → URL Configuration**, set Site URL to the Render HTTPS origin. Add `https://YOUR-SERVICE.onrender.com/api/auth/callback` to Redirect URLs. Keep `http://localhost:3000/api/auth/callback` for local development. `APP_URL` must match the origin for each deployment. App callback URLs add flow/invitation query parameters.
2. In **Authentication → Sign In / Providers → Email**, enable email/password and email confirmation. Configure custom SMTP with a verified sender for real users.
3. In **Google Cloud Console → Google Auth Platform → Clients**, create a Web application OAuth client. Add the application origins to Authorized JavaScript origins. Add the callback URL displayed in Supabase's Google settings to Authorized redirect URIs, normally `https://<project-ref>.supabase.co/auth/v1/callback`.
4. In **Supabase → Authentication → Sign In / Providers → Google**, enter the Google Client ID and Secret, enable the provider and save. The Google secret belongs in Supabase, not the application environment.

Standard Supabase templates use PKCE links, which should be opened in the browser that requested them. For confirmation across browsers, the application also supports token-hash links: use `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup` in the confirmation template and `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery` in the recovery template. App-generated RedirectTo URLs already include a flow query parameter.

Existing local account IDs and memberships are preserved when a verified Supabase identity signs in with the same email. Local password hashes are not bulk-imported. Existing users need a Supabase identity with that email; already registered Supabase users can reset their password. Google users can use **Profile → Account and ownership → Send password setup email** before password-protected ownership transfer or deletion. Account deletion requires the server-only secret key and fails before deleting local data when that key is absent.

Authentication uses cookie-backed Supabase SSR clients in API handlers, which validate the user and refresh tokens. A signed, versioned application cookie also preserves application-side session revocation on password reset. Workspace permissions remain in local membership records. Enterprise OIDC remains a separate sign-in path.

The configured Supabase project accepted its publishable key in a read-only settings check: email and email confirmation were enabled; Google was disabled. No live signup, email-delivery or Google consent test was performed.

## Other callbacks and verification

Set the Paystack **test** webhook URL to `https://YOUR-SERVICE.onrender.com/api/billing/webhook`. AWS face verification still requires its region, IAM credentials and liveness role. Resend sends workspace invitations and leave notifications; Supabase sends authentication emails when configured.

Run the build and tests successfully before deployment. The previous local production build encountered an internal Next.js page-collection error; a cleanup/rebuild was declined. The current Supabase changes need their own successful build before production readiness can be claimed. This document supplies configuration; no Render service or disk has been provisioned.

References: [Render Next.js](https://render.com/docs/deploy-nextjs-app), [persistent disks](https://render.com/docs/disks), [Supabase Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls).
