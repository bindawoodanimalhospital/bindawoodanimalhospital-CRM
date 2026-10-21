"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, History, Info, Loader2, Printer, Receipt, Syringe, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { addDaysPK as addDays, formatDate, todayPK } from "@/lib/format";
import { recordVaccination, voidVaccination } from "./actions";
import { cn } from "@/lib/utils";
import { ReminderPlan, type RulePlan } from "@/components/app/reminder-plan";

export type VaccineOption = { id: string; name: string; protects_against: string | null; default_route: string | null; default_manufacturer: string | null };
export type ProtocolOption = {
  id: string; name: string; booster_interval_days: number | null;
  steps: { step_no: number; label: string; vaccine_id: string; days_after_previous: number | null }[];
};
export type VaccinationRow = {
  id: string; vaccine_name: string; administered_at: string; batch_no: string | null; next_due_date: string | null;
  administered_by_name: string | null; voided_at: string | null; void_reason: string | null; visit_id: string | null;
};
export type DueRow = { id: string; title: string; due_on: string; kind: string };
/** A vaccine on one of the pet's bills that was never written into its history. */
export type BilledVaccine = { key: string; vaccine_id: string; name: string; date: string; bill_no: string };

/** yyyy-mm-dd + n days. */
const plusDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};


/**
 * On a visit: record the vaccine given now (batch / vial expiry recommended, not required) or one given earlier.
 * On the pet page (no visit): add vaccines given before the CRM or elsewhere, and vaccines that were billed
 * but never written into the history — so every pet has its full vaccination record.
 */
export function VaccinesPanel({ visitId, petId, vaccines, protocols, history, due, canRecord, plan, billed = [] }: {
  visitId: string | null; petId: string; vaccines: VaccineOption[]; protocols: ProtocolOption[];
  history: VaccinationRow[]; due: DueRow[]; canRecord: boolean; plan?: RulePlan; billed?: BilledVaccine[];
}) {
  const [when, setWhen] = useState<"now" | "earlier">(visitId ? "now" : "earlier");
  const [givenOn, setGivenOn] = useState("");
  const [vaccineId, setVaccineId] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [route, setRoute] = useState("");
  const [site, setSite] = useState("");
  const [dose, setDose] = useState("");
  const [protocolId, setProtocolId] = useState("none");
  const [step, setStep] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [nextLabel, setNextLabel] = useState("");
  const [suggested, setSuggested] = useState<string | null>(null);
  const [reaction, setReaction] = useState("");
  const [pending, start] = useTransition();

  const protocol = protocols.find((p) => p.id === protocolId);
  const vaccineDue = due.filter((d) => d.kind === "vaccination");
  const today = todayPK();

  const pickVaccine = (id: string) => {
    setVaccineId(id);
    const v = vaccines.find((x) => x.id === id);
    if (v?.default_route && !route) setRoute(v.default_route);
    if (v?.default_manufacturer && !manufacturer) setManufacturer(v.default_manufacturer);
  };

  // Suggest the next dose from an APPROVED protocol; the doctor still confirms or changes it.
  const suggest = (pId: string, stepNo: string) => {
    const p = protocols.find((x) => x.id === pId);
    const s = p?.steps.find((x) => String(x.step_no) === stepNo);
    if (!p || !s) { setSuggested(null); return; }
    if (!vaccineId) pickVaccine(s.vaccine_id);
    const next = p.steps.find((x) => x.step_no === s.step_no + 1);
    const from = when === "earlier" && givenOn ? givenOn : todayPK();
    if (next?.days_after_previous) {
      setNextDue(plusDays(from, next.days_after_previous)); setNextLabel(`${next.label} (${p.name})`);
      setSuggested(`${next.label} in ${next.days_after_previous} days, per “${p.name}”`);
    } else if (!next && p.booster_interval_days) {
      setNextDue(plusDays(from, p.booster_interval_days)); setNextLabel(`Booster (${p.name})`);
      setSuggested(`Booster in ${p.booster_interval_days} days, per “${p.name}”`);
    } else {
      setSuggested(next ? `${next.label} — timing depends on age; set the date yourself` : null);
      if (next) setNextLabel(`${next.label} (${p.name})`);
    }
  };

  const submit = () => start(async () => {
    const res = await recordVaccination({
      visit_id: visitId, pet_id: petId, vaccine_id: vaccineId, manufacturer, batch_no: batch, expiry_date: expiry,
      dose, route, site, protocol_id: protocolId === "none" ? null : protocolId,
      protocol_step: step ? Number(step) : null, next_due_date: nextDue, next_due_label: nextLabel, adverse_reaction: reaction,
      given_on: when === "earlier" ? givenOn : undefined,
    });
    if (res.ok) {
      toast.success(res.message);
      setVaccineId(""); setBatch(""); setExpiry(""); setDose(""); setSite(""); setNextDue(""); setNextLabel("");
      setSuggested(null); setReaction(""); setProtocolId("none"); setStep(""); if (when === "earlier") setGivenOn("");
    } else toast.error(res.message);
  });

  const expired = when === "now" && expiry && expiry < today;
  const fromBill = (b: BilledVaccine) => {
    setWhen("earlier"); setGivenOn(b.date); pickVaccine(b.vaccine_id); setNextDue(""); setNextLabel("");
    document.getElementById(`vaccine-form-${petId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid gap-8">
      {vaccineDue.length > 0 && (
        <div className="rounded-2xl bg-warning-soft p-4 ring-1 ring-warning/30">
          <p className="flex items-center gap-2 font-semibold text-warning"><CalendarClock className="size-4" /> Due for this pet</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {vaccineDue.map((d) => (
              <li key={d.id}>{d.title} — <b>{formatDate(d.due_on)}</b>{d.due_on < today && <span className="ml-2 text-danger">overdue</span>}</li>
            ))}
          </ul>
        </div>
      )}

      {canRecord && billed.length > 0 && (
        <div className="rounded-2xl bg-info-soft p-4 ring-1 ring-info/30">
          <p className="flex items-center gap-2 font-semibold text-info"><Receipt className="size-4" /> Billed but not in the vaccination history</p>
          <p className="mt-1 text-xs text-info">These vaccines are on this pet&apos;s bills but were never recorded. Tap one to add it with the bill date.</p>
          <ul className="mt-2 grid gap-1.5">
            {billed.map((b) => (
              <li key={b.key} className="flex flex-wrap items-center gap-2 text-sm">
                <b>{b.name}</b><span className="text-muted-foreground">{formatDate(b.date)} · bill {b.bill_no}</span>
                <Button size="sm" variant="outline" className="ml-auto bg-card" onClick={() => fromBill(b)}><History /> Add to history</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canRecord && (
        <section id={`vaccine-form-${petId}`} className="grid gap-4">
          <h3 className="text-lg font-semibold">{visitId ? "Record a vaccination" : "Add a vaccine given earlier"}</h3>
          {visitId && (
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:max-w-md" role="radiogroup" aria-label="When was it given">
              {([["now", "Given now (this visit)"], ["earlier", "Given earlier"]] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={when === v} onClick={() => setWhen(v)}
                  className={cn("h-9 rounded-lg text-sm font-semibold transition", when === v ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>{l}</button>
              ))}
            </div>
          )}
          {!visitId && <p className="-mt-2 text-sm text-muted-foreground">Before the CRM or at another clinic — enter the date it was given and the next dose, and reminders continue from there.</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {when === "earlier" && (
              <FormField label="Given on" required>
                <Input type="date" max={today} value={givenOn} onChange={(e) => setGivenOn(e.target.value)} />
              </FormField>
            )}
            <FormField label="Vaccine" required className="sm:col-span-2 lg:col-span-1">
              <Select value={vaccineId} onValueChange={pickVaccine}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose vaccine" /></SelectTrigger>
                <SelectContent>
                  {vaccines.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}{v.protects_against ? ` — ${v.protects_against}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Brand / manufacturer"><Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="e.g. Nobivac" /></FormField>
            {when === "now" && (
              <>
                <FormField label="Batch / lot no." hint="From the vial label — recommended"><Input value={batch} onChange={(e) => setBatch(e.target.value)} /></FormField>
                <FormField label="Vial expiry date" hint="Recommended" error={expired ? "This batch is expired — do not use it." : undefined}>
                  <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-invalid={!!expired} />
                </FormField>
              </>
            )}
            <FormField label="Dose"><Input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 1 ml" /></FormField>
            <FormField label="Route"><Input value={route} onChange={(e) => setRoute(e.target.value)} placeholder="SC / IM / Intranasal" /></FormField>
            <FormField label="Site"><Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="e.g. Right shoulder" /></FormField>
          </div>

          <div className="grid gap-4 rounded-2xl bg-surface p-4 ring-1 ring-border sm:grid-cols-2">
            <FormField label="Part of a schedule? (optional)">
              <Select value={protocolId} onValueChange={(v) => { setProtocolId(v); setStep(""); setSuggested(null); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No schedule</SelectItem>
                  {protocols.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {protocols.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  No approved vaccine schedules yet. A senior doctor can review them in{" "}
                  <Link href="/settings/vaccines" className="underline">Settings → Vaccine schedules</Link>.
                </span>
              )}
            </FormField>
            {protocol && (
              <FormField label="Which dose is this?">
                <Select value={step} onValueChange={(v) => { setStep(v); suggest(protocolId, v); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose dose" /></SelectTrigger>
                  <SelectContent>
                    {protocol.steps.map((s) => <SelectItem key={s.step_no} value={String(s.step_no)}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label="Next dose due" hint="Creates a reminder for reception. Leave empty if none.">
              <Input type="date" value={nextDue} min={when === "earlier" ? (givenOn ? plusDays(givenOn, 1) : undefined) : addDays(1)} onChange={(e) => { setNextDue(e.target.value); setSuggested(null); }} />
            </FormField>
            <FormField label="Next dose name"><Input value={nextLabel} onChange={(e) => setNextLabel(e.target.value)} placeholder="e.g. DHPPi Dose 2" /></FormField>
            {plan && nextDue && nextDue > today && <ReminderPlan due={nextDue} plan={plan} what={nextLabel || "the next dose"} className="sm:col-span-2 lg:col-span-3" />}
            {suggested && (
              <p className="flex items-start gap-2 rounded-xl bg-info-soft p-3 text-sm text-info sm:col-span-2">
                <Info className="mt-0.5 size-4 shrink-0" /> Suggested: {suggested}. Please check the date before saving.
              </p>
            )}
          </div>

          <FormField label="Reaction observed (if any)">
            <Textarea rows={2} value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder="Leave empty if none" />
          </FormField>

          <div className="flex justify-end">
            <Button size="lg" disabled={!vaccineId || !!expired || (when === "earlier" && !givenOn) || pending} onClick={submit}>
              {pending ? <Loader2 className="animate-spin" /> : <Syringe />} {when === "earlier" ? "Add to history" : "Save vaccination"}
            </Button>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h3 className="text-lg font-semibold">Vaccination history</h3>
          {history.some((h) => !h.voided_at) && (
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <Link href={`/print/vaccination-card/${petId}`} target="_blank"><Printer /> Vaccination card</Link>
            </Button>
          )}
        </div>
        {history.length === 0 ? <p className="text-muted-foreground">No vaccinations recorded yet.</p> : (
          <ul className="divide-y rounded-2xl ring-1 ring-border">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className={h.voided_at ? "font-semibold text-muted-foreground line-through" : "font-semibold"}>{h.vaccine_name}</span>
                <span className="text-sm text-muted-foreground">{formatDate(h.administered_at)}{h.visit_id === null ? " · given earlier" : h.administered_by_name ? ` · ${h.administered_by_name}` : ""}</span>
                {h.batch_no && <span className="font-mono text-xs text-muted-foreground">Batch {h.batch_no}</span>}
                {h.voided_at ? <StatusPill>Entered by mistake: {h.void_reason}</StatusPill>
                  : h.next_due_date && <StatusPill tone="info">Next: {formatDate(h.next_due_date)}</StatusPill>}
                {canRecord && !h.voided_at && (h.visit_id === visitId || (!visitId && h.visit_id === null)) && <VoidButton visitId={visitId} petId={petId} id={h.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function VoidButton({ visitId, petId, id }: { visitId: string | null; petId: string; id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" className="ml-auto" disabled={pending}
      onClick={() => {
        const reason = window.prompt("Why was this entered by mistake?");
        if (!reason) return;
        start(async () => { const r = await voidVaccination(visitId, id, reason, petId); if (r.ok) toast.success(r.message); else toast.error(r.message); });
      }}>
      <Undo2 /> Entered by mistake
    </Button>
  );
}
