"use client";

import { useState, useTransition } from "react";
import { Check, Droplets, Loader2, Pill, Plus, Soup, Stethoscope, Activity, X, Ban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { treatmentSlots, type TreatmentSlot } from "@/lib/clinic";
import { formatDateTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addOrder, recordDose, stopOrder, type OrderInput } from "../actions";

export type Order = {
  id: string; kind: string; description: string; dose: string | null; route: string | null; every_hours: number | null;
  starts_at: string; ends_at: string | null; instructions: string | null; status: string; stop_reason: string | null; ordered_by: string | null;
};
export type Dose = { order_id: string; due_at: string | null; result: "given" | "skipped" | "refused"; given_at: string; by: string | null; note: string | null };

const KIND_ICON = { medication: Pill, fluids: Droplets, feeding: Soup, procedure: Stethoscope, monitoring: Activity } as const;
const KIND_LABEL = { medication: "Medicine", fluids: "Fluids", feeding: "Feeding", procedure: "Procedure", monitoring: "Check" } as const;

export function TreatmentChart({ admissionId, orders, doses, canOrder, canGive, open }: {
  admissionId: string; orders: Order[]; doses: Dose[]; canOrder: boolean; canGive: boolean; open: boolean;
}) {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600_000);
  const to = new Date(now.getTime() + 12 * 3600_000);
  const active = orders.filter((o) => o.status === "active");
  const stopped = orders.filter((o) => o.status !== "active");

  return (
    <div className="grid gap-4">
      {active.length === 0 && <p className="text-muted-foreground">No active treatments.</p>}
      {active.map((o) => {
        const mine = doses.filter((d) => d.order_id === o.id);
        const done = new Map(mine.filter((d) => d.due_at).map((d) => [new Date(d.due_at!).toISOString(), d.result]));
        const slots = treatmentSlots({ ...o, every_hours: o.every_hours ? Number(o.every_hours) : null }, done, from, to, now);
        const Icon = KIND_ICON[o.kind as keyof typeof KIND_ICON] ?? Pill;
        return (
          <article key={o.id} className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
            <header className="flex flex-wrap items-start gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{o.description}{o.dose && <span className="font-normal"> — {o.dose}</span>}{o.route && <span className="text-muted-foreground"> · {o.route}</span>}</p>
                <p className="text-sm text-muted-foreground">
                  {KIND_LABEL[o.kind as keyof typeof KIND_LABEL]} · {o.every_hours ? `every ${Number(o.every_hours)} h` : "once / when needed"}
                  {o.ends_at ? ` · until ${formatDateTime(o.ends_at)}` : ""}{o.ordered_by ? ` · ordered by ${o.ordered_by}` : ""}
                </p>
                {o.instructions && <p className="text-sm">{o.instructions}</p>}
              </div>
              {canOrder && open && <StopOrder admissionId={admissionId} orderId={o.id} />}
            </header>

            {o.every_hours ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {slots.map((s) => (
                  <SlotChip key={s.due_at} slot={s} dose={mine.find((d) => d.due_at && new Date(d.due_at).toISOString() === s.due_at)}
                    canGive={canGive && open} admissionId={admissionId} orderId={o.id} />
                ))}
              </div>
            ) : (
              canGive && open && <div className="mt-3"><GiveButtons admissionId={admissionId} orderId={o.id} dueAt={null} /></div>
            )}
            {!o.every_hours && mine.length > 0 && (
              <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
                {mine.map((d, i) => <li key={i}>{d.result === "given" ? "Given" : d.result === "refused" ? "Refused" : "Not given"} {formatDateTime(d.given_at)}{d.by ? ` · ${d.by}` : ""}{d.note ? ` — ${d.note}` : ""}</li>)}
              </ul>
            )}
          </article>
        );
      })}

      {canOrder && open && <NewOrder admissionId={admissionId} />}

      {stopped.length > 0 && (
        <details className="rounded-2xl bg-surface p-4 ring-1 ring-border">
          <summary className="cursor-pointer text-sm font-semibold">Stopped treatments ({stopped.length})</summary>
          <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
            {stopped.map((o) => <li key={o.id}><span className="line-through">{o.description} {o.dose}</span> — {o.stop_reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function SlotChip({ slot, dose, canGive, admissionId, orderId }: {
  slot: TreatmentSlot; dose?: Dose; canGive: boolean; admissionId: string; orderId: string;
}) {
  const time = formatTime(slot.due_at);
  if (slot.state === "given" || slot.state === "skipped" || slot.state === "refused") {
    return (
      <span title={dose ? `${dose.by ?? ""} ${formatTime(dose.given_at)}${dose.note ? ` — ${dose.note}` : ""}` : undefined}
        className={cn("inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1",
          slot.state === "given" ? "bg-success-soft text-success ring-success/30" : "bg-muted text-muted-foreground ring-border")}>
        {slot.state === "given" ? <Check className="size-4" /> : <Ban className="size-4" />} {time}
        {dose?.by && <span className="text-xs font-normal opacity-80">{dose.by.split(" ")[0]}</span>}
      </span>
    );
  }
  const cls = slot.state === "overdue" ? "bg-danger-soft text-danger ring-danger/40" : slot.state === "due" ? "bg-warning-soft text-warning ring-warning/40" : "bg-card text-muted-foreground ring-border";
  if (!canGive || slot.state === "upcoming") {
    return <span className={cn("inline-flex h-10 items-center rounded-xl px-3 text-sm font-semibold ring-1", cls)}>{time}{slot.state === "overdue" ? " · late" : ""}</span>;
  }
  return <GiveButtons admissionId={admissionId} orderId={orderId} dueAt={slot.due_at} label={`${time}${slot.state === "overdue" ? " · late" : ""}`} className={cls} />;
}

function GiveButtons({ admissionId, orderId, dueAt, label, className }: {
  admissionId: string; orderId: string; dueAt: string | null; label?: string; className?: string;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<"skipped" | "refused">("skipped");
  const [note, setNote] = useState("");
  const give = () => start(async () => { const r = await recordDose(admissionId, orderId, dueAt, "given", ""); if (!r.ok) toast.error(r.message); else toast.success(r.message); });
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-xl p-1 ring-1", className ?? "bg-card ring-border")}>
      {label && <span className="px-2 text-sm font-semibold">{label}</span>}
      <Button size="sm" disabled={pending} onClick={give}>{pending ? <Loader2 className="animate-spin" /> : <Check />} Given</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button size="sm" variant="ghost" disabled={pending} aria-label="Not given"><X /></Button></DialogTrigger>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>Not given{label ? ` (${label})` : ""}</DialogTitle><DialogDescription>Say why — the doctor will see it.</DialogDescription></DialogHeader>
          <Select value={result} onValueChange={(v) => setResult(v as typeof result)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="skipped">Skipped / held</SelectItem><SelectItem value="refused">Pet refused / vomited it</SelectItem></SelectContent>
          </Select>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" />
          <DialogFooter>
            <Button disabled={note.trim().length < 3 || pending} onClick={() => start(async () => {
              const r = await recordDose(admissionId, orderId, dueAt, result, note);
              if (r.ok) { setOpen(false); setNote(""); } else toast.error(r.message);
            })}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}

function StopOrder({ admissionId, orderId }: { admissionId: string; orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="sm">Stop</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Stop this treatment?</DialogTitle><DialogDescription>To change a dose, stop it and add a new one — the history stays clear.</DialogDescription></DialogHeader>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Course complete, changed to oral" />
        <DialogFooter><Button variant="destructive" disabled={reason.trim().length < 3 || pending} onClick={() => start(async () => {
          const r = await stopOrder(admissionId, orderId, reason);
          if (r.ok) { setOpen(false); toast.success(r.message); } else toast.error(r.message);
        })}>Stop treatment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewOrder({ admissionId }: { admissionId: string }) {
  const empty: OrderInput = { kind: "medication", description: "", dose: "", route: "", every_hours: "", start_time: "", days: "", instructions: "" };
  const [o, setO] = useState<OrderInput>(empty);
  const [pending, start] = useTransition();
  const set = (p: Partial<OrderInput>) => setO((x) => ({ ...x, ...p }));
  return (
    <section className="grid gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border">
      <p className="flex items-center gap-2 font-semibold"><Plus className="size-4" /> Add to treatment chart</p>
      <div className="grid gap-3 sm:grid-cols-[160px_2fr_1fr_1fr]">
        <Select value={o.kind} onValueChange={(v) => set({ kind: v as OrderInput["kind"] })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={o.description} onChange={(e) => set({ description: e.target.value })} placeholder="What (e.g. Ceftriaxone, Ringer's lactate, wound cleaning)" />
        <Input value={o.dose ?? ""} onChange={(e) => set({ dose: e.target.value })} placeholder={o.kind === "medication" ? "Dose* (written by you)" : "Amount"} />
        <Input value={o.route ?? ""} onChange={(e) => set({ route: e.target.value })} placeholder="Route (IV, SC, oral)" />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <FormField label="Every (hours)" hint="Empty = once / when needed">
          <Input type="number" min={0.5} step={0.5} value={String(o.every_hours ?? "")} onChange={(e) => set({ every_hours: e.target.value })} list="every-h" />
          <datalist id="every-h">{[4, 6, 8, 12, 24].map((h) => <option key={h} value={h} />)}</datalist>
        </FormField>
        <FormField label="First dose at" hint="Today; empty = now"><Input type="time" step={300} value={o.start_time ?? ""} onChange={(e) => set({ start_time: e.target.value })} /></FormField>
        <FormField label="For how many days"><Input type="number" min={1} value={String(o.days ?? "")} onChange={(e) => set({ days: e.target.value })} /></FormField>
        <FormField label="Instructions"><Input value={o.instructions ?? ""} onChange={(e) => set({ instructions: e.target.value })} placeholder="e.g. slowly over 5 min" /></FormField>
      </div>
      <div className="flex justify-end">
        <Button disabled={pending || !o.description.trim()} onClick={() => start(async () => {
          const r = await addOrder(admissionId, { ...o, start_time: o.start_time || undefined });
          if (r.ok) { toast.success(r.message); setO(empty); } else toast.error(r.message);
        })}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Add</Button>
      </div>
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <StatusPill tone={status === "admitted" ? "brand" : status === "discharged" ? "success" : "neutral"}>{status === "admitted" ? "In ward" : status === "discharged" ? "Discharged" : "Cancelled"}</StatusPill>;
}
