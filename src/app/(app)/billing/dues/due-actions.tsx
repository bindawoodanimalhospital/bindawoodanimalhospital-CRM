"use client";

import { useRef, useState, useTransition } from "react";
import { CalendarClock, Check, Loader2, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatPKR, todayPK } from "@/lib/format";
import type { FormState } from "@/lib/validation";
import { recordPayment } from "../actions";
import { changePromise, decideDue, writeOff } from "./actions";

type Method = { key: string; label: string; needs_reference: boolean };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function DueActions({ due, methods, canTake, canManage }: {
  due: { id: string; invoice_id: string; customer_id: string; balance: number; approval_status: string };
  methods: Method[]; canTake: boolean; canManage: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {canTake && <Pay due={due} methods={methods} />}
      <PromiseDialog dueId={due.id} />
      {canManage && due.approval_status === "pending" && (
        <>
          <Decide dueId={due.id} approve />
          <Decide dueId={due.id} approve={false} />
        </>
      )}
      {canManage && <WriteOff dueId={due.id} balance={due.balance} />}
    </div>
  );
}

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>, after?: () => void) => start(async () => {
    const r = await fn(); if (r.ok) { toast.success(r.message); after?.(); } else toast.error(r.message);
  });
  return { pending, run };
}

function Pay({ due, methods }: { due: { invoice_id: string; customer_id: string; balance: number }; methods: Method[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(due.balance));
  const [method, setMethod] = useState("cash");
  const [ref, setRef] = useState("");
  const k = useRef(newKey());
  const { pending, run } = useRun();
  const m = methods.find((x) => x.key === method);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Wallet /> Payment</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Receive payment</DialogTitle><DialogDescription>Partial payments are fine — the rest stays on the list.</DialogDescription></DialogHeader>
        <Input className="h-12 text-right text-xl font-bold tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        <Select value={method} onValueChange={setMethod}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{methods.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent></Select>
        {m?.needs_reference && <Input placeholder={`${m.label} transaction ID`} value={ref} onChange={(e) => setRef(e.target.value)} />}
        <DialogFooter><Button disabled={pending || !(Number(amount) > 0) || (m?.needs_reference && !ref.trim())} onClick={() => run(
          () => recordPayment({ customer_id: due.customer_id, amount: Number(amount), method, reference: ref, invoice_id: due.invoice_id, key: k.current }),
          () => { setOpen(false); k.current = newKey(); })}>{pending && <Loader2 className="animate-spin" />} Save {formatPKR(Number(amount) || 0)}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromiseDialog({ dueId }: { dueId: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><CalendarClock /> New date</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>New promised date</DialogTitle><DialogDescription>The old date and your note are kept. Missed promises are counted.</DialogDescription></DialogHeader>
        <Input type="date" min={todayPK()} value={date} onChange={(e) => setDate(e.target.value)} />
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did the customer say?" />
        <DialogFooter><Button disabled={pending || !date || note.trim().length < 3} onClick={() => run(() => changePromise(dueId, date, note), () => setOpen(false))}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Decide({ dueId, approve }: { dueId: string; approve: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant={approve ? "outline" : "ghost"} disabled={pending} onClick={() => {
      const note = approve ? "" : window.prompt("Why not approved?") ?? "";
      if (!approve && !note) return;
      run(() => decideDue(dueId, approve, note));
    }}>{approve ? <><Check /> Approve</> : <><X /> Not approved</>}</Button>
  );
}

function WriteOff({ dueId, balance }: { dueId: string; balance: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const k = useRef(newKey());
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost" className="text-muted-foreground">Write off</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Write off {formatPKR(balance)}?</DialogTitle><DialogDescription>The bill is closed without payment. Recorded under your name in the history log.</DialogDescription></DialogHeader>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />
        <DialogFooter><Button variant="destructive" disabled={pending || reason.trim().length < 5} onClick={() => run(() => writeOff(dueId, reason, k.current), () => setOpen(false))}>Write off</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
