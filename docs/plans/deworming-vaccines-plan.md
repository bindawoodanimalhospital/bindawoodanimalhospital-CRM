# Deworming & vaccines — research, problems found, and plan

*Prepared for Dr. Musab Bin Dawood and staff · 30 Oct 2026 · **built and live 30 Oct 2026** (migration 060) with the decisions below*

## 1. What good practice says (research)

**Vaccines** — WSAVA 2024 Guidelines for the Vaccination of Dogs and Cats:
- **Core vaccines** every animal should get: dogs — distemper, adenovirus (hepatitis), parvovirus; cats — panleukopenia, calicivirus, herpesvirus ("PCH"). **Rabies is core** where it is endemic (Pakistan).
- **Puppies/kittens:** core doses every **2–4 weeks**, last dose at **16 weeks or older**, then a dose at **26 weeks**.
- **Adults:** core MLV vaccines don't need yearly repeats by the guideline, but rabies follows the product label (often yearly in practice) and non-core vaccines (leptospirosis, kennel cough, ringworm) protect for about **1 year**.
- Unknown history: treat like a puppy/kitten series (usually 2 doses 2–4 weeks apart for an adult).

**Deworming** — ESCCAP worm-control guidelines:
- **Puppies/kittens:** every **2 weeks** until weaning (+2 weeks), then **monthly** until 6 months.
- **Adults:** by risk — 1–2×/year (indoor, low risk), **4×/year (default when unsure)**, up to monthly (hunters, raw food, children at home).
- **Different products do different jobs:** praziquantel → tapeworm; pyrantel → roundworm + hookworm; febantel/fenbendazole → + whipworm (fenbendazole also Giardia); milbemycin → + heartworm prevention; flea/tick products (spot-on, chewables) are a **separate track** with their own interval (usually monthly or 12-weekly).

## 2. Problems found in the CRM

| # | Problem | Effect |
|---|---|---|
| 1 | Billing a deworming / vaccine records **what was billed**, not what was given | Wrong tablet in the history if a different one was used |
| 2 | Adding an **older** record (before the CRM) closes the **current** reminder and creates one from the old date | Reminders jump to the wrong (often overdue) date |
| 3 | Vaccine reminders match by **exact vaccine**, not disease | Duplicate reminders (Billu: Rabies + Biocan R both open); PCHR doesn't close a "Rabies" reminder |
| 4 | **One** deworming reminder for everything | A tapeworm-only tablet or a flea product closes the general worming reminder |
| 5 | Items entered already >7 days overdue never get a WhatsApp (reminder days were −3, 0, +3, +7) | Overdue pets from history are silent |
| 6 | Dewormers are free text | No dose-by-weight, no species check, can't add new kinds properly |

## 3. Plan

### A. Dewormer list the doctor manages (Settings → Vaccines & deworming)
Each dewormer: **name, species, type** (internal worms / external parasites / both), **what it covers** (roundworm, tapeworm, hookworm, whipworm, heartworm, giardia, fleas, ticks), **dose** (e.g. 1 tablet per 10 kg), **default interval** (puppy/kitten vs adult), and its **price-list item**. The doctor can add more kinds for dogs any time.

### B. Reminders by what is protected, not by product
- **Vaccines** — each vaccine is linked to diseases (PCHR = panleukopenia + calici + herpes + rabies). One reminder per disease group per pet (e.g. "Cat core (PCH)", "Rabies"). Any vaccine covering it closes it — no duplicates.
- **Deworming** — two tracks: **Internal worms** and **Fleas/ticks**. A combined product closes both.

### C. Bills never write clinical history on their own
- When a bill with a deworming/vaccine is issued and it isn't recorded on the visit, the visit and the pet show **"To confirm: Deworming (Praferan) billed — what was given?"** and the doctor gets a task.
- The doctor confirms (product pre-filled, can change it, dose/weight), or marks **"Not given"**. Only confirmed records enter the history.
- The **reminder is still set right away** (provisional) so nobody is missed; it follows the confirmed record.
- The 7 dewormings and 5 vaccines filled in from bills are moved to "To confirm".

### D. Correct reminder dates
- A record only moves the reminder if it is the **latest** for that disease/track. Older history entries are kept in the history but never override a newer schedule.
- Next date suggested by **age and history**: puppy/kitten series (every 2–4 weeks until 16 weeks, dose at 26 weeks), adult booster per vaccine, deworming by age and the risk level chosen for the pet (low 6-monthly / standard 3-monthly / high monthly).
- Items that are already overdue when entered get **one catch-up WhatsApp** and appear in Overdue for a call.

### E. Clean-up of existing data
- Merge duplicate open reminders (e.g. Billu's rabies) into one per disease/track.
- Re-check every open reminder against the latest record.

### F. Tests before going live
Database tests for every rule above (chronology, duplicates, combined vaccines, tracks, confirm/not-given, void), plus a run on a copy of the live data before switching on.

## 4. Decisions (Dr. Musab, 30 Oct 2026)
1. Bills → history: **doctor confirms** (Confirm / Wrong product / Not given); provisional reminder meanwhile.
2. Adult deworming default: **every 3 months** (per product in the dewormer list).
3. Adult vaccine boosters: **yearly**.
4. Fleas/ticks: **separate reminder track**.

*Sources: WSAVA 2024 Guidelines for the Vaccination of Dogs and Cats; ESCCAP Worm Control in Dogs and Cats (GL1); product summaries for praziquantel / pyrantel / febantel / fenbendazole / milbemycin.*
