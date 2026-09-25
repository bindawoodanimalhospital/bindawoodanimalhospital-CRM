"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, Check, Loader2, Minus, Package, Plus, Search, Sparkles, Trash2, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/app/form-field";
import { formatPKR, todayPK, addDaysPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Suggestion } from "../suggestions";
import {
  addLine, addLines, checkout, deleteDraft, removeLine, searchCatalog, setInvoiceDiscount, updateLine,
  type CatalogHit, type PaymentLine,
} from "../actions";

export type Line = {
  id: string; item_id: string; description: string; kind: "service" | "product"; quantity: number; unit_price: number;
  discount_amount: number; line_total: number; price_is_editable: boolean; track_stock: boolean;
};
export type Method = { key: string; label: string; needs_reference: boolean };
export type Totals = { subtotal: number; line_discounts: number; invoice_discount: number; tax_total: number; total: number; discount_reason: string | null };

export function InvoiceEditor({ invoiceId, lines, totals, suggestions, unmatched, methods, perms, customerCredit, customerName }: {
  invoiceId: string; lines: Line[]; totals: Totals; suggestions: Suggestion[]; unmatched: string[]; methods: Method[];
  perms: { discount: boolean }; customerCredit: number; customerName: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
      <div className="grid min-w-0 content-start gap-6">
        {(suggestions.length > 0 || unmatched.length > 0) && <Suggestions invoiceId={invoiceId} items={suggestions} unmatched={unmatched} />}
        <section className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
          <h2 className="mb-4 text-lg font-semibold">Bill items</h2>
          <AddItem invoiceId={invoiceId} />
          <ul className="mt-4 grid gap-2">
            {lines.length === 0 && <li className="rounded-xl bg-surface p-6 text-center text-muted-foreground">No items yet — search above or tick the suggestions.</li>}
            {lines.map((l) => <LineRow key={l.id} invoiceId={invoiceId} line={l} canDiscount={perms.discount} />)}
          </ul>
        </section>
        <DiscardDraft invoiceId={invoiceId} />
      </div>
      <Checkout invoiceId={invoiceId} totals={totals} methods={methods} canDiscount={perms.discount}
        hasLines={lines.length > 0} credit={customerCredit} customerName={customerName} />
    </div>
  );
}

function Suggestions({ invoiceId, items, unmatched }: { invoiceId: string; items: Suggestion[]; unmatched: string[] }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map((s) => s.key)));
  const [pending, start] = useTransition();
  const chosen = items.filter((s) => picked.has(s.key));
  return (
    <section className="rounded-2xl bg-brand-wash p-5 ring-1 ring-brand-muted">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-brand" /> From this visit</h2>
      <p className="mt-1 text-sm text-muted-foreground">Things that happened today and aren&apos;t billed yet. Untick anything you won&apos;t charge.</p>
      {items.length > 0 && (
        <ul className="mt-3 grid gap-1.5">
          {items.map((s) => (
            <li key={s.key}>
              <Label className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 font-normal ring-1 ring-border">
                <Checkbox checked={picked.has(s.key)} onCheckedChange={(v) => {
                  const next = new Set(picked); if (v) next.add(s.key); else next.delete(s.key); setPicked(next);
                }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}{s.quantity !== 1 ? ` × ${s.quantity}` : ""}</span>
                  <span className="block text-xs text-muted-foreground">{s.reason}</span>
                </span>
                <span className={cn("tabular font-semibold", s.unit_price === 0 && "text-warning")}>
                  {s.unit_price === 0 ? "No price set" : formatPKR(s.unit_price * s.quantity)}
                </span>
              </Label>
            </li>
          ))}
        </ul>
      )}
      {unmatched.length > 0 && (
        <p className="mt-3 text-xs text-warning">Not in the price list (add them in Inventory → Price list, or use “Other charge”): {unmatched.join(", ")}</p>
      )}
      {items.length > 0 && (
        <Button className="mt-4" disabled={pending || chosen.length === 0} onClick={() => start(async () => {
          const r = await addLines(invoiceId, chosen.map((s) => ({ item_id: s.item_id, quantity: s.quantity, source_table: s.source_table, source_id: s.source_id })));
          if (r.ok) toast.success(r.message); else toast.error(r.message);
        })}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Add {chosen.length} to bill</Button>
      )}
    </section>
  );
}

function AddItem({ invoiceId, retailOnly = false }: { invoiceId: string; retailOnly?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const id = ++seq.current;
    const t = setTimeout(async () => { const r = await searchCatalog(q, retailOnly); if (id === seq.current) setHits(r); }, 200);
    return () => clearTimeout(t);
  }, [q, open, retailOnly]);
  const add = (h: CatalogHit) => start(async () => {
    const r = await addLine(invoiceId, { item_id: h.id, quantity: 1 });
    if (!r.ok) toast.error(r.message); else { setQ(""); setOpen(false); }
  });
  return (
    <div className="relative">
      <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Add service or product — type a name or scan a barcode" className="h-12 pl-9 text-base" />
      {open && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl bg-popover p-1 shadow-float ring-1 ring-border">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" disabled={pending} onMouseDown={(e) => e.preventDefault()} onClick={() => add(h)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted">
                {h.kind === "product" ? <Package className="size-4 text-muted-foreground" /> : <Sparkles className="size-4 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate"><b>{h.name}</b> <span className="text-xs text-muted-foreground">{h.category}</span></span>
                <span className="tabular text-sm font-semibold">{h.price_is_editable ? "set price" : formatPKR(h.sale_price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LineRow({ invoiceId, line, canDiscount }: { invoiceId: string; line: Line; canDiscount: boolean }) {
  const [qty, setQty] = useState(String(line.quantity));
  const [price, setPrice] = useState(String(line.unit_price));
  const [disc, setDisc] = useState(String(line.discount_amount || ""));
  const [pending, start] = useTransition();
  const save = (patch: Parameters<typeof updateLine>[2]) => start(async () => { const r = await updateLine(invoiceId, line.id, patch); if (!r.ok) toast.error(r.message); });
  const step = (d: number) => { const n = Math.max(1, Number(qty) + d); setQty(String(n)); save({ quantity: n }); };
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3 ring-1 ring-border">
      <div className="min-w-40 flex-1">
        <p className="font-semibold">{line.description}</p>
        <p className="text-xs text-muted-foreground">{line.kind === "product" ? (line.track_stock ? "Product · taken from stock" : "Product") : "Service"}</p>
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="outline" disabled={pending} onClick={() => step(-1)} aria-label="Less"><Minus /></Button>
        <Input className="h-8 w-16 text-center tabular" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
          onBlur={() => Number(qty) > 0 && Number(qty) !== line.quantity && save({ quantity: Number(qty) })} />
        <Button size="icon-sm" variant="outline" disabled={pending} onClick={() => step(1)} aria-label="More"><Plus /></Button>
      </div>
      {line.price_is_editable ? (
        <Input className="h-8 w-28 tabular" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price"
          onBlur={() => Number(price) !== line.unit_price && save({ unit_price: Number(price) })} />
      ) : <span className="w-24 text-right text-sm tabular text-muted-foreground">{formatPKR(line.unit_price)}</span>}
      {canDiscount && (
        <Input className="h-8 w-24 tabular" inputMode="decimal" placeholder="Discount" value={disc} onChange={(e) => setDisc(e.target.value)} aria-label="Discount"
          onBlur={() => Number(disc || 0) !== line.discount_amount && save({ discount_amount: Number(disc || 0) })} />
      )}
      <span className="w-28 text-right font-bold tabular">{formatPKR(line.line_total)}</span>
      <Button size="icon-sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await removeLine(invoiceId, line.id); if (!r.ok) toast.error(r.message); })} aria-label="Remove"><Trash2 /></Button>
    </li>
  );
}

function DiscardDraft({ invoiceId }: { invoiceId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" className="justify-self-start text-muted-foreground" disabled={pending}
      onClick={() => { if (confirm("Delete this draft bill?")) start(async () => { const r = await deleteDraft(invoiceId); if (r && !r.ok) toast.error(r.message); }); }}>
      <X /> Delete draft
    </Button>
  );
}

function newKey() { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }

function Checkout({ invoiceId, totals, methods, canDiscount, hasLines, credit, customerName }: {
  invoiceId: string; totals: Totals; methods: Method[]; canDiscount: boolean; hasLines: boolean; credit: number; customerName: string;
}) {
  const [pays, setPays] = useState<PaymentLine[]>([{ method: "cash", amount: totals.total }]);
  const [touched, setTouched] = useState(false);
  const [discount, setDiscount] = useState(String(totals.invoice_discount || ""));
  const [discReason, setDiscReason] = useState(totals.discount_reason ?? "");
  const [promise, setPromise] = useState(addDaysPK(7));
  const [laterReason, setLaterReason] = useState("");
  const [pending, start] = useTransition();
  const key = useRef(newKey());   // same key for retries of this checkout → never charged twice

  // Keep the default cash amount in step with the bill until the user edits payments.
  const shown = touched ? pays : [{ ...pays[0], amount: totals.total }, ...pays.slice(1)];
  const paid = shown.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balance = Math.round((totals.total - paid) * 100) / 100;
  const change = paid > totals.total && shown.every((p) => p.method === "cash") ? paid - totals.total : 0;
  const missingRef = shown.some((p) => p.amount > 0 && methods.find((m) => m.key === p.method)?.needs_reference && !p.reference?.trim());
  const setPay = (i: number, patch: Partial<PaymentLine>) => { setTouched(true); setPays(shown.map((p, j) => (j === i ? { ...p, ...patch } : p))); };

  const submit = () => start(async () => {
    const payments = shown.map((p) => ({ ...p, amount: Math.min(Number(p.amount) || 0, totals.total) }));
    const r = await checkout(invoiceId, payments, balance > 0 ? { promised_date: promise, reason: laterReason } : null, key.current);
    if (r.ok) { toast.success(r.message); key.current = newKey(); } else toast.error(r.message);
  });

  return (
    <aside className="grid content-start gap-4 lg:sticky lg:top-20">
      <section className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
        <dl className="grid gap-2 text-sm">
          <Row label="Subtotal" value={formatPKR(totals.subtotal)} />
          {totals.line_discounts > 0 && <Row label="Item discounts" value={`− ${formatPKR(totals.line_discounts)}`} />}
          {totals.invoice_discount > 0 && <Row label="Bill discount" value={`− ${formatPKR(totals.invoice_discount)}`} />}
          {totals.tax_total > 0 && <Row label="Tax" value={formatPKR(totals.tax_total)} />}
          <div className="mt-2 flex items-baseline justify-between border-t pt-3">
            <dt className="font-semibold">Total</dt><dd className="text-3xl font-bold tabular">{formatPKR(totals.total)}</dd>
          </div>
        </dl>
        {canDiscount && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Discount on the whole bill</summary>
            <div className="mt-2 grid gap-2">
              <Input inputMode="decimal" placeholder="Amount (Rs.)" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              <Input placeholder="Reason (required)" value={discReason} onChange={(e) => setDiscReason(e.target.value)} />
              <Button variant="outline" size="sm" onClick={() => start(async () => {
                const r = await setInvoiceDiscount(invoiceId, Number(discount || 0), discReason);
                if (r.ok) toast.success(r.message); else toast.error(r.message);
              })}>Apply</Button>
              <p className="text-xs text-muted-foreground">Large discounts need a manager to issue the bill.</p>
            </div>
          </details>
        )}
      </section>

      <section className="grid gap-3 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
        <h2 className="flex items-center gap-2 font-semibold"><Wallet className="size-4" /> Payment from {customerName}</h2>
        {credit > 0 && <p className="rounded-xl bg-success-soft px-3 py-2 text-sm text-success">Has {formatPKR(credit)} advance — you can apply it after issuing.</p>}
        {shown.map((p, i) => {
          const m = methods.find((x) => x.key === p.method);
          return (
            <div key={i} className="grid gap-2 rounded-xl bg-surface p-3 ring-1 ring-border">
              <div className="flex gap-2">
                <Select value={p.method} onValueChange={(v) => setPay(i, { method: v })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{methods.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="flex-1 text-right text-lg font-semibold tabular" inputMode="decimal" value={String(p.amount)}
                  onChange={(e) => setPay(i, { amount: Number(e.target.value.replace(/[^\d.]/g, "")) })} />
                {shown.length > 1 && <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => { setTouched(true); setPays(shown.filter((_, j) => j !== i)); }}><X /></Button>}
              </div>
              {m?.needs_reference && <Input placeholder={`${m.label} transaction ID`} value={p.reference ?? ""} onChange={(e) => setPay(i, { reference: e.target.value })} />}
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { setTouched(true); setPays([...shown, { method: "jazzcash", amount: Math.max(0, balance) }]); }}><Plus /> Split payment</Button>
          <Button variant="ghost" size="sm" onClick={() => { setTouched(true); setPays([{ method: "cash", amount: 0 }]); }}>Nothing paid now</Button>
        </div>

        {change > 0 && <p className="rounded-xl bg-info-soft px-3 py-2 text-sm font-semibold text-info">Give change: {formatPKR(change)}</p>}
        {balance > 0 && (
          <div className="grid gap-2 rounded-xl bg-warning-soft p-3 ring-1 ring-warning/30">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning"><CalendarClock className="size-4" /> {formatPKR(balance)} will be left to pay</p>
            <FormField label="Promised payment date"><Input type="date" min={todayPK()} value={promise} onChange={(e) => setPromise(e.target.value)} /></FormField>
            <FormField label="Reason"><Textarea rows={2} value={laterReason} onChange={(e) => setLaterReason(e.target.value)} placeholder="e.g. Will pay on the 1st, owner's brother will bring the rest" /></FormField>
          </div>
        )}
        <Button size="lg" disabled={pending || !hasLines || missingRef || (balance > 0 && laterReason.trim().length < 3)} onClick={submit}>
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
          {balance > 0 ? `Issue bill · ${formatPKR(Math.max(0, paid))} now` : "Take payment & issue bill"}
        </Button>
        {missingRef && <p className="text-xs text-danger">Enter the transaction ID for wallet / bank payments.</p>}
      </section>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><dt className="text-muted-foreground">{label}</dt><dd className="tabular">{value}</dd></div>;
}

