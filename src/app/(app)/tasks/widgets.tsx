"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Clock, Loader2, MessageSquare, Play, Plus, User, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { formatDateTime, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchCustomers, type CustomerOption } from "../customers/actions";
import { addComment, createTask, setTaskStatus } from "./actions";

const SUGGESTIONS = ["Call owner for post-op follow-up", "Prepare surgery consent", "Collect pending payment", "Reorder vaccine stock",
  "Review lab report", "Call owner — vaccination overdue", "Send photos/update to owner"];

export function NewTaskDialog({ staff, meId, fixed, trigger }: {
  staff: { id: string; full_name: string }[]; meId: string; fixed?: { customer?: CustomerOption; pet_id?: string; title?: string }; trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: fixed?.title ?? "", details: "", assigned_to: meId, priority: "normal", due_date: todayPK(), due_time: "18:00" });
  const [customer, setCustomer] = useState<CustomerOption | null>(fixed?.customer ?? null);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<CustomerOption[]>([]);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (customer || q.trim().length < 2) return;
    const t = setTimeout(async () => setOpts(await searchCustomers(q)), 250);
    return () => clearTimeout(t);
  }, [q, customer]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="lg"><Plus /> New task</Button>}</DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader><DialogTitle>New task</DialogTitle><DialogDescription>Instead of a WhatsApp message or a verbal reminder — it stays on the list until done.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <FormField label="What needs to be done" required>
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} list="task-sugg" autoFocus />
            <datalist id="task-sugg">{SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
          </FormField>
          <FormField label="Details"><Textarea rows={2} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="For">
              <Select value={f.assigned_to} onValueChange={(v) => setF({ ...f, assigned_to: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.id === meId ? `Me (${s.full_name})` : s.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField label="Priority">
              <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent>
              </Select>
            </FormField>
            <FormField label="Due date"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></FormField>
            <FormField label="By"><Input type="time" step={900} value={f.due_time} onChange={(e) => setF({ ...f, due_time: e.target.value })} /></FormField>
          </div>
          <FormField label="About a pet owner (optional)">
            {customer ? (
              <div className="flex items-center gap-2 rounded-xl bg-brand-wash px-3 py-2 ring-1 ring-brand-muted"><User className="size-4 text-brand" />
                <span className="flex-1 text-sm font-semibold">{customer.title}</span>
                {!fixed?.customer && <Button variant="ghost" size="icon-sm" onClick={() => setCustomer(null)} aria-label="Remove"><X /></Button>}</div>
            ) : (
              <div className="relative">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" />
                {opts.length > 0 && q.trim().length >= 2 && (
                  <ul className="absolute z-20 mt-1 w-full rounded-xl bg-popover p-1 shadow-float ring-1 ring-border">
                    {opts.map((o) => <li key={o.id}><button type="button" onClick={() => { setCustomer(o); setQ(""); setOpts([]); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"><b>{o.title}</b> <span className="text-muted-foreground">{o.subtitle}</span></button></li>)}
                  </ul>
                )}
              </div>
            )}
          </FormField>
        </div>
        <DialogFooter><Button disabled={pending || f.title.trim().length < 2} onClick={() => start(async () => {
          const r = await createTask({ ...f, priority: f.priority as "normal", customer_id: customer?.id, pet_id: fixed?.pet_id });
          if (r.ok) { toast.success(r.message); setOpen(false); setF({ ...f, title: "", details: "" }); if (!fixed?.customer) setCustomer(null); } else toast.error(r.message);
        })}>{pending && <Loader2 className="animate-spin" />} Create task</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type TaskRow = {
  id: string; title: string; details: string | null; priority: string; status: string; due_at: string | null; outcome: string | null;
  assigned_name: string | null; created_name: string | null; customer: { id: string; full_name: string } | null; pet: { id: string; name: string } | null;
  comments: { body: string; by: string | null; at: string }[]; overdue: boolean;
};

const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = { low: "neutral", normal: "info", high: "warning", urgent: "danger" };

export function TaskCard({ t }: { t: TaskRow }) {
  const [open, setOpen] = useState(false);
  const [finish, setFinish] = useState<null | "done" | "cancelled">(null);
  const [outcome, setOutcome] = useState("");
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: boolean; message?: string }>, after?: () => void) =>
    start(async () => { const r = await fn(); if (r.ok) { if (r.message) toast.success(r.message); after?.(); } else toast.error(r.message); });
  const closed = t.status === "done" || t.status === "cancelled";

  return (
    <li className={cn("rounded-2xl bg-card p-4 shadow-card ring-1 ring-border", t.overdue && !closed && "ring-2 ring-danger/40", closed && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-3">
        {!closed && (
          <button type="button" onClick={() => setFinish("done")} aria-label="Mark done"
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ring-2 ring-border transition hover:bg-success-soft hover:ring-success"><Check className="size-4 text-success opacity-0 hover:opacity-100" /></button>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("font-semibold", closed && "line-through")}>{t.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusPill tone={PRIORITY_TONE[t.priority]}>{t.priority}</StatusPill>
            {t.status === "in_progress" && <StatusPill tone="brand">In progress</StatusPill>}
            {t.due_at && <span className={cn("inline-flex items-center gap-1", t.overdue && !closed && "font-semibold text-danger")}><Clock className="size-3.5" />{formatDateTime(t.due_at)}</span>}
            {t.assigned_name && <span>→ {t.assigned_name}</span>}
            {t.customer && <Link href={`/customers/${t.customer.id}`} className="text-brand hover:underline">{t.customer.full_name}</Link>}
            {t.pet && <Link href={`/pets/${t.pet.id}`} className="text-brand hover:underline">{t.pet.name}</Link>}
          </div>
          {t.details && <p className="mt-2 text-sm whitespace-pre-wrap">{t.details}</p>}
          {t.outcome && <p className="mt-2 rounded-lg bg-success-soft px-3 py-1.5 text-sm text-success">{t.outcome}</p>}
        </div>
        <div className="flex gap-1">
          {!closed && t.status === "open" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setTaskStatus(t.id, "in_progress"))}><Play /> Start</Button>}
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}><MessageSquare /> {t.comments.length || ""}</Button>
        </div>
      </div>
      {open && (
        <div className="mt-3 grid gap-2 border-t pt-3">
          {t.comments.map((c, i) => <p key={i} className="text-sm"><span className="text-xs text-muted-foreground">{formatDateTime(c.at)} · {c.by}</span><br />{c.body}</p>)}
          {!closed && (
            <div className="flex gap-2">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add an update…" />
              <Button variant="outline" disabled={pending || !comment.trim()} onClick={() => run(() => addComment(t.id, comment), () => setComment(""))}>Add</Button>
            </div>
          )}
          {!closed && <Button variant="ghost" size="sm" className="justify-self-start text-muted-foreground" onClick={() => setFinish("cancelled")}><X /> Cancel task</Button>}
          <p className="text-xs text-muted-foreground">Created by {t.created_name ?? "—"}</p>
        </div>
      )}
      <Dialog open={!!finish} onOpenChange={(o) => !o && setFinish(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>{finish === "done" ? "What was done?" : "Why cancel?"}</DialogTitle>
            <DialogDescription>{finish === "done" ? "A short note of the outcome — e.g. “Called, owner booked Saturday 5 pm”." : "Recorded in the history."}</DialogDescription></DialogHeader>
          <Textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} autoFocus />
          <DialogFooter><Button disabled={pending || outcome.trim().length < 3} onClick={() => run(() => setTaskStatus(t.id, finish!, outcome), () => { setFinish(null); setOutcome(""); })}>
            {pending && <Loader2 className="animate-spin" />} {finish === "done" ? "Mark done" : "Cancel task"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
