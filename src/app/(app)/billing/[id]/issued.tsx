"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Ban, CircleCheck, Loader2, PiggyBank, Printer, Receipt, RotateCcw, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { formatDateTime, formatPKR } from "@/lib/format";
import type { FormState } from "@/lib/validation";
import { applyCredit, recordPayment, refundInvoice, returnItems, voidInvoice } from "../actions";
import type { Method } from "./editor";

export type IssuedLine = { id: string; description: string; quantity: number; unit_price: number; discount_amount: number; line_total: number; returned_qty: number };
export type PaymentRow = { id: string; code: string; kind: string; method: string; amount: number; allocated: number; received_at: string; reference: string | null; by: string | null };
export type IssuedInvoice = {
  id: string; number: string; status: "issued" | "void"; customer_id: string | null; total: number; amount_paid: number; returned_amount: number;
  balance: number; void_reason: string | null; due: { status: string; promised_date: string; approval_status: string } | null;
};

const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function IssuedPanel({ inv, lines, payments, methods, perms, credit }: {
  inv: IssuedInvoice; lines: IssuedLine[]; payments: PaymentRow[]; methods: Method[]; credit: number;
  perms: { create: boolean; refund: boolean; void: boolean; ret: boolean };
}) {
  const voided = inv.status === "void";
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
      <section className="min-w-0 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
        <h2 className="mb-3 text-lg font-semibold">Items</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Discount</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="py-2 font-medium">{l.description}{l.returned_qty > 0 && <StatusPill className="ml-2">{Number(l.returned_qty)} returned</StatusPill>}</td>
                <td className="text-right tabular">{Number(l.quantity)}</td>
                <td className="text-right tabular">{formatPKR(l.unit_price)}</td>
                <td className="text-right tabular">{l.discount_amount ? formatPKR(l.discount_amount) : "—"}</td>
                <td className="text-right font-semibold tabular">{formatPKR(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mt-8 mb-3 text-lg font-semibold">Payments</h2>
        {payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
          <ul className="grid gap-2">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border">
                {p.kind === "refund" ? <Undo2 className="size-4 text-danger" /> : p.kind === "write_off" ? <Ban className="size-4 text-muted-foreground" /> : <CircleCheck className="size-4 text-success" />}
                <span className="font-medium">{p.kind === "refund" ? "Refund" : p.kind === "write_off" ? "Written off" : methods.find((m) => m.key === p.method)?.label ?? p.method}</span>
                {p.reference && <span className="font-mono text-xs text-muted-foreground">{p.reference}</span>}
                <span className="text-muted-foreground">{formatDateTime(p.received_at)}{p.by ? ` · ${p.by}` : ""}</span>
                <span className={`ml-auto font-bold tabular ${p.allocated < 0 ? "text-danger" : ""}`}>{p.allocated < 0 ? "− " : ""}{formatPKR(Math.abs(p.allocated))}</span>
                <Link href={`/print/receipt/${p.id}`} target="_blank" className="text-xs font-semibold text-brand hover:underline">{p.code}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="grid content-start gap-4">
        <section className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Total</dt><dd className="tabular">{formatPKR(inv.total)}</dd></div>
            {inv.returned_amount > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Returned</dt><dd className="tabular">− {formatPKR(inv.returned_amount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd className="tabular">{formatPKR(inv.amount_paid)}</dd></div>
            <div className="mt-2 flex items-baseline justify-between border-t pt-3">
              <dt className="font-semibold">{voided ? "Voided" : inv.balance > 0 ? "Still to pay" : "Balance"}</dt>
              <dd className={`text-3xl font-bold tabular ${inv.balance > 0 && !voided ? "text-danger" : "text-success"}`}>{voided ? "—" : formatPKR(inv.balance)}</dd>
            </div>
          </dl>
          {voided && <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm">Void: {inv.void_reason}</p>}
          {inv.due && inv.due.status === "open" && (
            <p className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
              Due — promised by {inv.due.promised_date}{inv.due.approval_status === "pending" ? " · waiting for manager approval" : ""}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={`/print/invoice/${inv.id}`} target="_blank"><Printer /> Print bill</Link></Button>
          </div>
        </section>

        {!voided && (
          <section className="grid gap-2 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
            {perms.create && inv.balance > 0 && inv.customer_id && <PayDialog inv={inv} methods={methods} />}
            {perms.create && inv.balance > 0 && credit > 0 && <Run label={`Use advance (${formatPKR(credit)})`} icon={<PiggyBank />} fn={() => applyCredit(inv.id)} />}
            {perms.ret && lines.some((l) => l.returned_qty < l.quantity) && <ReturnDialog inv={inv} lines={lines} methods={methods} />}
            {perms.refund && inv.amount_paid > 0 && <RefundDialog inv={inv} methods={methods} />}
            {perms.void && inv.amount_paid === 0 && inv.returned_amount === 0 && <VoidDialog id={inv.id} />}
          </section>
        )}
      </aside>
    </div>
  );
}

function Run({ label, icon, fn }: { label: string; icon: React.ReactNode; fn: () => Promise<FormState> }) {
  const [pending, start] = useTransition();
  return <Button variant="outline" disabled={pending} onClick={() => start(async () => { const r = await fn(); if (r.ok) toast.success(r.message); else toast.error(r.message); })}>
    {pending ? <Loader2 className="animate-spin" /> : icon} {label}</Button>;
}

function PayDialog({ inv, methods }: { inv: IssuedInvoice; methods: Method[] }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState(String(inv.balance));
  const [ref, setRef] = useState("");
  const [pending, start] = useTransition();
  const k = useRef(key());
  const m = methods.find((x) => x.key === method);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="lg"><Wallet /> Receive payment</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Receive payment</DialogTitle><DialogDescription>Anything above this bill goes to the customer&apos;s older bills, then to advance.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{methods.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-12 text-right text-xl font-bold tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          {m?.needs_reference && <Input placeholder={`${m.label} transaction ID`} value={ref} onChange={(e) => setRef(e.target.value)} />}
        </div>
        <DialogFooter>
          <Button size="lg" disabled={pending || !(Number(amount) > 0) || (m?.needs_reference && !ref.trim())} onClick={() => start(async () => {
            const r = await recordPayment({ customer_id: inv.customer_id!, amount: Number(amount), method, reference: ref, invoice_id: inv.id, key: k.current });
            if (r.ok) { toast.success(r.message); setOpen(false); k.current = key(); } else toast.error(r.message);
          })}>{pending && <Loader2 className="animate-spin" />} Save {formatPKR(Number(amount) || 0)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({ inv, methods }: { inv: IssuedInvoice; methods: Method[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(inv.amount_paid));
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const k = useRef(key());
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Undo2 /> Refund money</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Refund</DialogTitle><DialogDescription>For returning products use “Return items” instead — it also puts stock back.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Input className="text-right text-lg font-bold tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{methods.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={pending || !(Number(amount) > 0) || reason.trim().length < 3} onClick={() => start(async () => {
            const r = await refundInvoice(inv.id, Number(amount), method, reason, k.current);
            if (r.ok) { toast.success(r.message); setOpen(false); k.current = key(); } else toast.error(r.message);
          })}>Refund {formatPKR(Number(amount) || 0)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({ inv, lines, methods }: { inv: IssuedInvoice; lines: IssuedLine[]; methods: Method[] }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const k = useRef(key());
  const chosen = lines.map((l) => ({ l, q: Number(qty[l.id] || 0) })).filter((x) => x.q > 0);
  const value = chosen.reduce((s, x) => s + (x.l.line_total * x.q) / x.l.quantity, 0);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><RotateCcw /> Return items</Button></DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader><DialogTitle>Return items</DialogTitle><DialogDescription>Products go back into stock. Money already paid is refunded.</DialogDescription></DialogHeader>
        <ul className="grid gap-2">
          {lines.filter((l) => l.returned_qty < l.quantity).map((l) => (
            <li key={l.id} className="flex items-center gap-3">
              <span className="flex-1 text-sm">{l.description} <span className="text-muted-foreground">(max {Number(l.quantity) - Number(l.returned_qty)})</span></span>
              <Input className="w-20 text-center" inputMode="decimal" placeholder="0" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
            </li>
          ))}
        </ul>
        <FormField label="Refund by"><Select value={method} onValueChange={setMethod}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{methods.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent></Select></FormField>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required) — e.g. unopened, wrong size" />
        <DialogFooter>
          <Button disabled={pending || chosen.length === 0 || reason.trim().length < 3} onClick={() => start(async () => {
            const r = await returnItems(inv.id, chosen.map((x) => ({ invoice_item_id: x.l.id, qty: x.q })), reason, method, k.current);
            if (r.ok) { toast.success(r.message); setOpen(false); k.current = key(); } else toast.error(r.message);
          })}>{pending && <Loader2 className="animate-spin" />} Return {formatPKR(value)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" className="text-danger"><Receipt /> Void bill</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Void this bill?</DialogTitle><DialogDescription>It stays in the records as void and any stock taken is put back.</DialogDescription></DialogHeader>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />
        <DialogFooter><Button variant="destructive" disabled={pending || reason.trim().length < 3} onClick={() => start(async () => {
          const r = await voidInvoice(id, reason); if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.message);
        })}>Void bill</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
