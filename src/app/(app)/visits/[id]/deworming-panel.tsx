"use client";

import { useState, useTransition } from "react";
import { Bug, Check, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { ReminderPlan, type RulePlan } from "@/components/app/reminder-plan";
import { addDaysPK, formatDate, formatDateTime, todayPK } from "@/lib/format";
import { recordDeworming, voidDeworming } from "./actions";
import { cn } from "@/lib/utils";

export type DewormingRow = {
  id: string; product: string; dose: string | null; given_at: string; next_due_date: string | null; given_by: string | null; voided_at: string | null; void_reason: string | null;
  visit_id?: string | null;
};

/** yyyy-mm-dd + n days. */
const plusDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};

/**
 * Common guidance (puppies/kittens): every 2 weeks until 12 weeks old, monthly until 6 months, then every
 * 3 months. Only a suggestion — the doctor sets the date.
 */
function suggestDays(dob: string | null): { days: number; why: string } {
  if (!dob) return { days: 90, why: "every 3 months for adults (age unknown)" };
  const weeks = (Date.now() - new Date(dob).getTime()) / (7 * 86400000);
  if (weeks < 12) return { days: 14, why: "every 2 weeks until 12 weeks old" };
  if (weeks < 26) return { days: 30, why: "monthly until 6 months old" };
  return { days: 90, why: "every 3 months for adults" };
}

/**
 * On a visit: record the dewormer given now (billed with the visit), or one given earlier.
 * On the pet page (no visit): add earlier dewormings — e.g. from before the CRM — so the schedule continues.
 */
export function DewormingPanel({ visitId, petId, dob, weight, history, products, plan, canRecord }: {
  visitId: string | null; petId: string; dob: string | null; weight: number | null; history: DewormingRow[];
  products: string[]; plan: RulePlan; canRecord: boolean;
}) {
  const s = suggestDays(dob);
  const [when, setWhen] = useState<"now" | "earlier">(visitId ? "now" : "earlier");
  const [givenOn, setGivenOn] = useState("");
  const base = when === "earlier" && givenOn ? givenOn : todayPK();
  const [product, setProduct] = useState("");
  const [dose, setDose] = useState("");
  const [kg, setKg] = useState(weight ? String(weight) : "");
  const [next, setNext] = useState(visitId ? addDaysPK(s.days) : "");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await recordDeworming({ visit_id: visitId, pet_id: petId, product, dose, weight_kg: Number(kg) || null, next_due_date: next || undefined, notes,
      given_on: when === "earlier" ? givenOn : undefined });
    if (r.ok) { toast.success(r.message); setProduct(""); setDose(""); setNotes(""); if (when === "earlier") { setGivenOn(""); setNext(""); } } else toast.error(r.message);
  });

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Bug className="size-4" /> Deworming</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {canRecord && (
          <div className="grid gap-3 sm:grid-cols-2">
            {visitId && (
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:col-span-2" role="radiogroup" aria-label="When was it given">
                {([["now", "Given now (this visit)"], ["earlier", "Given earlier"]] as const).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={when === v} onClick={() => { setWhen(v); if (v === "now") setNext(addDaysPK(s.days)); }}
                    className={cn("h-9 rounded-lg text-sm font-semibold transition", when === v ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>{l}</button>
                ))}
              </div>
            )}
            {when === "earlier" && (
              <FormField label="Given on" required hint="Before the CRM, or at another clinic. Not billed.">
                <Input type="date" max={todayPK()} value={givenOn} onChange={(e) => { setGivenOn(e.target.value); if (e.target.value) setNext(plusDays(e.target.value, s.days)); }} />
              </FormField>
            )}
            <FormField label="Dewormer given" required>
              <Input value={product} onChange={(e) => setProduct(e.target.value)} list="dewormers" placeholder="e.g. Drontal Plus, Prazivet" />
              <datalist id="dewormers">{products.map((p) => <option key={p} value={p} />)}</datalist>
            </FormField>
            <FormField label="Dose"><Input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 1 tablet" /></FormField>
            <FormField label="Weight (kg)" hint="For the dose"><Input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^\d.]/g, ""))} /></FormField>
            <FormField label="Next deworming due" hint={`Suggested: ${s.why}. Clear it for no reminder.`}>
              <Input type="date" min={when === "earlier" ? (givenOn ? plusDays(givenOn, 1) : undefined) : addDaysPK(1)} value={next} onChange={(e) => setNext(e.target.value)} />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[[14, "2 weeks"], [30, "1 month"], [90, "3 months"]].map(([d, l]) => (
                  <button key={l} type="button" onClick={() => setNext(plusDays(base, d as number))}
                    className="rounded-lg bg-muted px-2 py-1 text-xs font-medium hover:bg-brand-soft hover:text-brand">{l}</button>
                ))}
              </div>
            </FormField>
            <FormField label="Note" className="sm:col-span-2"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
            {next && next > todayPK() && <ReminderPlan due={next} plan={plan} what="the next deworming" className="sm:col-span-2" />}
            <div className="sm:col-span-2">
              <Button disabled={pending || product.trim().length < 2 || (when === "earlier" && !givenOn)} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <Check />} {when === "earlier" ? "Add earlier deworming" : "Record deworming"}</Button>
            </div>
          </div>
        )}
        <div>
          <p className="mb-2 text-sm font-semibold">History</p>
          {!history.length ? <p className="text-sm text-muted-foreground">No deworming recorded yet.</p> : (
            <ul className="grid gap-2">
              {history.map((h) => (
                <li key={h.id} className={`flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border ${h.voided_at ? "opacity-60" : ""}`}>
                  <b className={h.voided_at ? "line-through" : ""}>{h.product}</b>
                  {h.dose && <span className="text-muted-foreground">{h.dose}</span>}
                  <span className="text-xs text-muted-foreground">{h.visit_id === null ? `${formatDate(h.given_at)} · earlier` : formatDateTime(h.given_at)}</span>
                  {h.voided_at ? <StatusPill tone="neutral">Mistake: {h.void_reason}</StatusPill>
                    : h.next_due_date && <StatusPill tone="info">Next: {formatDate(h.next_due_date)}</StatusPill>}
                  {canRecord && !h.voided_at && <VoidButton visitId={visitId} petId={petId} id={h.id} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function VoidButton({ visitId, petId, id }: { visitId: string | null; petId: string; id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" disabled={pending} onClick={() => {
      const reason = window.prompt("Why was this entered by mistake?");
      if (!reason) return;
      start(async () => { const r = await voidDeworming(visitId, id, reason, petId); if (r.ok) toast.success(r.message); else toast.error(r.message); });
    }}><Undo2 /> Entered by mistake</Button>
  );
}
