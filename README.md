# Bin Dawood Animal Hospital — CRM & Practice Management

Internal operating system for Bin Dawood Animal Hospital, Lahore: customers, pets, clinical records,
appointments, billing, pet store, inventory, reminders and analytics — built around how a Pakistani clinic
actually works (walk-ins, WhatsApp-first, cash + wallets, PKR, flexible discounts).

Product spec: *Bin Dawood Animal Hospital CRM v1.2* (Omer Bin Dawood, Sep 2026).

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Foundation | Auth, staff, roles & permissions, customers, pets, settings, audit log, global search | ✅ Built |
| 2 — Clinic operations | Appointments, live walk-in queue (tokens), consultations with locked records, vaccinations with approved schedules, prescriptions, diagnostics & files, due list, printouts | ✅ Built |
| 3 — Surgery & inpatient | Surgery workflow, admissions, discharge | Next |
| 4 — Billing & store | Invoices, payments, dues & ledger, POS, inventory, suppliers, expenses | |
| 5 — CRM & comms | Reminder/escalation engine, WhatsApp, tasks, campaigns | |
| 6 — Analytics | Owner command center, KPIs, exports | |
| 7 — AI | After workflows and data quality are proven | |

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions) + TypeScript
- **Supabase**: Postgres, Auth, Storage (later phases), `pg_cron` for background jobs (later phases)
- **shadcn/ui** (Radix) + Tailwind CSS v4 — light theme: ink & white with burgundy accent (see docs/DESIGN.md)
- zod, libphonenumber-js (Pakistani numbers), date-fns

### Architecture decisions (vs. the spec)

1. **No separate NestJS server (for now).** The spec suggests NestJS; for a single clinic that means a second
   service to host, secure and keep in sync. Instead:
   - **Authorization lives in Postgres Row Level Security.** Every table checks `private.has_permission('…')`,
     so a permission is enforced even if someone calls the API directly — stronger than checks in an API layer
     alone (spec §33: "enforced server-side, not only hidden in the frontend").
   - **Multi-step money/stock operations become Postgres functions** (one transaction, idempotent), called from
     Server Actions. Phase 4 will add these for payments and FEFO stock deduction.
   - Domain code is grouped per module (`src/app/(app)/<module>/actions.ts`), so a NestJS API can be added later
     (e.g. for a mobile app or integrations) without redesigning the database.
2. **Audit log via triggers.** Every insert/update/delete on audited tables is written by a database trigger with
   the acting user, before/after data and changed columns. It can't be edited or deleted by app users.
3. **One identity, many roles** (spec §49). `staff_roles` supports several roles per person and optional end dates
   for temporary shift cover.
4. **Phones stored as E.164** (`+923001234567`); staff can type `0300-1234567`, `3001234567`, etc. Search matches
   either format.

### Repository & branch strategy

**One repo, one app — frontend and backend together.** In Next.js the "backend" (Server Actions, route handlers)
lives next to the pages that use it, and the real business rules and permissions live in Postgres
(`supabase/migrations`). Splitting frontend and backend into separate repos or long-lived branches would mean
two things to deploy and keep in sync for no benefit — and separate *branches* for frontend/backend never merge
cleanly, so we don't do that.

If a separate API is ever needed (e.g. a mobile app or NestJS), this repo becomes a monorepo in place:
`apps/web` (this app), `apps/api`, `packages/db` (migrations + generated types) — still one repo.

Branches:

| Branch | Purpose |
| --- | --- |
| `main` | Always working, production. Only updated through pull requests. |
| `feat/<name>`, `fix/<name>` | One branch per feature or fix (e.g. `feat/phase-2-appointments`), merged into `main` by PR after review. |

Database changes ship in the same PR as the code that needs them (a new file in `supabase/migrations`), so code
and schema never drift apart. When a staging environment is added, a `develop` branch can deploy to it.

### Design

Light theme only — black & white with a pinch of burgundy. See [docs/DESIGN.md](docs/DESIGN.md) and the live
style guide at `/design` (dev only).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the Supabase keys + DATABASE_URL (session pooler)
npm run db:migrate           # applies supabase/migrations/*.sql
npm run create-owner         # one-time: creates the first Owner/Admin login (prompts for email & password)
npm run dev                  # http://localhost:3000
```

Add all other staff from **Staff → Add staff** inside the app.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | TypeScript / ESLint |
| `npm run db:migrate` | Applies new migrations (history in `supabase_migrations.schema_migrations`, same as the Supabase CLI) |
| `npm run db:test` | Security & safety tests in rolled-back transactions: RLS per role, locked medical records, vaccine safety, Rx/diagnostic locks, due-list rules |
| `npm run create-owner` | Bootstrap / promote an Owner account |

## Project layout

```
supabase/migrations/     SQL migrations — schema, RLS, functions, seed data
scripts/                 migrate, create-owner, SQL test runner
src/proxy.ts             session refresh + redirect to /login (Next 16 "proxy", formerly middleware)
src/lib/                 auth (current staff + permissions), supabase clients, phone/PKR/date helpers, validation
src/components/ui/       shadcn/ui components
src/components/app/      app shell, sidebar, global search, shared page parts
src/app/(auth)/          login, no-access
src/app/(app)/           dashboard, customers, pets, admin (staff, roles, audit), settings
```

## Clinical safety rules (enforced in the database, not just the UI)

- Finalized consultations can't be edited or deleted. A senior doctor can reopen one **with a reason**; every
  finalized version is kept (`consultation_revisions`).
- Interns can write draft notes but can't finalize.
- The system never calculates doses. Prescriptions are written line by line by the doctor and lock when issued.
- Expired vaccine batches can't be recorded. Vaccine schedules are seeded as **drafts** and give no suggestions until
  a senior doctor approves them; any edit un-approves. The next-dose date is always confirmed by the doctor.
- Reviewed diagnostic results are locked. Medical files live in private storage and are opened with 10-minute links.
- Due items (vaccine doses, follow-ups) stay open until someone records an outcome; skipping needs a reason and
  rescheduling keeps the old date.

## Security notes

- `.env.local` holds the **secret key and DB password** — never commit it. `SUPABASE_SECRET_KEY` is used only on
  the server (`src/lib/supabase/admin.ts`, marked `server-only`) for creating logins and password resets.
- New sign-ups get an **inactive staff row with no roles** and can see nothing until an admin activates them.
  Public sign-ups should also be disabled in Supabase → Authentication → Sign In / Providers.
- Deactivating a staff member signs them out everywhere immediately.
