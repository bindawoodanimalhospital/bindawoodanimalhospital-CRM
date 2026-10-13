import Link from "next/link";
import {
  BedDouble, Bug, FlaskConical, Home, Pill, Receipt, Scissors, Stethoscope, Syringe, UserRound, type LucideIcon,
} from "lucide-react";
import type { Episode, PetHistory } from "@/lib/pet-history";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-PK")}`;
const cap = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const ICON: Record<Episode["kind"], LucideIcon> = { visit: Stethoscope, surgery: Scissors, ward: BedDouble, vaccination: Syringe, deworming: Bug, bill: Receipt };

/** Summary numbers across the pet's whole life at the clinic. */
export function HistorySummary({ h, showMoney }: { h: PetHistory; showMoney: boolean }) {
  const s = h.summary;
  const tiles: [string, string][] = [
    ["Visits", String(s.visits)],
    ["First seen", s.firstAt ? formatDate(s.firstAt) : "—"],
    ["Last seen", s.lastAt ? formatDate(s.lastAt) : "—"],
    ["Vaccinations", String(s.vaccines)],
    ["Surgeries", String(s.surgeries)],
    ["Hospital stays", String(s.wardStays)],
    ...(showMoney ? [["Total billed", rs(s.billed)], ["Still owed", rs(s.owed)]] as [string, string][] : []),
  ];
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-surface p-3 ring-1 ring-border print:p-2">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className={cn("text-lg font-bold tabular-nums print:text-sm", k === "Still owed" && s.owed > 0 && "text-danger")}>{v}</p>
          </div>
        ))}
      </div>
      {(s.doctors.length > 0 || s.medicines.length > 0) && (
        <div className="grid gap-1 text-sm">
          {s.doctors.length > 0 && <p><span className="text-muted-foreground">Seen by:</span> {s.doctors.join(", ")}</p>}
          {s.medicines.length > 0 && <p><span className="text-muted-foreground">Medicines ever prescribed:</span> {s.medicines.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}

/** One visit (or other event) with everything that happened in it. */
export function EpisodeCard({ e, print, showMoney, showPrivate, open, showPet }: { e: Episode; print?: boolean; showMoney: boolean; showPrivate: boolean; open?: boolean; showPet?: boolean }) {
  const Icon = ICON[e.kind];
  const c = e.consultation;
  const dx = c?.diagnoses.map((d) => `${d.label}${d.primary ? " (primary)" : ""}${d.certainty && d.certainty !== "confirmed" ? ` — ${d.certainty}` : ""}`).join(", ");
  const headline = [dx || c?.assessment || c?.complaint || e.reason].find(Boolean);
  const body = (
    <div className="grid grid-cols-1 gap-4 pt-3 text-sm">
      {/* Who and when */}
      <Facts rows={[
        ["Brought by", e.broughtBy],
        ["Doctor", e.doctor ?? c?.doctor ?? null],
        ["Checked in by", e.checkedInBy],
        ["Token", e.token ? `#${e.token}` : null],
        ["Reason for visit", e.reason],
        ["Home visit", e.homeVisit],
        ["Weight", e.weight != null ? `${e.weight} kg` : null],
      ]} />
      {e.steps.length > 0 && (
        <Section title="Visit timeline">
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {e.steps.map((s, i) => <li key={i}><b>{formatTime(s.at)}</b> {s.label}{s.by ? ` · ${s.by}` : ""}</li>)}
          </ol>
        </Section>
      )}

      {c && (
        <Section title={`Consultation${c.status === "finalized" ? " (finalized)" : " (draft)"}`} icon={Stethoscope}
          aside={c.finalizedBy ? `Signed by ${c.finalizedBy}${c.finalizedAt ? `, ${formatDateTime(c.finalizedAt)}` : ""}${c.revisions ? ` · edited ${c.revisions}×` : ""}` : null}>
          <Facts rows={[
            ["Complaint", c.complaint], ["History", c.history], ["Examination", c.exam], ["Observations", c.observations],
            ["Diagnosis", dx || null], ["Assessment", c.assessment], ["Treatment", c.treatment], ["Medicines given in clinic", c.medicinesGiven],
            ["Follow-up", [c.followUpPlan, c.followUpDate ? `on ${formatDate(c.followUpDate)}` : null].filter(Boolean).join(" ") || null],
            ...(showPrivate && !print ? [["Doctor's private notes", c.doctorNotes] as [string, string | null]] : []),
          ]} />
          {c.vitals.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.vitals.map(([k, v]) => <span key={k} className="rounded-lg bg-muted px-2 py-1 text-xs"><span className="text-muted-foreground">{k}</span> <b>{v}</b></span>)}
            </div>
          )}
        </Section>
      )}

      {e.prescriptions.map((p) => (
        <Section key={p.id} title={`Prescription ${p.code}${p.status === "cancelled" ? " (cancelled)" : ""}`} icon={Pill}
          aside={[p.doctor && `By ${p.doctor}`, p.issuedAt && formatDateTime(p.issuedAt)].filter(Boolean).join(" · ")}
          link={print ? undefined : { href: `/print/prescription/${p.id}`, label: "Print" }}>
          <Table head={["Medicine", "Dose", "How often", "For", "Route", "Qty", "Instructions"]}
            rows={p.lines.map((l) => [[l.medicine, l.strength, l.form].filter(Boolean).join(" "), l.dose, l.frequency, l.duration, l.route, l.quantity == null ? null : String(l.quantity), l.instructions])} />
          {p.notes && <p className="mt-1 text-xs text-muted-foreground">Advice: {p.notes}</p>}
        </Section>
      ))}

      {e.dewormings.length > 0 && (
        <Section title="Deworming" icon={Bug}>
          <Table head={["Dewormer", "Dose", "Given by", "Next due"]}
            rows={e.dewormings.map((d) => [d.product, d.dose, d.by, d.nextDue ? formatDate(d.nextDue) : null])} />
        </Section>
      )}

      {e.vaccinations.length > 0 && (
        <Section title="Vaccinations" icon={Syringe}>
          <Table head={["Vaccine", "Batch", "Dose / route / site", "Given by", "Next due", "Reaction"]}
            rows={e.vaccinations.map((v) => [[v.name, v.manufacturer].filter(Boolean).join(" — "), v.batch, [v.dose, v.route, v.site].filter(Boolean).join(" · ") || null, v.by, v.nextDue ? formatDate(v.nextDue) : null, v.reaction])} />
        </Section>
      )}

      {e.tests.map((t) => (
        <Section key={t.id} title={`${t.type}${t.urgent ? " (urgent)" : ""}`} icon={FlaskConical}
          aside={`${cap(t.status)} · ordered by ${t.orderedBy ?? "—"}${t.resultedBy ? ` · result by ${t.resultedBy}` : ""}${t.reviewedBy ? ` · reviewed by ${t.reviewedBy}` : ""}`}>
          <Facts rows={[["Why", t.reason], ["Lab", t.lab], ["Findings", t.findings], ["Impression", t.impression],
            ["Values", t.values && typeof t.values === "object" && Object.keys(t.values as object).length
              ? Object.entries(t.values as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("; ") : null]]} />
        </Section>
      ))}

      {e.surgeries.map((s) => (
        <Section key={s.id} title={`Surgery — ${s.procedure}`} icon={Scissors} aside={`${cap(s.status)} · ${formatDateTime(s.at)}`}
          link={print ? undefined : { href: `/surgery/${s.id}`, label: "Open" }}>
          <Facts rows={[
            ["Surgeon", s.surgeon], ["Team", s.team.length ? s.team.map((t) => `${t.name} (${t.role.replace(/_/g, " ")})`).join(", ") : null],
            ["Why", s.indication], ["Urgency", s.urgency], ["ASA", s.asa], ["Anaesthesia", s.anaesthesia], ["During surgery", s.intraOp],
            ["Complications", s.complications], ["Recovery", s.recovery], ["Materials used", s.consumables.join(", ") || null],
            ["Discharged by", s.dischargedBy], ["Follow-up", s.followUp ? formatDate(s.followUp) : null],
          ]} />
        </Section>
      ))}

      {e.ward.map((w) => (
        <Section key={w.id} title={`Hospital stay${w.code ? ` ${w.code}` : ""}`} icon={BedDouble}
          aside={`${formatDateTime(w.admittedAt)} → ${w.dischargedAt ? formatDateTime(w.dischargedAt) : "still admitted"}`}
          link={print ? undefined : { href: `/ward/${w.id}`, label: "Open" }}>
          <Facts rows={[
            ["Reason", w.reason], ["Doctor", w.doctor], ["Admitted by", w.admittedBy], ["Discharged by", w.dischargedBy],
            ["Outcome", w.outcome ? cap(w.outcome) : null], ["Discharge summary", w.summary],
          ]} />
          {w.orders.length > 0 && (
            <Table head={["Treatment ordered", "Dose", "Route", "Every", "Ordered by", "Status"]}
              rows={w.orders.map((o) => [o.description, o.dose, o.route, o.every ? `${o.every} h` : null, o.by, cap(o.status)])} />
          )}
          {w.doses.length > 0 && (
            <Table head={["Given at", "What", "Result", "Given by", "Note"]}
              rows={w.doses.map((d) => [formatDateTime(d.at), d.what, cap(d.result), d.by, d.note])} />
          )}
          {w.notes.length > 0 && (
            <Table head={["When", "Note", "By"]} rows={w.notes.map((n) => [formatDateTime(n.at), `${cap(n.kind)}: ${n.note}`, n.by])} />
          )}
        </Section>
      ))}

      {showMoney && e.bills.map((b) => (
        <Section key={b.id} title={`Bill ${b.number ?? ""}${b.status === "void" ? " (void)" : ""}`} icon={Receipt}
          aside={`${rs(b.total)} · paid ${rs(b.paid)}${b.balance > 0 ? ` · owes ${rs(b.balance)}` : ""}${b.by ? ` · by ${b.by}` : ""}`}
          link={print ? undefined : { href: `/billing/${b.id}`, label: "Open" }}>
          <Table head={["Item", "Qty", "Amount"]} rows={b.lines.map((l) => [l.description, String(l.qty), rs(l.total)])} />
        </Section>
      ))}
    </div>
  );

  const header = (
    <span className="flex w-full items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand print:hidden"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 font-semibold">
          {showPet && e.petName && <span className="rounded-full bg-brand-soft px-2 text-xs font-semibold text-brand print:bg-transparent print:px-0">{e.petName}</span>}
          {e.title}
          {e.status === "cancelled" && <span className="rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">cancelled</span>}
          {e.homeVisit && <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 text-xs font-medium text-info"><Home className="size-3" />home</span>}
        </span>
        {headline && <span className={cn("block text-sm text-muted-foreground", !print && "truncate")}>{headline}</span>}
        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {(e.doctor ?? c?.doctor) && <span className="inline-flex items-center gap-1"><UserRound className="size-3" />{e.doctor ?? c?.doctor}</span>}
          {e.prescriptions.length > 0 && <span>{e.prescriptions.reduce((n, p) => n + p.lines.length, 0)} medicine(s)</span>}
          {e.vaccinations.length > 0 && <span>{e.vaccinations.length} vaccine(s)</span>}
          {e.dewormings.length > 0 && <span>dewormed</span>}
          {e.tests.length > 0 && <span>{e.tests.length} test(s)</span>}
          {showMoney && e.bills.length > 0 && <span>{rs(e.bills.reduce((n, b) => n + b.total, 0))}</span>}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs text-muted-foreground">
        <span className="block font-semibold text-foreground">{formatDate(e.at)}</span>{formatTime(e.at)}
      </span>
    </span>
  );

  if (print) {
    return <section className="break-inside-avoid border-b py-3">{header}{body}</section>;
  }
  return (
    <details open={open} className="group rounded-2xl bg-card p-4 shadow-card ring-1 ring-border open:ring-brand-muted">
      <summary className="cursor-pointer list-none">{header}</summary>
      {body}
      {e.visitId && (
        <div className="mt-3 flex justify-end"><Link href={`/visits/${e.visitId}`} className="text-sm font-semibold text-brand hover:underline">Open this visit →</Link></div>
      )}
    </details>
  );
}

function Section({ title, icon: Icon, aside, link, children }: { title: string; icon?: LucideIcon; aside?: string | null; link?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface p-3 ring-1 ring-border print:rounded-none print:bg-transparent print:p-0 print:ring-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2">
        {Icon && <Icon className="size-4 text-brand print:hidden" />}
        <b className="text-sm">{title}</b>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
        {link && <Link href={link.href} className="ml-auto text-xs font-semibold text-brand hover:underline">{link.label}</Link>}
      </div>
      {children}
    </div>
  );
}

function Facts({ rows }: { rows: [string, string | null | undefined][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr] print:grid-cols-[9rem_1fr]">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs text-muted-foreground sm:pt-0.5">{k}</dt>
          <dd className="whitespace-pre-wrap">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | null | undefined)[][] }) {
  if (!rows.length) return null;
  // Hide columns that are empty in every row.
  const keep = head.map((_, i) => rows.some((r) => r[i]));
  return (
    <div className="mt-1 overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-muted-foreground">{head.map((h, i) => keep[i] && <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y">
          {rows.map((r, j) => <tr key={j} className="align-top">{r.map((c, i) => keep[i] && <td key={i} className="py-1 pr-3">{c ?? "—"}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
