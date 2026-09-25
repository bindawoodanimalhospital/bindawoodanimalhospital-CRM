"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Activity, ArrowRight, BedDouble, Check, CircleAlert, CircleCheck, Clock, Loader2, Package, Plus, Printer, RotateCcw,
  ShieldAlert, Siren, Syringe, Trash2, Undo2, Unlock, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { SaveIndicator } from "@/components/app/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { SURGERY_LABEL, SURGERY_STAGES, type SurgeryStatus } from "@/lib/clinic";
import { formatDateTime, formatPKR, formatTime, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DoctorOption } from "@/lib/queries";
import type { FormState } from "@/lib/validation";
import {
  addConsumable, addSurgeryEvent, cancelSurgery, completePreop, moveSurgery, removeConsumable, reopenSurgery,
  revokeConsent, saveSurgery, setTeam, type SurgeryFields,
} from "../actions";
import { ConsentDialog } from "./consent-dialog";

export type SurgeryData = {
  id: string; code: string; status: SurgeryStatus; urgency: "elective" | "urgent" | "emergency";
  procedure_name: string; fields: Record<string, string | number | boolean | null>;
  preop_checklist: Record<string, boolean>; preop_checked_at: string | null; preop_checked_by_name: string | null;
  procedure_start: string | null; procedure_end: string | null; discharged_at: string | null;
  emergency_override_reason: string | null; cancel_reason: string | null; reopened_reason: string | null;
  owner: { name: string; phone: string }; pet: { id: string; name: string; customer_id: string };
  consents: { id: string; signed_by_name: string; relationship: string | null; method: string; signed_at: string; revoked_at: string | null; revoked_reason: string | null; witness: string | null }[];
  team: { staff_id: string; role: string }[];
  events: { id: number; kind: string; at: string; data: Record<string, string>; note: string | null; by: string | null }[];
  consumables: { id: string; item_name: string; quantity: number; unit: string | null; batch_no: string | null }[];
  admission_id: string | null;
};

export type Perms = { manage: boolean; assist: boolean; consent: boolean; reopen: boolean; clinical: boolean };

const METHOD: Record<string, string> = { signed_paper: "signed paper form", signed_on_screen: "signed on screen", verbal_phone: "by phone" };

export function SurgeryWorkspace({ s, perms, doctors, staff, checklist, consentText, admitSlot }: {
  s: SurgeryData; perms: Perms; doctors: DoctorOption[]; staff: DoctorOption[]; checklist: string[];
  consentText: { en: string; ur: string; status?: string }; admitSlot?: React.ReactNode;
}) {
  const closed = s.status === "discharged" || s.status === "cancelled";
  const editable = perms.manage && !closed;
  const [f, setF] = useState(s.fields);
  const { state, queue, flush } = useAutosave<SurgeryFields>((patch) => saveSurgery(s.id, patch));
  const set = (k: keyof SurgeryFields, v: string | number | boolean | null) => { setF((x) => ({ ...x, [k]: v })); queue({ [k]: v } as SurgeryFields); };
  const val = (k: string) => (f[k] ?? "") as string;
  const [checks, setChecks] = useState<Record<string, boolean>>(s.preop_checklist ?? {});
  const toggleCheck = (item: string, on: boolean) => {
    const next = { ...checks, [item]: on };
    setChecks(next);
    queue({ preop_checklist: next });
  };

  const consent = s.consents.find((c) => !c.revoked_at);
  const stageIdx = SURGERY_STAGES.findIndex((x) => x.status === s.status);

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Stage bar */}
      <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {SURGERY_STAGES.map((st, i) => (
          <li key={st.status} className={cn("rounded-xl px-2 py-2 text-center text-xs font-semibold ring-1",
            s.status === "cancelled" ? "bg-muted text-muted-foreground ring-border"
              : i < stageIdx ? "bg-brand-soft text-brand ring-brand-muted"
              : i === stageIdx ? "bg-brand-gradient text-white shadow-md shadow-brand/25 ring-transparent"
              : "bg-card text-muted-foreground ring-border")}>
            {i < stageIdx && <Check className="mr-1 inline size-3" />}{st.label}
          </li>
        ))}
      </ol>

      {s.status === "cancelled" && <Banner tone="neutral">Cancelled: {s.cancel_reason}</Banner>}
      {s.reopened_reason && !closed && <Banner tone="info">Reopened after discharge: {s.reopened_reason}</Banner>}
      {s.emergency_override_reason && <Banner tone="danger"><Siren className="size-4" /> Emergency override: {s.emergency_override_reason}</Banner>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="grid min-w-0 content-start gap-6 lg:col-span-2">
          {/* 1. Plan */}
          <Section n={1} title="Plan" right={<SaveIndicator state={state} />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Procedure"><Input value={val("procedure_name")} disabled={!editable} onChange={(e) => set("procedure_name", e.target.value)} /></FormField>
              <FormField label="Urgency">
                <Select value={val("urgency")} disabled={!editable} onValueChange={(v) => set("urgency", v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="elective">Planned (elective)</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="emergency">Emergency</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Why (indication)" className="sm:col-span-2">
                <Textarea rows={2} value={val("indication")} disabled={!editable} onChange={(e) => set("indication", e.target.value)} />
              </FormField>
              <FormField label="Surgeon">
                <Select value={val("surgeon_id") || "none"} disabled={!editable} onValueChange={(v) => set("surgeon_id", v === "none" ? null : v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Date & time">
                <Input type="datetime-local" disabled={!editable} value={toLocalInput(val("scheduled_at"))}
                  onChange={(e) => set("scheduled_at", e.target.value ? new Date(`${e.target.value}:00+05:00`).toISOString() : null)} />
              </FormField>
              <FormField label="Estimate told to owner (Rs.)">
                <Input type="number" min={0} disabled={!editable} value={val("estimate_amount")} onChange={(e) => set("estimate_amount", e.target.value)} />
              </FormField>
              <FormField label="Estimate notes"><Input disabled={!editable} value={val("estimate_notes")} onChange={(e) => set("estimate_notes", e.target.value)} placeholder="e.g. + medicines, ward stay extra" /></FormField>
              <FormField label="Instructions for owner before surgery" className="sm:col-span-2">
                <Textarea rows={2} disabled={!editable} value={val("pre_op_instructions")} onChange={(e) => set("pre_op_instructions", e.target.value)} placeholder="Fasting, what to bring…" />
              </FormField>
            </div>
            {editable && <TeamEditor surgeryId={s.id} team={s.team} staff={staff} />}
          </Section>

          {/* 2. Pre-op */}
          <Section n={2} title="Pre-op check (on the day)"
            right={s.preop_checked_at ? <StatusPill tone="success"><CircleCheck className="mr-1 size-3" /> Done {formatTime(s.preop_checked_at)}{s.preop_checked_by_name ? ` · ${s.preop_checked_by_name}` : ""}</StatusPill> : <StatusPill tone="warning">Not done</StatusPill>}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <NumBox label="Weight" unit="kg" value={val("preop_weight_kg")} disabled={!editable} onChange={(v) => set("preop_weight_kg", v)} step="0.01" />
              <NumBox label="Temp" unit="°C" value={val("preop_temperature_c")} disabled={!editable} onChange={(v) => set("preop_temperature_c", v)} step="0.1" />
              <NumBox label="Heart rate" unit="/min" value={val("preop_heart_rate")} disabled={!editable} onChange={(v) => set("preop_heart_rate", v)} />
              <NumBox label="Resp. rate" unit="/min" value={val("preop_resp_rate")} disabled={!editable} onChange={(v) => set("preop_resp_rate", v)} />
              <label className="grid gap-1 rounded-xl bg-surface p-2.5 ring-1 ring-border">
                <span className="text-xs font-medium text-muted-foreground">ASA risk grade</span>
                <select disabled={!editable} value={val("asa_class")} onChange={(e) => set("asa_class", e.target.value)} className="bg-transparent text-lg font-semibold outline-none">
                  <option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>ASA {n}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {[{ v: true, l: "Fasted ✓" }, { v: false, l: "NOT fasted" }].map((o) => (
                <button key={o.l} type="button" disabled={!editable} onClick={() => set("fasting_confirmed", o.v)}
                  className={cn("h-10 rounded-xl px-4 text-sm font-semibold ring-1", f.fasting_confirmed === o.v
                    ? (o.v ? "bg-success-soft text-success ring-success/40" : "bg-danger-soft text-danger ring-danger/40") : "bg-card ring-border")}>{o.l}</button>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {checklist.map((item) => (
                <Label key={item} className="rounded-xl bg-surface px-3 py-2.5 font-normal ring-1 ring-border">
                  <Checkbox checked={!!checks[item]} disabled={!editable} onCheckedChange={(v) => toggleCheck(item, v === true)} /> {item}
                </Label>
              ))}
            </div>
            <FormField label="Pre-op notes" className="mt-4">
              <Textarea rows={2} disabled={!editable} value={val("preop_notes")} onChange={(e) => set("preop_notes", e.target.value)} />
            </FormField>
            {editable && !s.preop_checked_at && (
              <RunButton className="mt-4" label="Mark pre-op check complete" icon={<CircleCheck />}
                fn={async () => { await flush(); return completePreop(s.id); }} />
            )}
          </Section>

          {/* 3. Theatre */}
          <Section n={3} title="Anaesthesia & operation"
            right={s.procedure_start ? <span className="text-sm text-muted-foreground"><Clock className="mr-1 inline size-4" />{formatTime(s.procedure_start)}{s.procedure_end ? ` – ${formatTime(s.procedure_end)}` : " – ongoing"}</span> : null}>
            <FormField label="Anaesthesia & drugs (written by the vet — doses are not calculated by the system)">
              <Textarea rows={3} disabled={!editable} value={val("anaesthesia_protocol")} onChange={(e) => set("anaesthesia_protocol", e.target.value)}
                placeholder="Premed, induction, maintenance, analgesia…" />
            </FormField>
            {(perms.manage || perms.assist) && !closed && <MonitoringForm surgeryId={s.id} />}
            <EventLog events={s.events.filter((e) => ["monitoring", "drug", "complication", "note"].includes(e.kind))} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FormField label="Operation notes"><Textarea rows={3} disabled={!editable} value={val("intra_op_notes")} onChange={(e) => set("intra_op_notes", e.target.value)} /></FormField>
              <FormField label="Complications"><Textarea rows={3} disabled={!editable} value={val("complications")} onChange={(e) => set("complications", e.target.value)} placeholder="None" /></FormField>
            </div>
          </Section>

          {/* 4. Materials */}
          <Section n={4} title="Materials used" right={<Package className="size-4 text-muted-foreground" />}>
            <Consumables surgeryId={s.id} items={s.consumables} canEdit={(perms.manage || perms.assist) && !closed} />
          </Section>

          {/* 5. Recovery & discharge */}
          <Section n={5} title="Recovery & going home">
            <div className="grid gap-4">
              <FormField label="Recovery notes"><Textarea rows={2} disabled={!editable} value={val("recovery_notes")} onChange={(e) => set("recovery_notes", e.target.value)} placeholder="Woke up at…, standing, drinking…" /></FormField>
              <FormField label="Instructions for the owner at home (printed)" required={s.status === "recovery"}>
                <Textarea rows={3} disabled={!editable} value={val("discharge_instructions")} onChange={(e) => set("discharge_instructions", e.target.value)}
                  placeholder="Cone for 10 days, no bath, medicines as prescribed, come back if bleeding…" />
              </FormField>
              <FormField label="Post-op check date" hint="Creates a follow-up reminder">
                <Input type="date" className="w-48" min={todayPK()} disabled={!editable} value={val("follow_up_date")} onChange={(e) => set("follow_up_date", e.target.value)} />
              </FormField>
              <div className="flex flex-wrap gap-2">
                {s.admission_id
                  ? <Button asChild variant="outline"><Link href={`/ward/${s.admission_id}`}><BedDouble /> Open ward stay</Link></Button>
                  : admitSlot}
                {s.status === "discharged" && (
                  <Button asChild variant="outline"><Link href={`/print/discharge/surgery/${s.id}`} target="_blank"><Printer /> Print discharge sheet</Link></Button>
                )}
              </div>
            </div>
          </Section>
        </div>

        {/* Side column: consent + readiness + timeline */}
        <div className="grid min-w-0 content-start gap-6">
          <Section title="Owner consent">
            {consent ? (
              <div className="grid gap-2 text-sm">
                <StatusPill tone="success" className="w-fit"><CircleCheck className="mr-1 size-3" /> Consent recorded</StatusPill>
                <p><b>{consent.signed_by_name}</b>{consent.relationship ? ` (${consent.relationship})` : ""} — {METHOD[consent.method]}</p>
                <p className="text-muted-foreground">{formatDateTime(consent.signed_at)}{consent.witness ? ` · witnessed by ${consent.witness}` : ""}</p>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm"><Link href={`/print/consent/${s.id}`} target="_blank"><Printer /> Print</Link></Button>
                  {perms.consent && !closed && s.status !== "in_surgery" && <RevokeConsent surgeryId={s.id} consentId={consent.id} />}
                </div>
              </div>
            ) : (
              <div className="grid gap-3 text-sm">
                <p className="text-muted-foreground">No consent yet. Needed before the operation (except life-saving emergencies).</p>
                {perms.consent && !closed && (
                  <ConsentDialog surgeryId={s.id} procedure={s.procedure_name} estimate={(f.estimate_amount as number) ?? null}
                    ownerName={s.owner.name} ownerPhone={s.owner.phone} text={consentText} draft={consentText.status === "draft"} />
                )}
              </div>
            )}
            {s.consents.filter((c) => c.revoked_at).map((c) => (
              <p key={c.id} className="mt-2 text-xs text-muted-foreground line-through">{c.signed_by_name} · withdrawn: {c.revoked_reason}</p>
            ))}
          </Section>

          {f.estimate_amount != null && f.estimate_amount !== "" && (
            <Section title="Estimate"><p className="text-2xl font-bold tabular">{formatPKR(f.estimate_amount as number)}</p>
              {val("estimate_notes") && <p className="text-sm text-muted-foreground">{val("estimate_notes")}</p>}</Section>
          )}

          <Section title="History">
            <ul className="grid gap-2 text-sm">
              {s.events.filter((e) => e.kind === "status" || e.kind === "override").map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground tabular">{formatTime(e.at)}</span>
                  <span>{e.kind === "override" ? <b className="text-danger">Emergency override</b>
                    : <>→ {SURGERY_LABEL[(e.data.to as SurgeryStatus) ?? "planned"]}</>}{e.by ? <span className="text-muted-foreground"> · {e.by}</span> : null}
                    {e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <StageBar s={s} perms={perms} hasConsent={!!consent} flush={flush} instructions={val("discharge_instructions")} scheduled={!!f.scheduled_at} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------ pieces

function toLocalInput(iso: string) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso)).replace(" ", "T");
}

function Section({ n, title, right, children }: { n?: number; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
      <header className="mb-4 flex items-center gap-3">
        {n && <span className="flex size-7 items-center justify-center rounded-lg bg-brand-soft text-sm font-bold text-brand">{n}</span>}
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="ml-auto">{right}</span>
      </header>
      {children}
    </section>
  );
}

function Banner({ tone, children }: { tone: "danger" | "info" | "neutral"; children: React.ReactNode }) {
  return <p className={cn("flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ring-1",
    tone === "danger" ? "bg-danger-soft text-danger ring-danger/20" : tone === "info" ? "bg-info-soft text-info ring-info/20" : "bg-muted ring-border")}>{children}</p>;
}

function NumBox({ label, unit, value, onChange, disabled, step }: { label: string; unit: string; value: string; onChange: (v: string) => void; disabled: boolean; step?: string }) {
  return (
    <label className="grid gap-1 rounded-xl bg-surface p-2.5 ring-1 ring-border">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1">
        <input type="number" inputMode="decimal" step={step ?? "1"} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent text-lg font-semibold tabular outline-none" />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
}

function RunButton({ label, icon, fn, variant, className, disabled }: {
  label: string; icon?: React.ReactNode; fn: () => Promise<FormState>; variant?: "default" | "outline" | "ghost" | "destructive"; className?: string; disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Button size="lg" variant={variant} className={className} disabled={pending || disabled}
      onClick={() => start(async () => { const r = await fn(); if (!r.ok) toast.error(r.message); else if (r.message) toast.success(r.message); })}>
      {pending ? <Loader2 className="animate-spin" /> : icon} {label}
    </Button>
  );
}

function TeamEditor({ surgeryId, team, staff }: { surgeryId: string; team: { staff_id: string; role: string }[]; staff: DoctorOption[] }) {
  const roles = [{ key: "assistant", label: "Assistant" }, { key: "anaesthesia", label: "Anaesthesia" }, { key: "nurse", label: "Nurse / intern" }];
  const [members, setMembers] = useState(team.filter((m) => m.role !== "surgeon"));
  const [pending, start] = useTransition();
  const surgeon = team.filter((m) => m.role === "surgeon");
  return (
    <div className="mt-4 grid gap-2 border-t pt-4">
      <p className="text-sm font-semibold">Team</p>
      {members.map((m, i) => (
        <div key={i} className="flex gap-2">
          <Select value={m.role} onValueChange={(v) => setMembers(members.map((x, j) => (j === i ? { ...x, role: v } : x)))}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{roles.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={m.staff_id} onValueChange={(v) => setMembers(members.map((x, j) => (j === i ? { ...x, staff_id: v } : x)))}>
            <SelectTrigger className="flex-1"><SelectValue placeholder="Who" /></SelectTrigger>
            <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={() => setMembers(members.filter((_, j) => j !== i))} aria-label="Remove"><X /></Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setMembers([...members, { staff_id: "", role: "assistant" }])}><Plus /> Add person</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
          const r = await setTeam(surgeryId, [...surgeon, ...members]);
          if (r.ok) toast.success(r.message); else toast.error(r.message);
        })}>{pending && <Loader2 className="animate-spin" />} Save team</Button>
      </div>
    </div>
  );
}

function MonitoringForm({ surgeryId }: { surgeryId: string }) {
  const [kind, setKind] = useState<"monitoring" | "drug" | "complication" | "note">("monitoring");
  const [d, setD] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const fields = kind === "monitoring"
    ? [["hr", "HR"], ["rr", "RR"], ["spo2", "SpO₂ %"], ["temp", "Temp °C"], ["bp", "BP"]]
    : kind === "drug" ? [["name", "Drug"], ["dose", "Dose (as given)"], ["route", "Route"]] : [];
  return (
    <div className="mt-4 grid gap-3 rounded-xl bg-surface p-3 ring-1 ring-border">
      <div className="flex flex-wrap gap-1.5">
        {([["monitoring", "Vitals check", Activity], ["drug", "Drug given", Syringe], ["complication", "Complication", CircleAlert], ["note", "Note", Plus]] as const).map(([k, l, I]) => (
          <button key={k} type="button" onClick={() => { setKind(k); setD({}); }}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1", kind === k ? "bg-ink text-white ring-ink" : "bg-card ring-border")}>
            <I className="size-4" /> {l}
          </button>
        ))}
      </div>
      {fields.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {fields.map(([k, l]) => <Input key={k} placeholder={l} value={d[k] ?? ""} onChange={(e) => setD({ ...d, [k]: e.target.value })} />)}
        </div>
      )}
      <div className="flex gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "complication" ? "What happened and what was done" : "Note (optional)"} />
        <Button disabled={pending} onClick={() => start(async () => {
          const r = await addSurgeryEvent(surgeryId, kind, d, note);
          if (r.ok) { setD({}); setNote(""); } else toast.error(r.message);
        })}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Add</Button>
      </div>
      <p className="text-xs text-muted-foreground">Time is stamped automatically. Entries can&apos;t be edited — add a correction note if needed.</p>
    </div>
  );
}

function EventLog({ events }: { events: SurgeryData["events"] }) {
  if (!events.length) return null;
  return (
    <ol className="mt-4 grid gap-1.5 text-sm">
      {events.map((e) => (
        <li key={e.id} className={cn("flex flex-wrap gap-x-3 rounded-lg px-3 py-1.5", e.kind === "complication" ? "bg-danger-soft text-danger" : "bg-surface")}>
          <span className="w-14 font-semibold tabular">{formatTime(e.at)}</span>
          <span className="font-medium">{e.kind === "monitoring" ? "Vitals" : e.kind === "drug" ? "Drug" : e.kind === "complication" ? "Complication" : "Note"}</span>
          <span>{Object.entries(e.data).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(" · ")}</span>
          {e.note && <span className="text-muted-foreground">{e.note}</span>}
          {e.by && <span className="ml-auto text-xs text-muted-foreground">{e.by}</span>}
        </li>
      ))}
    </ol>
  );
}

function Consumables({ surgeryId, items, canEdit }: { surgeryId: string; items: SurgeryData["consumables"]; canEdit: boolean }) {
  const [item, setItem] = useState({ item_name: "", quantity: "1", unit: "", batch_no: "" });
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      {items.length > 0 && (
        <ul className="divide-y rounded-xl ring-1 ring-border">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 font-medium">{c.item_name}</span>
              <span className="tabular">{Number(c.quantity)} {c.unit}</span>
              {c.batch_no && <span className="font-mono text-xs text-muted-foreground">{c.batch_no}</span>}
              {canEdit && <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => start(async () => { const r = await removeConsumable(surgeryId, c.id); if (!r.ok) toast.error(r.message); })}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="grid gap-2 sm:grid-cols-[2fr_80px_100px_1fr_auto]">
          <Input placeholder="Item (suture, gauze, gloves…)" value={item.item_name} onChange={(e) => setItem({ ...item, item_name: e.target.value })} list="consumable-list" />
          <datalist id="consumable-list">{["Suture — absorbable", "Suture — non-absorbable", "Surgical blade", "Gauze swabs", "Sterile gloves", "IV cannula", "IV fluid bag", "Endotracheal tube", "Drape", "Bandage"].map((x) => <option key={x} value={x} />)}</datalist>
          <Input type="number" min={0.01} step="any" value={item.quantity} onChange={(e) => setItem({ ...item, quantity: e.target.value })} />
          <Input placeholder="Unit" value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} />
          <Input placeholder="Batch (optional)" value={item.batch_no} onChange={(e) => setItem({ ...item, batch_no: e.target.value })} />
          <Button variant="outline" disabled={pending || !item.item_name.trim()} onClick={() => start(async () => {
            const r = await addConsumable(surgeryId, { ...item, quantity: Number(item.quantity) });
            if (r.ok) setItem({ item_name: "", quantity: "1", unit: "", batch_no: "" }); else toast.error(r.message);
          })}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Add</Button>
        </div>
      )}
      {!items.length && !canEdit && <p className="text-sm text-muted-foreground">Nothing recorded.</p>}
    </div>
  );
}

function RevokeConsent({ surgeryId, consentId }: { surgeryId: string; consentId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="sm"><Undo2 /> Withdraw</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Owner withdrew consent?</DialogTitle><DialogDescription>The surgery can&apos;t start until consent is recorded again.</DialogDescription></DialogHeader>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
        <DialogFooter><Button variant="destructive" disabled={reason.trim().length < 3 || pending} onClick={() => start(async () => {
          const r = await revokeConsent(surgeryId, consentId, reason);
          if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.message);
        })}>Withdraw consent</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Sticky bar with the single next step — and exactly what's blocking it. */
function StageBar({ s, perms, hasConsent, flush, instructions, scheduled }: {
  s: SurgeryData; perms: Perms; hasConsent: boolean; flush: () => Promise<boolean>; instructions: string; scheduled: boolean;
}) {
  const [override, setOverride] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const move = (to: Parameters<typeof moveSurgery>[1], extra?: { emergency_override_reason?: string }) => async () => {
    if (!(await flush())) return { message: "Save failed — try again." } as FormState;
    return moveSurgery(s.id, to, extra);
  };

  if (!perms.manage && !(s.status === "discharged" && perms.reopen)) return null;

  const ready = hasConsent && !!s.preop_checked_at;
  let main: React.ReactNode = null;
  if (s.status === "planned") main = (
    <div className="flex flex-wrap gap-2">
      <RunButton variant="outline" label="Mark as scheduled" fn={move("scheduled")} disabled={!scheduled} />
      <RunButton label="Pet is here — admit now" icon={<ArrowRight />} fn={move("admitted")} />
    </div>
  );
  if (s.status === "scheduled") main = <RunButton label="Pet arrived — admit" icon={<ArrowRight />} fn={move("admitted")} />;
  if (s.status === "admitted") main = <RunButton label="Start pre-op" icon={<ArrowRight />} fn={move("pre_op")} />;
  if (s.status === "pre_op") {
    main = ready || s.urgency !== "emergency"
      ? <RunButton label="Start surgery" icon={<ArrowRight />} fn={move("in_surgery")} disabled={!ready} />
      : (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input className="min-w-60 flex-1" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Emergency: why can't consent / pre-op wait?" />
          <RunButton variant="destructive" label="Start emergency surgery" icon={<Siren />} disabled={override.trim().length < 5}
            fn={move("in_surgery", { emergency_override_reason: override })} />
        </div>
      );
  }
  if (s.status === "in_surgery") main = <RunButton label="Operation finished — recovery" icon={<ArrowRight />} fn={move("recovery")} />;
  if (s.status === "recovery") main = (
    <div className="flex flex-wrap gap-2">
      <RunButton variant="ghost" label="Back to theatre" icon={<RotateCcw />} fn={move("in_surgery")} />
      <RunButton label="Discharge — going home" icon={<Check />} fn={move("discharged")} disabled={!instructions.trim()} />
    </div>
  );

  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t bg-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
      {s.status === "pre_op" && (
        <div className="mr-auto flex flex-wrap gap-2 text-sm">
          <Gate ok={hasConsent} label="Owner consent" />
          <Gate ok={!!s.preop_checked_at} label="Pre-op check" />
        </div>
      )}
      {s.status === "recovery" && !instructions.trim() && <span className="mr-auto text-sm text-warning">Write the home instructions to discharge.</span>}
      {s.status === "discharged" && perms.reopen && (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input className="min-w-60 flex-1" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Reason to reopen (senior doctor)" />
          <RunButton variant="outline" label="Reopen record" icon={<Unlock />} disabled={reopenReason.trim().length < 5} fn={() => reopenSurgery(s.id, reopenReason)} />
        </div>
      )}
      {["planned", "scheduled", "admitted", "pre_op"].includes(s.status) && perms.manage && (
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogTrigger asChild><Button variant="ghost" className="ml-auto">Cancel surgery</Button></DialogTrigger>
          <DialogContent className="rounded-2xl">
            <DialogHeader><DialogTitle>Cancel this surgery?</DialogTitle><DialogDescription>It stays in the history with your reason.</DialogDescription></DialogHeader>
            <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason" />
            <DialogFooter><RunButton variant="destructive" label="Cancel surgery" disabled={cancelReason.trim().length < 3}
              fn={async () => { const r = await cancelSurgery(s.id, cancelReason); if (r.ok) setCancelOpen(false); return r; }} /></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {main}
      {s.status === "pre_op" && !ready && s.urgency !== "emergency" && (
        <span className="flex w-full items-center gap-1.5 text-xs text-muted-foreground"><ShieldAlert className="size-3.5" /> Surgery can start once consent is recorded and the pre-op check is complete.</span>
      )}
    </div>
  );
}

function Gate({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold", ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
      {ok ? <CircleCheck className="size-4" /> : <X className="size-4" />} {label}
    </span>
  );
}
