# Timecard

A responsive attendance workspace implementing the supplied Smart Time Tracking PRD. Next.js, React and TypeScript; durable SQLite; AWS Rekognition face verification; Supabase authentication and invitation email; Resend notifications; Paystack test subscriptions.

## Start locally

```powershell
npm install
npm run dev
```

Open http://localhost:3000. The dev command generates session/encryption keys in ignored `.env.local` if they are missing. Keep those keys stable. Create an account, verify your email, create a workspace, add its work location, and invite your team.

With the Supabase URL and publishable key configured, Supabase handles authentication emails. The legacy local flow remains available for development/tests when neither Supabase variable is set. Its emails can be read through `npm run mailbox`; Supabase emails do not appear there. See [DEPLOYMENT.md](DEPLOYMENT.md) for Supabase email/Google setup, existing-account behavior and Render hosting settings.

## Confirmed product settings

- Business: **NGN 15,000 per workspace per month**, not per staff member.
- Paystack **test mode only**; live secret keys are rejected.
- Free defaults to 15 workspace members; Business to 3,000; Enterprise unlimited. Managers count toward these limits. Limits are configurable through environment variables.
- Attendance and biometric retention defaults to **365 days**.
- Face provider: AWS Rekognition, selected with user approval after Lenso.ai proved unsuitable for private staff verification.

The Paystack test key is configured in `.env.local`. `.env.example` contains empty credential placeholders. Do not commit local secrets or put server secrets in `NEXT_PUBLIC_*` variables.

## Included workflows

- Supabase email/password signup, verification, sign-in, recovery and Google OAuth with PKCE; versioned application sessions are invalidated after password changes.
- Workspace creation, owner/manager/staff roles, workspace switching, expiring single-use email/link invites and revocation.
- Map pin selection by pointer or keyboard, current-location placement, configurable radius, server-side geofence and accuracy checks.
- Consent, AWS liveness and encrypted face identifiers, face deletion, GPS + face check-in/out, duplicate protection, recorded breaks, late/early flags and independent manual approval.
- Daily/Weekly/Monthly personal and team attendance; search, department/person/status filters; CSV and XLSX exports of the current view; detail for check-in and check-out verification evidence.
- Leave requests, approval, decline, cancellation, working-day balances, overlapping-request protection, configurable types, per-person annual allowances on Business, calendars and notifications.
- Paystack hosted checkout, server-side payment verification, authenticated/replay-safe webhooks, subscription status reconciliation, payment-attention handling and hosted subscription management.
- Team access removal, owner transfer and password-confirmed personal account deletion. Owners must transfer their workspaces before deleting their account. Removed staff retain historical attendance in organization reports until retention cleanup.
- Enterprise OpenID Connect sign-in with PKCE, state, nonce and signed ID-token validation. Existing invited members only.
- Responsive landing, pricing, manager and staff screens, keyboard focus, modal focus containment, mobile navigation and locally bundled fonts.

No payroll, shift scheduling, unrelated features or real-money payments were added.

## Paystack test setup

Business is **NGN 15,000/month for the whole workspace**. `BUSINESS_MONTHLY_AMOUNT=1500000` is the amount in kobo; `BUSINESS_CURRENCY=NGN`. The public pricing view also reads server pricing configuration.

Set `PAYSTACK_SECRET_KEY` to a test secret. A workspace-specific monthly plan is created when its manager opens checkout. Pending checkout links are reused. Upgrades are granted only after the backend verifies the transaction, amount, currency and workspace/customer association. A replayed old payment cannot reactivate a cancelled subscription.

Set `APP_URL` to your publicly reachable HTTPS origin for hosted use, and configure `/api/billing/webhook` as the **test** webhook URL in Paystack. Events are verified using the raw body and `x-paystack-signature` (HMAC SHA512). Localhost cannot receive remote webhooks; the return flow verifies payments directly, and maintenance retries subscription reconciliation. Hosted subscription management supports card updates and cancellation.

The configured account rejected USD. The confirmed NGN plan and hosted test checkout were successfully initialized; **no payment was submitted**. Test card authorization, renewal and cancellation against Paystack remain manual integration checks; automated tests cover their application-side behavior.

Official provider references: https://paystack.com/docs/payments/subscriptions/ and https://paystack.com/docs/payments/webhooks/.

## Services still requiring configuration

### AWS face verification

Set `AWS_REGION` and `AWS_LIVENESS_ROLE_ARN`, and provide backend credentials through a workload role, AWS profile, or server environment. The region must support Face Liveness and satisfy your organization's residency requirements. The example `eu-west-1` is not a promise of Nigeria residency.

The backend needs Create/GetFaceLivenessSession, CreateCollection, IndexFaces, SearchFacesByImage, DeleteFaces, and permission to assume the streaming role. Restrict collection permissions to this app's `timecard-*` collections where supported. The streaming role trusts the backend and allows only `rekognition:StartFaceLivenessSession`; the browser receives temporary restricted credentials, never backend credentials.

AWS stores mathematical face vectors in private collections. Timecard stores encrypted face IDs, not photos. Reference images are used transiently; no S3 output or audit-photo retention is configured. Preserve `DATA_ENCRYPTION_KEY` (64 hex characters). Both liveness and match thresholds default to 95%; the match threshold is configurable in workspace settings.

Camera checks remain unavailable until AWS is configured. No simulated successful biometric result exists. Actual phone/liveness enrollment, latency, spoof rejection and deletion need a real AWS/device test.

Provider references: https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-programming-api.html and https://docs.aws.amazon.com/rekognition/latest/dg/collections-search-faces.html.

### Email and sales

Supabase delivers authentication and workspace invitation emails through its configured SMTP provider (Gmail is supported by the configured project). Set server-only `SUPABASE_SECRET_KEY` for invitation delivery, and configure the Supabase invitation/magic-link templates described in [DEPLOYMENT.md](DEPLOYMENT.md). Resend is no longer required for invitations. For leave updates and sales email, the existing mailer still uses `EMAIL_API_KEY`, `EMAIL_FROM`, and `SALES_EMAIL`. Failed invitations remain in a dedicated retry queue. In-app notifications persist independently. Sales enquiries require a configured destination; no address is invented.

### Enterprise SSO

Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_WORKSPACE_ID`. Register `/api/auth/sso/callback` under `APP_URL` with your identity provider. The configured workspace must have an Enterprise contract/plan provisioned by the operator. SSO only admits active existing members with a verified matching provider email. It never automatically grants workspace membership.

## Persistence, retention and backups

`data/timecard.sqlite` uses WAL and a persistent local volume. `DATABASE_PATH` can select a different database. Schema migrations are additive. Do not deploy this database to ephemeral serverless storage or multiple independent application instances. Managed PostgreSQL is the recommended next storage target for multi-instance hosting.

The persistent Node host starts maintenance after 30 seconds and runs it hourly with a database lease. It removes expired completed attendance, deletes expired AWS vectors before local template removal, expires session proofs/tokens and retries email/billing reconciliation. Set `TIMECARD_MAINTENANCE=off` only if an external scheduler runs `npm run maintenance` instead. Manager Settings also provides a deliberate attendance retention cleanup action.

```powershell
npm run backup
npm run maintenance
```

Backups use SQLite's online backup API. Store the database, backups and encryption keys securely, on encrypted storage, with matching retention. SQLite itself does not encrypt the whole database; the host must provide volume encryption and HTTPS. Keep the application stopped when restoring a backup into its configured database path. Backup lifecycle, production monitoring and deployment infrastructure require host configuration; no public deployment or legal-compliance certification is claimed.

## Offline behavior

AWS liveness requires connectivity. Offline attempts are saved on the device and synced as **manual review requests**, including the device timestamp and a synced-late flag. They never silently bypass face/GPS checks or automatically trust the device clock. Queue IDs prevent duplicate synchronization; retries occur on reconnect and reload. Closed-browser background sync is not provided.

Browser GPS cannot guarantee detection of forged coordinates. The server checks geofence distance and accuracy and rejects mock signals where exposed; suspicious cases use manual review.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

The suite covers domain boundaries, real HTTP onboarding and tenancy, invitations, manual approval, leave, plan limits, session revocation, encrypted identifiers and Paystack webhook/subscription behavior. Provider network responses in billing regression tests are mocked; the authenticated Paystack test API and uncharged checkout smoke check were exercised separately.

Optional desktop/mobile QA uses an installed Edge browser, `scripts/visual-qa.ts`, and lightweight `playwright-core`/`@axe-core/playwright` packages under ignored `.verify`. It creates an isolated test database and removes it afterward. Captures and accessibility results go to `.impeccable/review`. Test fixtures are not real staff or shipped application data.

Latest local verification: 19 domain, billing and HTTP integration tests passed across separate runs; the preceding production build passed. The final rebuild after the scoped CSS correction compiled and passed type checks, then failed in Next.js page collection with `Invariant: no direct app page entry found for /_not-found`. Clearing generated `.next` output and retrying was declined, so final build confirmation remains outstanding. Backup and maintenance commands passed. The filtered Business XLSX download was opened and checked. Five sampled manager/mobile/profile/map screens had zero automated axe violations; map keyboard activation and the scoped mobile table overflow correction passed browser checks. This is sampled verification, not full WCAG certification.

AWS, Resend delivery and enterprise IdP live checks remain dependent on their credentials. Performance targets and WCAG conformance must be assessed at the tested scope rather than assumed from the source.