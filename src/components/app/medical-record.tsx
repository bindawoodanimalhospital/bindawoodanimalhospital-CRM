import { formatAge, formatDate, formatDateTime } from "@/lib/format";
import { formatTemp, formatWeight, parseRange, spellFrequency } from "@/lib/clinical";
import type { MedicalRecord, RecordStay, RecordSurgery, RecordTest, RecordVisit } from "@/lib/medical-record";
import { cn } from "@/lib/utils";

/*
 * The owner's medical record, as a document. Rendered inside PrintShell (letterhead) by both the staff printout and
 * the private share link. Plain markup only (no client code), so it prints and loads fast on a phone.
 */

const PRIORITY: Record<string, string> = { emergency: "Emergency", urgent: "Urgent" };

export function MedicalRecordView({ r }: { r: MedicalRecord }) {
  const p = r.pet;
  const sex = p.sex === "unknown" ? null : `${p.sex[0].toUpperCase()}${p.sex.slice(1)}${p.neutered ? (p.sex === "female" ? " (spayed)" : " (neutered)") : ""}`;
  return (
    <div className="grid gap-5 text-[12.5px] leading-relaxed">
      {/* Pet hero: who this record is about, at a glance */}
      <section className="break-inside-avoid overflow-hidden rounded-2xl bg-brand-wash ring-1 ring-brand/15">
        <div className="flex flex-wrap items-center gap-4 p-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-2xl font-extrabold text-brand-foreground shadow-sm">
            {p.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-heading text-2xl leading-tight font-extrabold tracking-tight">{p.name}
              <span className="ml-2 align-middle text-xs font-semibold text-muted-foreground">{p.code}</span></p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[[p.species, p.breed].filter(Boolean).join(" · "), sex, p.dob ? formatAge(p.dob, p.dobEstimate) : null,
                r.latestWeight ? formatWeight(r.latestWeight.kg) : null].filter(Boolean).map((t) => (
                <span key={t as string} className="rounded-full bg-white/80 px-2.5 py-0.5 text-[11.5px] font-medium ring-1 ring-border">{t}</span>
              ))}
            </div>
          </div>
          {r.owner && (
            <div className="rounded-xl bg-white/80 px-3.5 py-2 text-right ring-1 ring-border">
              <p className="text-[10px] font-bold tracking-[0.16em] text-brand uppercase">Owner</p>
              <p className="font-semibold">{r.owner.name}</p>
              {r.owner.code && <p className="text-[11px] text-muted-foreground">Client {r.owner.code}</p>}
            </div>
          )}
        </div>
        {(p.color || p.microchip || r.latestWeight) && (
          <p className="flex flex-wrap gap-x-5 gap-y-0.5 border-t border-brand/10 bg-white/60 px-4 py-1.5 text-[11px] text-muted-foreground">
            {p.color && <span>Colour: <b className="text-ink">{p.color}</b></span>}
            {p.microchip && <span>Microchip: <b className="text-ink">{p.microchip}</b></span>}
            {r.latestWeight && <span>Weighed {formatDate(r.latestWeight.at)}</span>}
            {r.scope && <span>Problem: <b className="text-ink">{r.scope.title}</b></span>}
          </p>
        )}
      </section>
      <p className="-mt-2 text-center text-[10.5px] text-muted-foreground">
        A summary of the clinic&apos;s records for {p.name}&apos;s owner — it does not replace a consultation.
      </p>

      {/* Health at a glance */}
      {(r.alerts.length > 0 || r.due.length > 0 || r.lastVaccination || r.lastDeworming) && (
        <Card title="Health at a glance">
          {r.alerts.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {r.alerts.map((a) => (
                <span key={a.label} className={cn("rounded-md px-2 py-0.5 text-[11.5px] font-semibold ring-1",
                  a.severity === "info" ? "bg-surface ring-border" : "bg-danger-soft text-danger ring-danger/25")}>
                  {a.kind === "allergy" ? "Allergy: " : ""}{a.label}
                </span>
              ))}
            </div>
          )}
          <Facts rows={[
            ["Next due", r.due.length ? r.due.slice(0, 4).map((d) => `${d.title} — ${formatDate(d.dueOn)}`).join(" · ") : null],
            ["Last vaccine", r.lastVaccination ? `${r.lastVaccination.name} · ${formatDate(r.lastVaccination.at)}` : null],
            ["Last deworming", r.lastDeworming ? `${r.lastDeworming.product} · ${formatDate(r.lastDeworming.at)}` : null],
          ]} />
        </Card>
      )}

      {/* Problems */}
      {(r.scope ? [r.scope] : r.problems).length > 0 && (
        <section className="break-inside-avoid">
          <Heading>{r.scope ? "Problem" : "Problems"}</Heading>
          <Table head={["Problem", "Status", "First visit", "Last visit", "Visits"]} rows={(r.scope ? [r.scope] : r.problems).map((pr) => [
            <b key="t">{pr.title}</b>,
            <span key="s" className={pr.status === "open" ? "font-semibold text-warning" : "text-success"}>
              {pr.status === "open" ? "Open" : `Resolved ${pr.resolvedAt ? formatDate(pr.resolvedAt) : ""}`}</span>,
            pr.firstVisit ? formatDate(pr.firstVisit) : "—", pr.lastVisit ? formatDate(pr.lastVisit) : "—", String(pr.visits),
          ])} />
        </section>
      )}

      {/* Visits, newest first */}
      <section className="grid gap-4">
        <Heading>{r.scope ? "Visits for this problem" : "Visits"}</Heading>
        {r.visits.length === 0 && <p className="text-muted-foreground">No visits recorded yet.</p>}
        {r.visits.map((v) => <Visit key={v.id} v={v} showProblem={!r.scope} />)}
      </section>

      {((r.surgeries?.length ?? 0) > 0 || (r.stays?.length ?? 0) > 0) && (
        <section className="grid gap-3">
          <Heading>Surgeries &amp; hospital stays</Heading>
          {r.surgeries?.map((x) => <SurgeryBlock key={x.procedure + x.at} x={x} />)}
          {r.stays?.map((x) => <StayBlock key={x.admittedAt} x={x} />)}
        </section>
      )}

      {/* Vaccines and deworming (whole record) */}
      {!r.scope && r.vaccinations.length > 0 && (
        <section className="break-inside-avoid">
          <Heading>Vaccinations</Heading>
          <Table head={["Date", "Vaccine", "Next due"]} rows={r.vaccinations.map((x) => [formatDate(x.at), x.name, x.nextDue ? formatDate(x.nextDue) : "—"])} />
        </section>
      )}
      {!r.scope && r.dewormings.length > 0 && (
        <section className="break-inside-avoid">
          <Heading>Deworming &amp; flea / tick</Heading>
          <Table head={["Date", "Product", "Dose", "Next due"]} rows={r.dewormings.map((x) => [formatDate(x.at), x.product, x.dose ?? "—", x.nextDue ? formatDate(x.nextDue) : "—"])} />
        </section>
      )}

      {r.vitals.length > 1 && (
        <section className="break-inside-avoid">
          <Heading>Weight &amp; vitals over time</Heading>
          <Table head={["Date", "Weight", "Temperature", "Heart rate", "Breathing"]} rows={r.vitals.map((x) => [
            formatDate(x.at), x.weightKg != null ? formatWeight(x.weightKg) : "—", x.tempC != null ? formatTemp(x.tempC) : "—",
            x.hr != null ? `${x.hr} /min` : "—", x.rr != null ? `${x.rr} /min` : "—",
          ])} />
        </section>
      )}
    </div>
  );
}

function Visit({ v, showProblem }: { v: RecordVisit; showProblem: boolean }) {
  const c = v.consultation;
  const vit = c?.vitals;
  const vitals = (vit ? [
    vit.tempC != null && ["Temperature", formatTemp(vit.tempC)], vit.hr != null && ["Heart rate", `${vit.hr} /min`],
    vit.rr != null && ["Breathing", `${vit.rr} /min`], vit.weightKg != null && ["Weight", formatWeight(vit.weightKg)],
    vit.bcs != null && ["Body condition", `${vit.bcs}/9`], vit.mm && ["Mucous membranes", vit.mm], vit.crt != null && ["CRT", `${vit.crt} s`],
    vit.hydration && ["Hydration", vit.hydration], vit.pulse && ["Pulse", vit.pulse], vit.mentation && ["Mentation", vit.mentation],
    vit.pain != null && ["Pain", `${vit.pain}/10`],
  ] : []).filter(Boolean) as [string, string][];
  const abnormal = c?.exam.filter((e) => !e.normal) ?? [];
  const normal = c?.exam.filter((e) => e.normal) ?? [];
  const dx = c?.diagnoses.filter((d) => d.certainty !== "ruled_out" && (d.primary || d.certainty === "confirmed")) ?? [];
  const ddx = c?.diagnoses.filter((d) => d.certainty === "provisional" && !d.primary) ?? [];
  const ruledOut = c?.diagnoses.filter((d) => d.certainty === "ruled_out") ?? [];
  const advised = v.tests.filter((t) => ["ordered", "in_progress"].includes(t.status));
  const reports = v.tests.filter((t) => ["resulted", "reviewed"].includes(t.status));

  return (
    <article className="overflow-hidden rounded-xl ring-1 ring-border">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-brand/10 bg-brand-soft/60 px-3.5 py-2">
        <b className="text-ink">{formatDateTime(v.at)}</b>
        {v.doctor && <span className="text-muted-foreground">{v.doctor}</span>}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {PRIORITY[v.priority] && <Chip tone="danger">{PRIORITY[v.priority]}</Chip>}
          {v.homeVisit && <Chip>Home visit</Chip>}
          {showProblem && v.problem && <Chip tone="brand">{v.problem.title}</Chip>}
        </span>
      </header>
      <div className="grid gap-3 p-3.5">
        {vitals.length > 0 && (
          <div className="grid break-inside-avoid grid-cols-2 gap-1.5 sm:grid-cols-4 print:grid-cols-4">
            {vitals.map(([label, value]) => (
              <div key={label} className="rounded-lg bg-surface px-2.5 py-1.5 ring-1 ring-border">
                <p className="text-[9.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{label}</p>
                <p className="text-[12px] leading-snug font-semibold">{value}</p>
              </div>
            ))}
          </div>
        )}
        {!c && v.reason && <Block letter="S" title="Reason for visit" tone="info">{v.reason}</Block>}
        {!c && v.draftNotes && <p className="text-[11.5px] text-muted-foreground italic">The doctor&apos;s notes for this visit are not finalised yet.</p>}
        {c && (c.complaint || c.history) && (
          <Block letter="S" title="History" tone="info">
            {c.complaint && <p className="font-semibold">{c.complaint}</p>}
            {c.history && <p className="whitespace-pre-wrap">{c.history}</p>}
          </Block>
        )}
        {c && (c.exam.length > 0 || c.observations) && (
          <Block letter="O" title="Examination" tone="neutral">
            {abnormal.length > 0 && (
              <ul className="grid gap-0.5">
                {abnormal.map((e) => <li key={e.system}><b>{e.system}</b> — <span className="font-medium text-danger">{e.finding}</span></li>)}
              </ul>
            )}
            {normal.length > 0 && (
              <p className="text-success"><b>Normal:</b> {normal.map((e) => e.system).join(", ")}</p>
            )}
            {c.observations && <p className="whitespace-pre-wrap">{c.observations}</p>}
          </Block>
        )}
        {c && (c.assessment || dx.length > 0 || ddx.length > 0 || c.prognosis) && (
          <Block letter="A" title="Assessment" tone="warning">
            {dx.length > 0 && <p><b>Diagnosis:</b> {dx.map((d) => d.label + (d.certainty === "provisional" ? " (possible)" : "")).join(", ")}</p>}
            {ddx.length > 0 && <p><b>Also considered:</b> {ddx.map((d) => d.label).join(", ")}</p>}
            {ruledOut.length > 0 && <p className="text-muted-foreground"><b>Ruled out:</b> {ruledOut.map((d) => d.label).join(", ")}</p>}
            {c.assessment && <p className="whitespace-pre-wrap">{c.assessment}</p>}
            {c.prognosis && <p><b>Prognosis:</b> {c.prognosis}</p>}
          </Block>
        )}
        {c && (c.treatment || c.medicinesGiven || c.advice || c.followUpDate) && (
          <Block letter="P" title="Treatment & plan" tone="brand">
            {c.treatment && <p className="whitespace-pre-wrap"><b>Treatment given:</b> {c.treatment}</p>}
            {c.medicinesGiven && <p className="whitespace-pre-wrap"><b>Medicines given at the clinic:</b> {c.medicinesGiven}</p>}
            {c.advice && <p className="whitespace-pre-wrap"><b>Doctor&apos;s advice:</b> {c.advice}</p>}
            {c.followUpDate && <p><b>Next check-up:</b> {formatDate(c.followUpDate)}</p>}
          </Block>
        )}

        {v.prescriptions.map((rx) => (
          <div key={rx.code} className="break-inside-avoid">
            <p className="mb-1 font-semibold">℞ Prescription {rx.code}{rx.doctor ? <span className="font-normal text-muted-foreground"> · {rx.doctor}</span> : null}</p>
            <Table head={["Medicine", "Dose", "How often", "For how long", "How to give"]} rows={rx.items.map((i) => [
              <span key="m"><b>{i.medicine}</b>{i.strength ? ` ${i.strength}` : ""}{i.form ? <span className="text-muted-foreground"> ({i.form})</span> : null}
                {i.instructions && <span className="block text-[11px] text-muted-foreground">{i.instructions}</span>}</span>,
              i.dose, spellFrequency(i.frequency), i.duration ?? "—", i.route ?? "—",
            ])} />
            {rx.notes && <p className="mt-1 text-[11.5px]"><b>Note:</b> {rx.notes}</p>}
          </div>
        ))}

        {advised.length > 0 && (
          <p><b className="text-brand">Tests advised:</b> {advised.map((t) => t.name + (t.urgent ? " (urgent)" : "")).join(", ")}</p>
        )}
        {reports.map((t) => <LabReport key={t.id} t={t} />)}

        {(v.vaccinations.length > 0 || v.dewormings.length > 0) && (
          <div>
            {v.vaccinations.map((x) => <p key={x.name + x.at}><b>Vaccine:</b> {x.name}{x.nextDue ? ` (next ${formatDate(x.nextDue)})` : ""}</p>)}
            {v.dewormings.map((x) => <p key={x.product + x.at}><b>Deworming:</b> {x.product}{x.dose ? ` ${x.dose}` : ""}{x.nextDue ? ` (next ${formatDate(x.nextDue)})` : ""}</p>)}
          </div>
        )}
        {v.surgeries?.map((x) => <SurgeryBlock key={x.procedure + x.at} x={x} />)}
        {v.stays?.map((x) => <StayBlock key={x.admittedAt} x={x} />)}
      </div>
    </article>
  );
}

/** A completed operation, written for the owner: what was done, when, by whom, home care and the check-up. */
function SurgeryBlock({ x }: { x: RecordSurgery }) {
  return (
    <div className="break-inside-avoid rounded-lg bg-surface/60 p-2.5 ring-1 ring-border">
      <p className="font-semibold">Surgery — {x.procedure} <span className="font-normal text-muted-foreground">· {formatDateTime(x.at)}{x.doctor ? ` · ${x.doctor}` : ""}</span></p>
      {x.reason && <p><b>Why:</b> {x.reason}</p>}
      {x.complications && <p><b>Complications:</b> {x.complications}</p>}
      {x.homeCare && <p className="whitespace-pre-wrap"><b>Care at home:</b> {x.homeCare}</p>}
      {x.checkUp && <p><b>Check-up:</b> {formatDate(x.checkUp)}</p>}
    </div>
  );
}

/** A finished hospital (ward) stay, written for the owner. */
function StayBlock({ x }: { x: RecordStay }) {
  return (
    <div className="break-inside-avoid rounded-lg bg-surface/60 p-2.5 ring-1 ring-border">
      <p className="font-semibold">Hospital stay <span className="font-normal text-muted-foreground">· {formatDateTime(x.admittedAt)} → {formatDateTime(x.dischargedAt)}{x.doctor ? ` · ${x.doctor}` : ""}</span></p>
      <p><b>Reason:</b> {x.reason}</p>
      {x.summary && <p className="whitespace-pre-wrap"><b>Summary:</b> {x.summary}</p>}
      {x.outcome && <p><b>Outcome:</b> {x.outcome}</p>}
      {x.homeCare && <p className="whitespace-pre-wrap"><b>Care at home:</b> {x.homeCare}</p>}
      {x.checkUp && <p><b>Check-up:</b> {formatDate(x.checkUp)}</p>}
    </div>
  );
}

function LabReport({ t }: { t: RecordTest }) {
  const hasPrev = t.groups.some((g) => g.rows.some((r) => r.previous));
  const by = t.reviewedBy ?? t.resultedBy;
  return (
    <div className="break-inside-avoid rounded-lg bg-surface/60 p-2.5 ring-1 ring-border">
      <p className="font-semibold">{t.name} <span className="font-normal text-muted-foreground">· {t.code} · {formatDateTime(t.resultedAt ?? t.orderedAt)}</span></p>
      <p className="text-[11px] text-muted-foreground">
        {[by && `Reported by ${by}`, t.lab && `Analysed at ${t.lab}${t.labRef ? `, lab case no. ${t.labRef}` : ""}`].filter(Boolean).join(" · ")}
      </p>
      {t.groups.length > 0 && (
        <table className="mt-1.5 w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-border text-left text-[10.5px] tracking-wide text-muted-foreground uppercase">
              <th className="py-1 pr-2 font-semibold">Test</th><th className="py-1 pr-2 font-semibold">Result</th>
              <th className="py-1 pr-2 font-semibold">Unit</th><th className="py-1 pr-2 font-semibold">Normal range</th>
              {hasPrev && <th className="py-1 font-semibold">Previous</th>}
            </tr>
          </thead>
          <tbody>
            {t.groups.map((g, gi) => [
              g.name && <tr key={`g${gi}`}><td colSpan={hasPrev ? 5 : 4} className="pt-1.5 pb-0.5 font-semibold text-brand">{g.name}</td></tr>,
              ...g.rows.map((row) => (
                <tr key={row.key} className="border-b border-border/60 align-top">
                  <td className="py-0.5 pr-2">{row.label}{row.comment && <span className="block text-[10.5px] text-muted-foreground italic">{row.comment}</span>}</td>
                  <td className="py-0.5 pr-2 tabular">
                    {row.flag
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 font-bold text-danger">{row.value} {row.flag === "H" ? "↑ H" : "↓ L"}</span>
                      : <span className="font-semibold">{row.value}</span>}
                    <RangeBar value={row.value} range={row.range} />
                  </td>
                  <td className="py-0.5 pr-2 text-muted-foreground">{row.unit ?? ""}</td>
                  <td className="py-0.5 pr-2 text-muted-foreground">{row.range ?? "—"}</td>
                  {hasPrev && <td className="py-0.5 text-muted-foreground">{row.previous ? <Trend now={row.value} before={row.previous} /> : ""}</td>}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      )}
      {t.findings && <p className="mt-1.5 whitespace-pre-wrap"><b>Findings:</b> {t.findings}</p>}
      {t.impression && <p className="whitespace-pre-wrap"><b>Conclusion:</b> {t.impression}</p>}
    </div>
  );
}

const TONE = {
  info: { panel: "bg-info-soft/60", badge: "bg-info text-white" },
  neutral: { panel: "bg-surface", badge: "bg-ink text-white" },
  warning: { panel: "bg-warning-soft/60", badge: "bg-warning text-white" },
  brand: { panel: "bg-brand-soft/70", badge: "bg-brand-gradient text-brand-foreground" },
} as const;

/** One SOAP part: a round letter badge and a softly tinted panel. */
function Block({ letter, title, tone, children }: { letter: string; title: string; tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <div className={cn("grid break-inside-avoid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-xl p-2.5", TONE[tone].panel)}>
      <span className={cn("flex size-9 items-center justify-center rounded-full text-[15px] font-extrabold", TONE[tone].badge)}>{letter}</span>
      <div className="grid gap-1">
        <p className="text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "danger" | "brand" }) {
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1",
      tone === "danger" ? "bg-danger-soft text-danger ring-danger/25" : tone === "brand" ? "bg-brand-soft text-brand ring-brand/20" : "bg-card ring-border")}>
      {children}
    </span>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-brand uppercase">
      <span aria-hidden className="h-3.5 w-1 rounded-full bg-brand-gradient" />{children}
    </h2>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid rounded-xl p-3 ring-1 ring-border">
      <Heading>{title}</Heading>
      {children}
    </section>
  );
}

function Facts({ rows, stacked }: { rows: [string, React.ReactNode][]; stacked?: boolean }) {
  const shown = rows.filter(([, v]) => v != null && v !== "");
  return (
    <dl className={cn("grid gap-x-3 gap-y-0.5", stacked ? "grid-cols-1 [&_dd]:mb-1" : "grid-cols-[7.5rem_minmax(0,1fr)]")}>
      {shown.map(([k, v]) => [
        <dt key={`${k}-k`} className="text-muted-foreground">{k}</dt>,
        <dd key={`${k}-v`} className="min-w-0 break-words">{v}</dd>,
      ])}
    </dl>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-border text-left text-[10.5px] tracking-wide text-muted-foreground uppercase">
            {head.map((h) => <th key={h} className="py-1 pr-2 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="border-b border-border/60 align-top">{r.map((c, j) => <td key={j} className="py-1 pr-2">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** Where a result sits against its normal range: the green band is normal, the dot is the result. */
function RangeBar({ value, range }: { value: string; range: string | null }) {
  const r = parseRange(range);
  const v = Number(value);
  if (!r || r.lo == null || r.hi == null || r.hi <= r.lo || !Number.isFinite(v)) return null;
  const span = r.hi - r.lo;
  const min = r.lo - span * 0.6, max = r.hi + span * 0.6;
  const pos = (x: number) => Math.min(100, Math.max(0, ((x - min) / (max - min)) * 100));
  const out = v < r.lo || v > r.hi;
  return (
    <span aria-hidden className="relative mt-1 block h-1.5 w-20 rounded-full bg-muted">
      <span className="absolute inset-y-0 rounded-full bg-success/45" style={{ left: `${pos(r.lo)}%`, width: `${pos(r.hi) - pos(r.lo)}%` }} />
      <span className={cn("absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white", out ? "bg-danger" : "bg-success")}
        style={{ left: `${pos(v)}%` }} />
    </span>
  );
}

/** "↑ from 10.0 (16 Oct 2026)": the direction since the last result for the same test. */
function Trend({ now, before }: { now: string; before: { value: string; at: string } }) {
  const a = Number(before.value), b = Number(now);
  const dir = Number.isFinite(a) && Number.isFinite(b) ? (b > a ? "↑" : b < a ? "↓" : "=") : "";
  return <span>{dir && <b className="text-ink">{dir} </b>}from {before.value} ({formatDate(before.at)})</span>;
}
