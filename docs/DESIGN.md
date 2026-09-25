# BDAH Design System

The CRM is used by doctors, interns and reception staff — many are not "tech people". Every screen should feel
calm, obvious and quick. Live reference: run `npm run dev` and open **http://localhost:3000/design**
(development only).

## Principles

1. **One obvious next step.** Each screen has at most one burgundy (primary) button. Everything else is outline/ghost.
2. **Plain words.** "Pet owners", not "CRM contacts". "Who can do what", not "RBAC". Buttons say what happens:
   "Save customer", "Register pet" — never "Submit".
3. **Search first.** The big search bar (Ctrl K) finds any pet/owner by name, 03xx number or ID. Don't make people
   browse lists.
4. **Show only what exists.** No greyed-out "coming soon" menu items. Hide what a role can't use.
5. **Big targets.** Buttons & inputs are 40px tall (48px for key actions); base font is 17px.
6. **Calm surfaces, colour for meaning.** Neutral warm greys + white; burgundy = brand / primary / "you are here";
   green/amber/red/blue only for status.
7. **Progressive disclosure.** Show the answer first (owner, pets, alerts), details on demand.

## Tokens (`src/app/globals.css`)

| Token | Value | Use |
| --- | --- | --- |
| `brand` | `#7a1f30` burgundy | Primary buttons, active nav, links, logo tile, focus ring |
| `brand-strong` | `#5a1522` | Hover/pressed primary |
| `brand-soft` / `brand-muted` | tinted burgundy | Icon tiles, soft highlights, hover borders |
| `ink` | near-black | Text, dark hero banners, avatars (matches clinic signage) |
| `background` | warm off-white | App canvas & sidebar |
| `card` | white | Content panel, cards, inputs |
| `success` / `warning` / `danger` / `info` (+`-soft`) | status | Pills and banners only |

- **Font:** Plus Jakarta Sans (headings bold, body regular/medium). Numbers use `tabular`.
- **Radius:** inputs/buttons `rounded-xl`, cards `rounded-2xl`, hero `rounded-3xl`.
- **Elevation:** `shadow-card` for cards (with `ring-1 ring-border`), `shadow-float` for dialogs & hover lift.
- **Gradients (burgundy only):** `bg-brand-gradient` on primary buttons, the logo tile and primary action icons;
  `bg-hero-gradient` (burgundy → ink) on welcome/brand banners; `bg-brand-wash` for a soft tinted highlight card.
  Never on text, tables or status colours.

## Layout

- **Shell:** inset sidebar on the canvas + white floating content panel. Sidebar collapses to icons; on phones it's a drawer.
- **Header:** sidebar toggle · big search · one burgundy **New** menu.
- **Page:** `PageHeader` (title, one-line description, actions right) → content. Max width 7xl.
- **Home:** dark welcome banner with search → large action tiles → numbers → recent activity.
- **Forms:** grouped in `FormSection` cards, two columns on desktop, one on phone. Required fields marked `*`,
  hints under fields, errors in red below the field. Forms never lose typed input on error.
- **Tables:** inside a `rounded-2xl` card; whole row clickable; secondary columns hide on small screens.

## Components (`src/components/app`)

`PageHeader`, `EmptyState` (icon tile + one helpful sentence + action), `Field` (label/value),
`StatusPill` (tones: neutral, success, warning, danger, info, brand), `FormField`, `FormSection`,
`Pagination`, `GlobalSearch` / `OpenSearch`, `LogoMark` / `Logo` / `LogoLockup` (`src/components/brand`).

## Brand

- Always the clinic's own artwork (originals in `docs/brand/`), prepared as transparent PNGs in `public/brand/`:
  `bdah-mark-white.png` (on burgundy/ink), `bdah-mark-ink.png` and `bdah-mark-burgundy.png` (on white),
  `bdah-lockup-white.png` (mark + "BIN DAWOOD ANIMAL HOSPITAL — BY DR. MUSAB BIN DAWOOD"). Use `LogoMark`,
  `Logo`, `LogoLockup` from `src/components/brand/logo.tsx`; don't redraw or recolour the logo in code.
- App icon: white mark on a burgundy gradient tile (`src/app/icon.png`, `apple-icon.png`).
- Doctors are addressed as "Dr. <first name>" (e.g. "Good evening, Dr. Musab").

## Don'ts

- No dark mode; no more than one primary button per view; gradients only in burgundy (see above).
- Don't use red for anything that isn't an error/danger — burgundy is the brand, red means "problem".
- Don't show internal IDs as the main label; show names, with IDs as small mono text.
