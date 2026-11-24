# Owner's medical record — plan

Clients asked for a medical record they can share with pet owners, like PetXpress's EMR export (Hazel) and Pak Pets'
"Medical Record Summary" + prescription (Daisy). Goal: everything those documents have, built into the CRM's existing
records (no second data entry), and better.

## What the reference documents have, and where it comes from in our CRM

| In their documents | Ours |
|---|---|
| Clinic letterhead | `PrintShell` + Settings → Clinic profile |
| Patient: name, ID, species, breed, sex, neutered, colour, age (weeks for young), weight kg + lbs with date | `pets`, latest `pet_weights` — **add**: age in weeks/days under 16 weeks, lbs |
| Owner: name (+ contact) | `customers` — name and client code only (phone numbers stay owner-only) |
| Problem / case list "Diarrhea (Open)", first/last date | **new** `pet_problems`; `visits.problem_id` |
| Per visit: date/time, doctor, visit type (Emergency) | `visits` (priority, service location), consultation doctor |
| Vitals: temp °F, HR, RR, weight, BCS, MM, CRT, hydration %, **pulse quality**, **mentation** | `consultations` — **add** `pulse_quality`, `mentation`; temperature entered in °C **or °F** (stored °C) |
| S / O / A / P blocks | complaint + history / exam + observations / assessment + diagnoses / treatment, medicines given, plan |
| DX, DDx, prognosis | `consultation_diagnoses` (primary/confirmed = Dx, provisional = DDx, ruled out) — **add** `prognosis` |
| Physical exam: Normal green / abnormal red; "abnormal findings only" | `consultations.exam` ("Normal" or findings) |
| Doctor notes for the owner | `follow_up_plan` (owner advice). Private `doctor_notes` are **never** shared |
| Tests advised | `diagnostic_orders` not yet resulted |
| Lab report: number, performed by, outside lab + case no., grouped sections, result, unit, range ("3-7", "< 0.4"), H/L in red, comment | `diagnostic_orders` — **add** `result_meta` (range + comment per value), `external_ref` (lab case no.); test types get `group` + dog/cat `ranges` |
| Vitals history table | from all consultations |
| Prescription table with frequency spelled out | `prescriptions` (already richer: qty, route, instructions, PVMC no.) — **add** "BD (twice a day)" |

**Better than both:** previous value next to each lab result (trend, e.g. creatinine 10.0 → 12.2); health status at a glance
(allergies/alerts, vaccines due, last deworming); both °F and °C; owner phone never printed; a private share link
(expiring, cancellable, view count) as well as a PDF; one record for the whole history or one problem.

## Build steps

1. **Database (migration 062)** — problems, share links, consultation fields (pulse, mentation, prognosis), lab
   `result_meta` + `external_ref`, grouped CBC and full chemistry panel with dog/cat ranges, locks extended.
   SQL test `medical-record-test.sql`.
2. **Shared helpers** (`lib/clinical.ts`): °F/°C, lbs, age in weeks, range parsing + H/L flag, frequency spelled out.
3. **Record data** (`lib/medical-record.ts`): one loader for staff print and public link (takes the Supabase client,
   always filtered by pet; no bills, no private notes, no phone numbers).
4. **Record view** (`components/app/medical-record.tsx`) — the document itself, print-ready.
5. **Staff print** `/print/medical-record/[petId]?problem=`.
6. **Share links**: actions (create — secret shown once, only its hash stored; cancel), public page `/r/[token]`
   (no sign-in, no-index, no caching), pet page card: problems, owner's record, links.
7. **Doctor screens**: visit page problem picker; consultation editor (°F/°C, pulse, mentation, prognosis);
   tests panel (groups, ranges, H/L, comment, outside lab + case no.).
8. **Prescription print**: frequency spelled out.

## Testing before any push

- SQL: migration 062 + all safety tests on a fresh database (PGlite harness) and on a client's pre-launch database (rolled back).
- Helpers: unit checks (ranges like "3-7", "< 0.4", "> 5"; °F↔°C; weeks; frequencies).
- Visual: dev-only `/design/medical-record` with worst-case sample data, checked at phone and A4 print widths.
- Type-check, lint, production build. Then the real flow on a client's pre-launch database with clearly named test
  records, removed afterwards.
