# Timecard
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
The PRD suggests Next.js with TypeScript. This implementation uses Next.js, React and server routes. SQLite with WAL provides local persistence; production requires a durable host and encrypted volume or migration to managed PostgreSQL. Fonts are bundled locally for reliable loading.

## Users
Managers create workspaces, invite people, review attendance and leave, and export reports. Staff and freelancers check in from phones, see personal hours, and request leave.

## Product Purpose
Warm, simple attendance using face verification and a server-checked work geofence. Staff should check in within three taps.

## Capabilities and Constraints
Implement the supplied PRD only. No payroll, shift scheduling, native apps, or unrelated features. Configurable plan limits: Free 15, Business 3,000, Enterprise unlimited. User confirmed Business at NGN 15,000 per workspace monthly and Paystack test mode, superseding the PRD's TBD price and suggested Stripe integration. USD was rejected by the configured Paystack account. User confirmed 365-day retention and authorized choosing a compatible face provider after Lenso.ai proved unsuitable. AWS Rekognition is selected; real credentials are needed. Google authentication and PWA are optional in the PRD.

## Brand Commitments
Caregiver: warm, friendly, calm and dependable. Blue primary actions and light blue surfaces; a restrained amber accent. Human copy, simple controls, generous spacing. No invented customer claims.

## Evidence on Hand
Source: C:/Users/USER/Downloads/PRD Smart Time Tracking App.md. No existing application or branding assets were present.

## Accessibility & Inclusion
WCAG 2.1 AA on core flows, visible focus, labels, and responsive operation from 360px phones to desktop. Respect reduced motion.
