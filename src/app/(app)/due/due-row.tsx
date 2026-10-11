"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Check, Loader2, MessageCircle, Phone, PhoneCall, Stethoscope, Syringe, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/app/page-header";
import { formatDate, todayPK } from "@/lib/format";
import { formatPhone, whatsappLink } from "@/lib/phone";
import type { FormState } from "@/lib/validation";
import { closeDue, markContacted, rescheduleDue } from "./actions";

export type DueEntry = {
  id: string; kind: string; title: string; due_on: string; outcome: string | null; previous_due_on: string | null;
  pet: { id: string; name: string }; owner: { full_name: string; phone: string; whatsapp: string | null } | null;
};

type Mode = null | "contacted" | "reschedule" | "skip";

export function DueRow({ d, canWork, clinicName }: { d: DueEntry; canWork: boolean; clinicName: string }) {
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [pending, start] = useTransition();
  const today = todayPK();
  const overdue = d.due_on < today;
  const Icon = d.kind === "vaccination" ? Syringe : Stethoscope;

  const message = d.kind === "vaccination"
    ? `Assalam o Alaikum ${d.owner?.full_name ?? ""}, ${d.pet.name}'s ${d.title} is due on ${formatDate(d.due_on)}. Please reply to book a time. — ${clinicName}`
    : `Assalam o Alaikum ${d.owner?.full_name ?? ""}, ${d.pet.name} is due for a follow-up (${d.title}) on ${formatDate(d.due_on)}. Please reply to book a time. — ${clinicName}`;
  const wa = whatsappLink(d.owner?.whatsapp, message);

  const run = (fn: () => Promise<FormState>) => start(async () => {
    const r = await fn();
    if (r.ok) { toast.success(r.message); setMode(null); setNote(""); setDate(""); } else toast.error(r.message);
  });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          <Link href={`/pets/${d.pet.id}`} className="hover:underline">{d.pet.name}</Link>
          <span className="font-normal text-muted-foreground"> · {d.title}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {d.owner ? `${d.owner.full_name} · ${formatPhone(d.owner.phone)}` : "No owner on file"}
          {d.previous_due_on && ` · moved from ${formatDate(d.previous_due_on)}`}
        </p>
        {d.outcome && <p className="mt-1 text-xs text-info">{d.outcome}</p>}
      </div>
      <StatusPill tone={overdue ? "danger" : d.due_on === today ? "warning" : "neutral"}>
        {overdue ? `Overdue · ${formatDate(d.due_on)}` : d.due_on === today ? "Due today" : formatDate(d.due_on)}
      </StatusPill>
      {canWork && (
        <div className="flex flex-wrap gap-2">
          {d.owner && <Button asChild variant="outline" size="icon" aria-label="Call"><a href={`tel:${d.owner.phone}`}><Phone /></a></Button>}
          {wa && <Button asChild variant="outline" size="icon" aria-label="WhatsApp"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /></a></Button>}
          <Button variant="outline" onClick={() => setMode("contacted")}><PhoneCall /> Contacted</Button>
          <Button variant="ghost" onClick={() => setMode("reschedule")}><CalendarClock /> New date</Button>
          <Button variant="ghost" onClick={() => setMode("skip")}><X /> Not needed</Button>
        </div>
      )}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {mode === "contacted" && "What did the owner say?"}
              {mode === "reschedule" && "Move to a new date"}
              {mode === "skip" && "Close without a visit"}
            </DialogTitle>
            <DialogDescription>
              {mode === "contacted" && "This stays on the list until the pet actually comes in."}
              {mode === "reschedule" && "The old date and your reason are kept."}
              {mode === "skip" && "E.g. vaccinated elsewhere, pet passed away, owner declined."}
            </DialogDescription>
          </DialogHeader>
          {mode === "reschedule" && <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />}
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "contacted" ? "e.g. Will come on Saturday evening" : "Reason (required)"} />
          <DialogFooter>
            {mode === "contacted" && <Button disabled={pending} onClick={() => run(() => markContacted(d.id, note))}>{pending ? <Loader2 className="animate-spin" /> : <Check />} Save</Button>}
            {mode === "reschedule" && <Button disabled={pending || !date || note.trim().length < 3} onClick={() => run(() => rescheduleDue(d.id, date, note))}>Save new date</Button>}
            {mode === "skip" && <Button variant="destructive" disabled={pending || note.trim().length < 3} onClick={() => run(() => closeDue(d.id, "skipped", "not needed", note))}>Close item</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
