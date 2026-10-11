"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, Loader2, Minus, Plus, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusPill } from "@/components/app/page-header";
import { formatDate } from "@/lib/format";
import type { FormState } from "@/lib/validation";
import { approveProtocol, removeLastStep, saveProtocol, saveStep, setProtocolActive } from "./actions";

type Step = { step_no: number; label: string; vaccine_id: string; min_age_weeks: number | null; days_after_previous: number | null };
export type Protocol = {
  id: string; name: string; description: string | null; species_id: string | null; species_name: string | null;
  booster_interval_days: number | null; is_approved: boolean; approved_by_name: string | null; approved_at: string | null;
  is_active: boolean; steps: Step[];
};

export function ProtocolCard({ p, vaccines, canEdit }: { p: Protocol; vaccines: { id: string; name: string }[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [booster, setBooster] = useState(p.booster_interval_days?.toString() ?? "");
  const run = (fn: () => Promise<FormState>) => start(async () => { const r = await fn(); if (r.ok) toast.success(r.message); else toast.error(r.message); });

  return (
    <article className="grid gap-4 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">{p.name}</h3>
          <p className="text-sm text-muted-foreground">{[p.species_name ?? "Any species", p.description].filter(Boolean).join(" · ")}</p>
        </div>
        {!p.is_active && <StatusPill>Off</StatusPill>}
        {p.is_approved ? (
          <StatusPill tone="success"><BadgeCheck className="mr-1 size-3.5" /> Approved{p.approved_by_name ? ` by ${p.approved_by_name}` : ""} · {formatDate(p.approved_at)}</StatusPill>
        ) : (
          <StatusPill tone="warning"><ShieldAlert className="mr-1 size-3.5" /> Draft — not used until approved</StatusPill>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">#</th><th className="pr-2 font-medium">Dose name</th><th className="pr-2 font-medium">Vaccine</th>
              <th className="pr-2 font-medium">Earliest age (weeks)</th><th className="pr-2 font-medium">Days after previous dose</th><th />
            </tr>
          </thead>
          <tbody>
            {p.steps.map((s) => <StepRow key={s.step_no} protocolId={p.id} step={s} vaccines={vaccines} canEdit={canEdit} first={s.step_no === 1} />)}
            {canEdit && <NewStepRow protocolId={p.id} nextNo={(p.steps.at(-1)?.step_no ?? 0) + 1} vaccines={vaccines} />}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t pt-4">
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Repeat booster after the last dose (days)</span>
          <Input className="w-40" type="number" min={1} value={booster} disabled={!canEdit} onChange={(e) => setBooster(e.target.value)} placeholder="e.g. 365" />
        </label>
        {canEdit && booster !== (p.booster_interval_days?.toString() ?? "") && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => saveProtocol(p.id, {
            name: p.name, species_id: p.species_id, booster_interval_days: booster ? Number(booster) : null, description: p.description ?? "",
          }))}><Save /> Save booster</Button>
        )}
        {canEdit && p.steps.length > 0 && (
          <Button variant="ghost" disabled={pending} onClick={() => run(() => removeLastStep(p.id))}><Minus /> Remove last dose</Button>
        )}
        <div className="ml-auto flex gap-2">
          {canEdit && <Button variant="ghost" disabled={pending} onClick={() => run(() => setProtocolActive(p.id, !p.is_active))}>{p.is_active ? "Turn off" : "Turn on"}</Button>}
          {canEdit && !p.is_approved && p.steps.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild><Button disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <BadgeCheck />} Approve schedule</Button></AlertDialogTrigger>
              <AlertDialogContent className="rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Approve “{p.name}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You confirm these vaccines and intervals match the hospital&apos;s protocol. Doctors will see next-dose
                    suggestions from it (they still confirm each date). Your name is recorded on the approval.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Review again</AlertDialogCancel>
                  <AlertDialogAction onClick={() => run(() => approveProtocol(p.id))}>I approve</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </article>
  );
}

function StepFields({ step, vaccines, disabled, first, onChange }: {
  step: Omit<Step, "step_no">; vaccines: { id: string; name: string }[]; disabled: boolean; first: boolean;
  onChange: (s: Omit<Step, "step_no">) => void;
}) {
  return (
    <>
      <td className="py-1.5 pr-2"><Input value={step.label} disabled={disabled} onChange={(e) => onChange({ ...step, label: e.target.value })} className="h-9" /></td>
      <td className="pr-2">
        <Select value={step.vaccine_id} disabled={disabled} onValueChange={(v) => onChange({ ...step, vaccine_id: v })}>
          <SelectTrigger className="h-9 w-full"><SelectValue placeholder="Vaccine" /></SelectTrigger>
          <SelectContent>{vaccines.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="pr-2"><Input type="number" min={0} className="h-9 w-24" disabled={disabled} value={step.min_age_weeks ?? ""}
        onChange={(e) => onChange({ ...step, min_age_weeks: e.target.value ? Number(e.target.value) : null })} /></td>
      <td className="pr-2">{first
        ? <span className="text-xs text-muted-foreground">First dose</span>
        : <Input type="number" min={1} className="h-9 w-24" disabled={disabled} value={step.days_after_previous ?? ""} placeholder="by age"
            onChange={(e) => onChange({ ...step, days_after_previous: e.target.value ? Number(e.target.value) : null })} />}
      </td>
    </>
  );
}

function StepRow({ protocolId, step, vaccines, canEdit, first }: {
  protocolId: string; step: Step; vaccines: { id: string; name: string }[]; canEdit: boolean; first: boolean;
}) {
  const [s, setS] = useState(step);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(s) !== JSON.stringify(step);
  return (
    <tr className="border-t">
      <td className="pr-2 font-mono text-xs text-muted-foreground">{step.step_no}</td>
      <StepFields step={s} vaccines={vaccines} disabled={!canEdit} first={first} onChange={(x) => setS({ ...x, step_no: step.step_no })} />
      <td className="text-right">{canEdit && dirty && (
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const r = await saveStep(protocolId, step.step_no, { ...s, days_after_previous: first ? null : s.days_after_previous });
          if (r.ok) toast.success(r.message); else toast.error(r.message);
        })}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
      )}</td>
    </tr>
  );
}

function NewStepRow({ protocolId, nextNo, vaccines }: { protocolId: string; nextNo: number; vaccines: { id: string; name: string }[] }) {
  const blank = { label: `Dose ${nextNo}`, vaccine_id: "", min_age_weeks: null, days_after_previous: null };
  const [s, setS] = useState<Omit<Step, "step_no">>(blank);
  const [pending, start] = useTransition();
  return (
    <tr className="border-t bg-surface">
      <td className="pr-2 font-mono text-xs text-muted-foreground">{nextNo}</td>
      <StepFields step={s} vaccines={vaccines} disabled={false} first={nextNo === 1} onChange={setS} />
      <td className="text-right">
        <Button size="sm" variant="outline" disabled={pending || !s.vaccine_id} onClick={() => start(async () => {
          const r = await saveStep(protocolId, nextNo, { ...s, days_after_previous: nextNo === 1 ? null : s.days_after_previous });
          if (r.ok) { toast.success(r.message); setS({ ...blank, label: `Dose ${nextNo + 1}` }); } else toast.error(r.message);
        })}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Add dose</Button>
      </td>
    </tr>
  );
}
