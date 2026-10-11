"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Info, Loader2, Printer, Syringe, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { addDaysPK as addDays, formatDate, todayPK } from "@/lib/format";
import { recordVaccination, voidVaccination } from "./actions";

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


export function VaccinesPanel({ visitId, petId, vaccines, protocols, history, due, canRecord }: {
  visitId: string; petId: string; vaccines: VaccineOption[]; protocols: ProtocolOption[];
  history: VaccinationRow[]; due: DueRow[]; canRecord: boolean;
}) {
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
    if (next?.days_after_previous) {
      setNextDue(addDays(next.days_after_previous)); setNextLabel(`${next.label} (${p.name})`);
      setSuggested(`${next.label} in ${next.days_after_previous} days, per “${p.name}”`);
    } else if (!next && p.booster_interval_days) {
      setNextDue(addDays(p.booster_interval_days)); setNextLabel(`Booster (${p.name})`);
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
    });
    if (res.ok) {
      toast.success(res.message);
      setVaccineId(""); setBatch(""); setExpiry(""); setDose(""); setSite(""); setNextDue(""); setNextLabel("");
      setSuggested(null); setReaction(""); setProtocolId("none"); setStep("");
    } else toast.error(res.message);
  });

  const expired = expiry && expiry < today;

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

      {canRecord && (
        <section className="grid gap-4">
          <h3 className="text-lg font-semibold">Record a vaccination</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Vaccine" required className="sm:col-span-2 lg:col-span-1">
              <Select value={vaccineId} onValueChange={pickVaccine}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose vaccine" /></SelectTrigger>
                <SelectContent>
                  {vaccines.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}{v.protects_against ? ` — ${v.protects_against}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Brand / manufacturer"><Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="e.g. Nobivac" /></FormField>
            <FormField label="Batch / lot no." required hint="From the vial label"><Input value={batch} onChange={(e) => setBatch(e.target.value)} /></FormField>
            <FormField label="Vial expiry date" required error={expired ? "This batch is expired — do not use it." : undefined}>
              <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-invalid={!!expired} />
            </FormField>
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
              <Input type="date" value={nextDue} min={addDays(1)} onChange={(e) => { setNextDue(e.target.value); setSuggested(null); }} />
            </FormField>
            <FormField label="Next dose name"><Input value={nextLabel} onChange={(e) => setNextLabel(e.target.value)} placeholder="e.g. DHPPi Dose 2" /></FormField>
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
            <Button size="lg" disabled={!vaccineId || !batch || !expiry || !!expired || pending} onClick={submit}>
              {pending ? <Loader2 className="animate-spin" /> : <Syringe />} Save vaccination
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
                <span className="text-sm text-muted-foreground">{formatDate(h.administered_at)}{h.administered_by_name ? ` · ${h.administered_by_name}` : ""}</span>
                {h.batch_no && <span className="font-mono text-xs text-muted-foreground">Batch {h.batch_no}</span>}
                {h.voided_at ? <StatusPill>Entered by mistake: {h.void_reason}</StatusPill>
                  : h.next_due_date && <StatusPill tone="info">Next: {formatDate(h.next_due_date)}</StatusPill>}
                {canRecord && !h.voided_at && h.visit_id === visitId && <VoidButton visitId={visitId} id={h.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function VoidButton({ visitId, id }: { visitId: string; id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" className="ml-auto" disabled={pending}
      onClick={() => {
        const reason = window.prompt("Why was this entered by mistake?");
        if (!reason) return;
        start(async () => { const r = await voidVaccination(visitId, id, reason); if (r.ok) toast.success(r.message); else toast.error(r.message); });
      }}>
      <Undo2 /> Entered by mistake
    </Button>
  );
}
