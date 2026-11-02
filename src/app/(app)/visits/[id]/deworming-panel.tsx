"use client";

import { useState, useTransition } from "react";
import { Bug, Check, CircleHelp, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { ReminderPlan, type RulePlan } from "@/components/app/reminder-plan";
import { addDaysPK, formatDate, formatDateTime, todayPK } from "@/lib/format";
import { TRACKS, trackLabel } from "@/lib/treatments";
import { confirmTreatment, recordDeworming, treatmentNotGiven, voidDeworming } from "./actions";
import { cn } from "@/lib/utils";

export type DewormingRow = {
  id: string; product: string; dose: string | null; given_at: string; next_due_date: string | null; given_by: string | null; voided_at: string | null; void_reason: string | null;
  visit_id?: string | null; confirmed?: boolean; tracks?: string[];
};
export type DewormerOption = { id: string; name: string; tracks: string[]; covers: string[]; dose_text: string | null; adult_interval_days: number };

/** yyyy-mm-dd + n days. */
const plusDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};

/**
 * ESCCAP-style guidance: every 2 weeks until 12 weeks old, monthly until 6 months, then the product's adult
 * interval (clinic default: every 3 months). Only a suggestion — the doctor sets the date.
 */
function suggestDays(dob: string | null, adult: number): { days: number; why: string } {
  const adultWhy = adult === 90 ? "every 3 months for adults" : `every ${adult} days for adults (this product)`;
  if (!dob) return { days: adult, why: `${adultWhy} (age unknown)` };
  const weeks = (Date.now() - new Date(dob).getTime()) / (7 * 86400000);
  if (weeks < 12) return { days: 14, why: "every 2 weeks until 12 weeks old" };
  if (weeks < 26) return { days: 30, why: "monthly until 6 months old" };
  return { days: adult, why: adultWhy };
}

/**
 * On a visit: record the dewormer given now, or one given earlier. On the pet page (no visit): add earlier
 * dewormings (before the CRM / elsewhere) so the schedule continues. Records made from a bill wait for the
 * doctor to confirm what was actually given.
 */
export function DewormingPanel({ visitId, petId, dob, weight, history, dewormers, plan, canRecord, className }: {
  visitId: string | null; petId: string; dob: string | null; weight: number | null; history: DewormingRow[];
  dewormers: DewormerOption[]; plan: RulePlan; canRecord: boolean; className?: string;
}) {
  const [when, setWhen] = useState<"now" | "earlier">(visitId ? "now" : "earlier");
  const [givenOn, setGivenOn] = useState("");
  const [dewormerId, setDewormerId] = useState("");
  const [other, setOther] = useState("");
  const [otherTracks, setOtherTracks] = useState<string[]>(["internal"]);
  const [dose, setDose] = useState("");
  const [kg, setKg] = useState(weight ? String(weight) : "");
  const chosen = dewormers.find((d) => d.id === dewormerId) ?? null;
  const s = suggestDays(dob, chosen?.adult_interval_days ?? 90);
  const base = when === "earlier" && givenOn ? givenOn : todayPK();
  const [next, setNext] = useState(visitId ? addDaysPK(suggestDays(dob, 90).days) : "");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  const pick = (id: string) => {
    setDewormerId(id);
    const d = dewormers.find((x) => x.id === id);
    if (d) setNext(plusDays(when === "earlier" && givenOn ? givenOn : todayPK(), suggestDays(dob, d.adult_interval_days).days));
  };
  const productName = chosen?.name ?? other.trim();
  const save = () => start(async () => {
    const r = await recordDeworming({
      visit_id: visitId, pet_id: petId, product: productName, dewormer_id: chosen?.id ?? null, tracks: chosen ? undefined : otherTracks,
      dose, weight_kg: Number(kg) || null, next_due_date: next || undefined, notes, given_on: when === "earlier" ? givenOn : undefined,
    });
    if (r.ok) {
      toast.success(r.message); setDewormerId(""); setOther(""); setDose(""); setNotes("");
      if (when === "earlier") { setGivenOn(""); setNext(""); }
    } else toast.error(r.message);
  });
  const correct = (h: DewormingRow) => {
    setWhen("earlier"); setGivenOn(new Date(h.given_at).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" })); setDewormerId(""); setOther("");
    document.getElementById(`deworm-form-${petId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const toConfirm = history.filter((h) => h.confirmed === false && !h.voided_at);

  return (
    <Card className={className}>
      <CardHeader><CardTitle className="flex items-center gap-2"><Bug className="size-4" /> Deworming &amp; flea / tick</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {toConfirm.length > 0 && (
          <div className="grid gap-2 rounded-2xl bg-warning-soft p-3 ring-1 ring-warning/30">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning"><CircleHelp className="size-4" /> From a bill — confirm what was given</p>
            {toConfirm.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
                <b>{h.product}</b><span className="text-muted-foreground">{formatDate(h.given_at)}</span>
                {canRecord && <ConfirmButtons kind="deworming" id={h.id} petId={petId} visitId={visitId} onCorrect={() => correct(h)} />}
              </div>
            ))}
          </div>
        )}
        {canRecord && (
          <div id={`deworm-form-${petId}`} className="grid gap-3 sm:grid-cols-2">
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
            <FormField label="Dewormer given" required className="sm:col-span-2">
              <select value={dewormerId || (other !== "" ? "other" : "")} onChange={(e) => { if (e.target.value === "other") { setDewormerId(""); setOther(" "); } else { setOther(""); pick(e.target.value); } }}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm">
                <option value="">Choose…</option>
                {dewormers.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.tracks.map(trackLabel).join(" + ")}</option>)}
                <option value="other">Other (not on the list)…</option>
              </select>
              {chosen && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {[chosen.covers.length ? `Covers ${chosen.covers.join(", ")}` : null, chosen.dose_text ? `Dose: ${chosen.dose_text}` : null].filter(Boolean).join(" · ") || "No details set — the doctor can add them in Settings."}
                </span>
              )}
            </FormField>
            {!chosen && other !== "" && (
              <>
                <FormField label="Name of the product"><Input autoFocus value={other.trim() === "" ? "" : other} onChange={(e) => setOther(e.target.value || " ")} placeholder="e.g. Caniverm" /></FormField>
                <FormField label="Type">
                  <div className="flex flex-wrap gap-3 pt-2">
                    {TRACKS.map((t) => (
                      <label key={t.code} className="flex items-center gap-1.5 text-sm">
                        <input type="checkbox" checked={otherTracks.includes(t.code)}
                          onChange={() => setOtherTracks((x) => x.includes(t.code) ? x.filter((y) => y !== t.code) : [...x, t.code])} /> {t.label}
                      </label>
                    ))}
                  </div>
                </FormField>
              </>
            )}
            <FormField label="Dose"><Input value={dose} onChange={(e) => setDose(e.target.value)} placeholder={chosen?.dose_text ?? "e.g. 1 tablet"} /></FormField>
            <FormField label="Weight (kg)" hint="For the dose"><Input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^\d.]/g, ""))} /></FormField>
            <FormField label="Next due" hint={`Suggested: ${s.why}. Clear it for no reminder.`} className="sm:col-span-2">
              <Input type="date" min={when === "earlier" ? (givenOn ? plusDays(givenOn, 1) : undefined) : addDaysPK(1)} value={next} onChange={(e) => setNext(e.target.value)} />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[[14, "2 weeks"], [30, "1 month"], [90, "3 months"], [180, "6 months"]].map(([d, l]) => (
                  <button key={l} type="button" onClick={() => setNext(plusDays(base, d as number))}
                    className="rounded-lg bg-muted px-2 py-1 text-xs font-medium hover:bg-brand-soft hover:text-brand">{l}</button>
                ))}
              </div>
            </FormField>
            <FormField label="Note" className="sm:col-span-2"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
            {next && next > todayPK() && <ReminderPlan due={next} plan={plan} what={chosen?.tracks.includes("external") && !chosen.tracks.includes("internal") ? "the next flea / tick treatment" : "the next deworming"} className="sm:col-span-2" />}
            <div className="sm:col-span-2">
              <Button disabled={pending || productName.length < 2 || (!chosen && !otherTracks.length) || (when === "earlier" && !givenOn)} onClick={save}>
                {pending ? <Loader2 className="animate-spin" /> : <Check />} {when === "earlier" ? "Add earlier deworming" : "Record deworming"}
              </Button>
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
                  {h.tracks?.includes("external") && <StatusPill tone="neutral">{(h.tracks ?? []).map(trackLabel).join(" + ")}</StatusPill>}
                  {h.dose && <span className="text-muted-foreground">{h.dose}</span>}
                  <span className="text-xs text-muted-foreground">{h.visit_id === null ? `${formatDate(h.given_at)} · earlier` : formatDateTime(h.given_at)}</span>
                  {h.voided_at ? <StatusPill tone="neutral">{h.void_reason?.startsWith("Not given") ? h.void_reason : `Mistake: ${h.void_reason}`}</StatusPill>
                    : <>
                        {h.confirmed === false && <StatusPill tone="warning">From bill — to confirm</StatusPill>}
                        {h.next_due_date && <StatusPill tone="info">Next: {formatDate(h.next_due_date)}</StatusPill>}
                      </>}
                  {canRecord && !h.voided_at && h.confirmed !== false && <VoidButton visitId={visitId} petId={petId} id={h.id} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Confirm a billed treatment, say it was a different product (then record the right one), or "not given". */
export function ConfirmButtons({ kind, id, petId, visitId, onCorrect }: {
  kind: "deworming" | "vaccination"; id: string; petId: string; visitId: string | null; onCorrect: () => void;
}) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: boolean; message?: string }>, after?: () => void) => start(async () => {
    const r = await fn(); if (r.ok) { toast.success(r.message); after?.(); } else toast.error(r.message);
  });
  return (
    <span className="ml-auto flex flex-wrap gap-1">
      <Button size="sm" disabled={pending} onClick={() => run(() => confirmTreatment(kind, id, petId, visitId))}>
        {pending ? <Loader2 className="animate-spin" /> : <Check />} Confirm
      </Button>
      <Button size="sm" variant="outline" className="bg-card" disabled={pending}
        onClick={() => run(() => treatmentNotGiven(kind, id, "a different product was given", petId, visitId), onCorrect)}>
        Wrong product
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
        const note = window.prompt("Not given — why? (optional)") ?? null;
        if (note === null) return;
        run(() => treatmentNotGiven(kind, id, note, petId, visitId));
      }}><X /> Not given</Button>
    </span>
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
