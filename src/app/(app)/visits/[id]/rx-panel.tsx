"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { FileText, Loader2, Lock, Pill, Plus, Printer, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/format";
import { addRxItem, createPrescription, removeRxItem, searchMedicines, setRxStatus, type RxItemInput } from "./actions";

export type RxItem = {
  id: string; medicine_name: string; strength: string | null; form: string | null; dose: string; frequency: string;
  duration: string | null; route: string | null; quantity: string | null; instructions: string | null;
};
export type Rx = {
  id: string; code: string; status: "draft" | "issued" | "cancelled"; notes: string | null;
  issued_at: string | null; cancel_reason: string | null; doctor_name: string | null; items: RxItem[];
};

const FREQUENCIES = ["Once a day", "Twice a day", "Three times a day", "Every 8 hours", "Every 12 hours", "At night", "When needed"];

export function RxPanel({ visitId, petId, consultationId, prescriptions, canWrite }: {
  visitId: string; petId: string; consultationId: string | null; prescriptions: Rx[]; canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const draft = prescriptions.find((p) => p.status === "draft");
  const others = prescriptions.filter((p) => p !== draft);

  return (
    <div className="grid gap-8">
      {draft ? <DraftRx visitId={visitId} rx={draft} canWrite={canWrite} /> : canWrite && (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-surface p-6 ring-1 ring-border">
          <p className="text-muted-foreground">No prescription being written for this visit.</p>
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await createPrescription(visitId, petId, consultationId);
            if (!r.ok) toast.error(r.message);
          })}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Write a prescription</Button>
        </div>
      )}
      {others.map((rx) => <IssuedRx key={rx.id} visitId={visitId} rx={rx} canWrite={canWrite} />)}
    </div>
  );
}

function RxItems({ items, onRemove }: { items: RxItem[]; onRemove?: (id: string) => void }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">No medicines added yet.</p>;
  return (
    <ol className="grid gap-2">
      {items.map((it, i) => (
        <li key={it.id} className="flex items-start gap-3 rounded-xl bg-card p-3 ring-1 ring-border">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-sm font-bold text-brand">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{it.medicine_name}{it.strength ? ` ${it.strength}` : ""}{it.form ? <span className="font-normal text-muted-foreground"> · {it.form}</span> : null}</p>
            <p className="text-sm">
              <b>{it.dose}</b> · {it.frequency}{it.duration ? ` · for ${it.duration}` : ""}{it.route ? ` · ${it.route}` : ""}
              {it.quantity ? <span className="text-muted-foreground"> · Qty {it.quantity}</span> : null}
            </p>
            {it.instructions && <p className="text-sm text-muted-foreground">{it.instructions}</p>}
          </div>
          {onRemove && (
            <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => onRemove(it.id)}><Trash2 /></Button>
          )}
        </li>
      ))}
    </ol>
  );
}

function DraftRx({ visitId, rx, canWrite }: { visitId: string; rx: Rx; canWrite: boolean }) {
  const [notes, setNotes] = useState(rx.notes ?? "");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: boolean; message?: string }>) =>
    start(async () => { const r = await fn(); if (!r.ok) toast.error(r.message); else if (r.message) toast.success(r.message); });

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-semibold">Prescription</h3>
        <StatusPill tone="warning">Draft</StatusPill>
        <span className="font-mono text-xs text-muted-foreground">{rx.code}</span>
      </div>
      <RxItems items={rx.items} onRemove={canWrite ? (id) => run(() => removeRxItem(visitId, id)) : undefined} />
      {canWrite && <AddItemForm visitId={visitId} rxId={rx.id} />}
      <FormField label="Advice for the owner (printed)">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Give with food. Come back if vomiting continues." />
      </FormField>
      {canWrite && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => run(() => setRxStatus(visitId, rx.id, "cancelled", "Discarded draft"))}>
            <X /> Discard
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="lg" disabled={pending || rx.items.length === 0}><Lock /> Issue prescription</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Issue this prescription?</AlertDialogTitle>
                <AlertDialogDescription>
                  Please check each medicine, dose and duration. Once issued it&apos;s locked and ready to print; to change
                  it you&apos;ll cancel it and write a new one.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Check again</AlertDialogCancel>
                <AlertDialogAction onClick={() => run(() => setRxStatus(visitId, rx.id, "issued", undefined, notes))}>Issue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </section>
  );
}

type Med = { id: string; name: string; generic_name: string | null; form: string | null; strength: string | null; default_route: string | null; default_instructions: string | null };

function AddItemForm({ visitId, rxId }: { visitId: string; rxId: string }) {
  const empty: RxItemInput = { medicine_name: "", dose: "", frequency: "", save_to_catalog: true };
  const [item, setItem] = useState<RxItemInput>(empty);
  const [results, setResults] = useState<Med[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    const q = item.medicine_name;
    if (item.medicine_id || q.trim().length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => { const r = await searchMedicines(q); if (id === seq.current) setResults(r); }, 250);
    return () => clearTimeout(t);
  }, [item.medicine_name, item.medicine_id]);

  const set = (patch: Partial<RxItemInput>) => setItem((i) => ({ ...i, ...patch }));
  const pick = (m: Med) => {
    set({ medicine_id: m.id, medicine_name: m.name, strength: m.strength, form: m.form, route: m.default_route,
      instructions: m.default_instructions ?? item.instructions });
    setShowResults(false);
  };

  const add = () => start(async () => {
    const r = await addRxItem(visitId, rxId, item);
    if (r.ok) { setItem(empty); setResults([]); } else toast.error(r.message);
  });

  return (
    <div className="grid gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border">
      <p className="flex items-center gap-2 text-sm font-semibold"><Pill className="size-4" /> Add medicine</p>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="relative">
          <Input value={item.medicine_name} placeholder="Medicine name"
            onFocus={() => setShowResults(true)} onBlur={() => setTimeout(() => setShowResults(false), 150)}
            onChange={(e) => { set({ medicine_name: e.target.value, medicine_id: null }); setShowResults(true); }} />
          {showResults && results.length > 0 && !item.medicine_id && (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl bg-popover p-1 shadow-float ring-1 ring-border">
              {results.map((m) => (
                <li key={m.id}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                    <b>{m.name}</b> {m.strength} <span className="text-muted-foreground">{[m.form, m.generic_name].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Input value={item.strength ?? ""} onChange={(e) => set({ strength: e.target.value })} placeholder="Strength (250 mg)" />
        <Input value={item.form ?? ""} onChange={(e) => set({ form: e.target.value })} placeholder="Form (tablet, syrup)" list="rx-forms" />
        <datalist id="rx-forms">{["Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Drops", "Ointment", "Spray", "Powder"].map((f) => <option key={f} value={f} />)}</datalist>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Input value={item.dose} onChange={(e) => set({ dose: e.target.value })} placeholder="Dose* (1 tablet, 2 ml)" />
        <Input value={item.frequency} onChange={(e) => set({ frequency: e.target.value })} placeholder="How often*" list="rx-freq" />
        <datalist id="rx-freq">{FREQUENCIES.map((f) => <option key={f} value={f} />)}</datalist>
        <Input value={item.duration ?? ""} onChange={(e) => set({ duration: e.target.value })} placeholder="For how long (5 days)" />
        <Input value={item.quantity ?? ""} onChange={(e) => set({ quantity: e.target.value })} placeholder="Quantity (10)" />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Input value={item.route ?? ""} onChange={(e) => set({ route: e.target.value })} placeholder="Route (oral, SC, topical)" />
        <Input value={item.instructions ?? ""} onChange={(e) => set({ instructions: e.target.value })} placeholder="Instructions (after food, shake well…)" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!item.medicine_id ? (
          <Label className="font-normal">
            <Checkbox checked={item.save_to_catalog} onCheckedChange={(v) => set({ save_to_catalog: v === true })} />
            Remember this medicine for next time
          </Label>
        ) : <span />}
        <Button variant="outline" disabled={pending || !item.medicine_name.trim() || !item.dose.trim() || !item.frequency.trim()} onClick={add}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add to prescription
        </Button>
      </div>
    </div>
  );
}

function IssuedRx({ visitId, rx, canWrite }: { visitId: string; rx: Rx; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const cancelled = rx.status === "cancelled";
  return (
    <section className={cancelled ? "grid gap-3 opacity-60" : "grid gap-3"}>
      <div className="flex flex-wrap items-center gap-3">
        <FileText className="size-5 text-brand" />
        <h3 className="font-semibold">{rx.code}</h3>
        <StatusPill tone={cancelled ? "neutral" : "success"}>{cancelled ? `Cancelled: ${rx.cancel_reason}` : "Issued"}</StatusPill>
        <span className="text-sm text-muted-foreground">{rx.doctor_name} · {formatDateTime(rx.issued_at)}</span>
        {!cancelled && (
          <div className="ml-auto flex gap-2">
            <Button asChild variant="outline" size="sm"><Link href={`/print/prescription/${rx.id}`} target="_blank"><Printer /> Print</Link></Button>
            {canWrite && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => {
                const reason = window.prompt("Why cancel this prescription?");
                if (!reason) return;
                start(async () => { const r = await setRxStatus(visitId, rx.id, "cancelled", reason); if (r.ok) toast.success(r.message); else toast.error(r.message); });
              }}>Cancel</Button>
            )}
          </div>
        )}
      </div>
      <RxItems items={rx.items} />
      {rx.notes && <p className="text-sm"><span className="text-muted-foreground">Advice:</span> {rx.notes}</p>}
    </section>
  );
}
