"use client";

import { useState, useTransition } from "react";
import { Loader2, LogOut, MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { SaveIndicator } from "@/components/app/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { ADMISSION_OUTCOMES } from "@/lib/clinic";
import { formatDateTime, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { KennelOption } from "../admit-dialog";
import { addNote, dischargeAdmission, moveKennel, savePlan } from "../actions";

export type Note = { id: string; kind: string; note: string | null; vitals: Record<string, string>; created_at: string; by: string | null };

const NOTE_KINDS = [
  { key: "vitals", label: "Vitals" }, { key: "progress", label: "Progress" }, { key: "feeding", label: "Feeding / toilet" },
  { key: "owner_update", label: "Owner updated" }, { key: "procedure", label: "Procedure" },
] as const;
const VITALS = [["temp", "Temp °C"], ["hr", "HR"], ["rr", "RR"], ["weight", "Weight kg"], ["appetite", "Appetite"], ["urine", "Urine"], ["stool", "Stool"], ["pain", "Pain /10"]];

export function NotesPanel({ admissionId, notes, canWrite }: { admissionId: string; notes: Note[]; canWrite: boolean }) {
  const [kind, setKind] = useState<(typeof NOTE_KINDS)[number]["key"]>("vitals");
  const [text, setText] = useState("");
  const [v, setV] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-4">
      {canWrite && (
        <div className="grid gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border">
          <div className="flex flex-wrap gap-1.5">
            {NOTE_KINDS.map((k) => (
              <button key={k.key} type="button" onClick={() => setKind(k.key)}
                className={cn("h-9 rounded-xl px-3 text-sm font-semibold ring-1", kind === k.key ? "bg-ink text-white ring-ink" : "bg-card ring-border")}>{k.label}</button>
            ))}
          </div>
          {kind === "vitals" && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {VITALS.map(([k, l]) => <Input key={k} placeholder={l} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} />)}
            </div>
          )}
          <div className="flex gap-2">
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={kind === "owner_update" ? "What you told the owner and what they said" : "Note"} />
            <Button className="self-end" disabled={pending} onClick={() => start(async () => {
              const r = await addNote(admissionId, kind, text, kind === "vitals" ? v : {});
              if (r.ok) { setText(""); setV({}); } else toast.error(r.message);
            })}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Add</Button>
          </div>
          <p className="text-xs text-muted-foreground">Entries are time-stamped and can&apos;t be edited — add a new note to correct.</p>
        </div>
      )}
      <ol className="grid gap-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-xl bg-card p-3 ring-1 ring-border">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <b className="text-foreground">{NOTE_KINDS.find((k) => k.key === n.kind)?.label}</b>
              <span>{formatDateTime(n.created_at)}</span>{n.by && <span>· {n.by}</span>}
            </div>
            {Object.keys(n.vitals ?? {}).length > 0 && (
              <p className="mt-1 text-sm font-medium tabular">
                {VITALS.filter(([k]) => n.vitals[k]).map(([k, l]) => `${l.split(" ")[0]} ${n.vitals[k]}`).join(" · ")}
              </p>
            )}
            {n.note && <p className="mt-1 text-sm whitespace-pre-wrap">{n.note}</p>}
          </li>
        ))}
        {notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
      </ol>
    </div>
  );
}

export function PlanPanel({ id, plan, canEdit }: { id: string; plan: { feeding_plan: string; care_notes: string; expected_discharge_on: string }; canEdit: boolean }) {
  const [p, setP] = useState(plan);
  const { state, queue } = useAutosave<typeof plan>((patch) => savePlan(id, patch));
  const set = (k: keyof typeof plan, v: string) => { setP({ ...p, [k]: v }); queue({ [k]: v }); };
  return (
    <div className="grid gap-3">
      <div className="flex justify-end"><SaveIndicator state={state} /></div>
      <FormField label="Feeding plan"><Textarea rows={2} disabled={!canEdit} value={p.feeding_plan} onChange={(e) => set("feeding_plan", e.target.value)} /></FormField>
      <FormField label="Care / handling notes"><Textarea rows={2} disabled={!canEdit} value={p.care_notes} onChange={(e) => set("care_notes", e.target.value)} /></FormField>
      <FormField label="Expected to go home"><Input type="date" className="w-48" disabled={!canEdit} value={p.expected_discharge_on} onChange={(e) => set("expected_discharge_on", e.target.value)} /></FormField>
    </div>
  );
}

export function KennelPicker({ id, current, kennels, canMove }: { id: string; current: string | null; kennels: KennelOption[]; canMove: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Select value={current ?? "none"} disabled={!canMove || pending} onValueChange={(v) => start(async () => {
      const r = await moveKennel(id, v === "none" ? null : v);
      if (r.ok) toast.success(r.message); else toast.error(r.message);
    })}>
      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No kennel</SelectItem>
        {kennels.filter((k) => !k.occupied || k.id === current).map((k) => <SelectItem key={k.id} value={k.id}>{k.name} · {k.ward}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function DischargeDialog({ id, petName }: { id: string; petName: string }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("discharged_home");
  const [summary, setSummary] = useState("");
  const [instructions, setInstructions] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="lg"><LogOut /> Discharge</Button></DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader><DialogTitle>Discharge {petName}</DialogTitle><DialogDescription>Open treatments stop automatically. The summary is printed for the owner.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <FormField label="Outcome">
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{ADMISSION_OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label="Summary of the stay" required><Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Why admitted, treatment given, how the pet is now" /></FormField>
          {outcome !== "deceased" && (
            <>
              <FormField label="Home-care instructions" required={outcome === "discharged_home"}><Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Medicines, food, rest, when to come back" /></FormField>
              <FormField label="Check-up date"><Input type="date" className="w-48" min={todayPK()} value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></FormField>
            </>
          )}
        </div>
        <DialogFooter>
          <Button disabled={pending || summary.trim().length < 5} onClick={() => start(async () => {
            const r = await dischargeAdmission(id, { outcome: outcome as "discharged_home", discharge_summary: summary, discharge_instructions: instructions, follow_up_date: followUp });
            if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.message);
          })}>{pending && <Loader2 className="animate-spin" />} Discharge</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OwnerUpdateHint({ phone, wa }: { phone: string; wa: string | null }) {
  return (
    <div className="flex gap-2">
      <Button asChild variant="outline" size="sm"><a href={`tel:${phone}`}><MessageSquare /> Call owner</a></Button>
      {wa && <Button asChild variant="outline" size="sm"><a href={wa} target="_blank" rel="noreferrer">WhatsApp update</a></Button>}
    </div>
  );
}
