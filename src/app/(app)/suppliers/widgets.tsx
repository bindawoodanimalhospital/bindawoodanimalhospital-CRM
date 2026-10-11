"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Loader2, PackageCheck, Plus, Trash2, Truck, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { formatPKR, todayPK } from "@/lib/format";
import type { FormState } from "@/lib/validation";
import { searchCatalog, type CatalogHit } from "../billing/actions";
import { addPurchaseLine, cancelPurchase, paySupplier, receivePurchase, removePurchaseLine, saveSupplier, startPurchase } from "./actions";

function useRun() {
  const [pending, start] = useTransition();
  return { pending, run: (fn: () => Promise<FormState | undefined>, after?: () => void) => start(async () => {
    const r = await fn(); if (!r) return; if (r.ok) { if (r.message) toast.success(r.message); after?.(); } else toast.error(r.message);
  }) };
}

export function SupplierDialog({ supplier, trigger }: { supplier?: { id: string; name: string; contact_name: string | null; phone: string | null; address: string | null; ntn: string | null; notes: string | null }; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: supplier?.name ?? "", contact_name: supplier?.contact_name ?? "", phone: supplier?.phone ?? "", address: supplier?.address ?? "", ntn: supplier?.ntn ?? "", notes: supplier?.notes ?? "" });
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus /> New supplier</Button>}</DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>{supplier ? "Edit supplier" : "New supplier"}</DialogTitle><DialogDescription>Distributor, pharma company or pet food wholesaler.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <FormField label="Contact person"><Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></FormField>
          <FormField label="Phone"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormField>
          <FormField label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></FormField>
          <FormField label="NTN (optional)"><Input value={f.ntn} onChange={(e) => setF({ ...f, ntn: e.target.value })} /></FormField>
          <FormField label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
        </div>
        <DialogFooter><Button disabled={pending} onClick={() => run(() => saveSupplier(supplier?.id ?? null, f), () => setOpen(false))}>{pending && <Loader2 className="animate-spin" />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StartPurchaseButton({ supplierId }: { supplierId: string }) {
  const { pending, run } = useRun();
  return <Button size="lg" disabled={pending} onClick={() => run(() => startPurchase(supplierId))}>{pending ? <Loader2 className="animate-spin" /> : <Truck />} Receive a delivery</Button>;
}

export function PaySupplierDialog({ supplierId, methods, owed }: { supplierId: string; methods: { key: string; label: string }[]; owed: number }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: String(Math.max(0, owed)), method: "bank", paid_on: todayPK(), reference: "", notes: "" });
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Wallet /> Record payment to supplier</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Pay supplier</DialogTitle><DialogDescription>Currently owed: {formatPKR(owed)}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Amount"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></FormField>
          <FormField label="Paid on"><Input type="date" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></FormField>
          <FormField label="Method"><Select value={f.method} onValueChange={(v) => setF({ ...f, method: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{methods.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent></Select></FormField>
          <FormField label="Reference / cheque no."><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></FormField>
        </div>
        <DialogFooter><Button disabled={pending || !(Number(f.amount) > 0)} onClick={() => run(() => paySupplier(supplierId, { ...f, amount: Number(f.amount) }), () => setOpen(false))}>Save payment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type GrnLine = { id: string; item_name: string; location: string; batch_no: string; expiry_date: string | null; qty: number; unit_cost: number; line_total: number };

export function GrnEditor({ purchaseId, lines, locations, total }: { purchaseId: string; lines: GrnLine[]; locations: { id: string; name: string }[]; total: number }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [item, setItem] = useState<CatalogHit | null>(null);
  const [f, setF] = useState({ location_id: locations[0]?.id ?? "", batch_no: "", expiry_date: "", qty: "", unit_cost: "" });
  const { pending, run } = useRun();
  useEffect(() => {
    if (item || q.trim().length < 2) return;
    const t = setTimeout(async () => setHits((await searchCatalog(q)).filter((h) => h.kind === "product")), 200);
    return () => clearTimeout(t);
  }, [q, item]);
  const expired = f.expiry_date && f.expiry_date < todayPK();

  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border">
            <span className="font-semibold">{l.item_name}</span>
            <span className="text-muted-foreground">{l.location} · batch {l.batch_no || "—"} · exp {l.expiry_date ?? "—"}</span>
            <span className="ml-auto tabular">{l.qty} × {formatPKR(l.unit_cost)} = <b>{formatPKR(l.line_total)}</b></span>
            <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => run(() => removePurchaseLine(purchaseId, l.id))}><Trash2 /></Button>
          </li>
        ))}
        {!lines.length && <li className="rounded-xl bg-surface p-6 text-center text-muted-foreground">Add each item on the supplier&apos;s invoice.</li>}
      </ul>

      <div className="grid gap-3 rounded-2xl bg-brand-wash p-4 ring-1 ring-brand-muted">
        {!item ? (
          <div className="relative">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item received — type a name" />
            {hits.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl bg-popover p-1 shadow-float ring-1 ring-border">
                {hits.map((h) => <li key={h.id}><button type="button" onClick={() => { setItem(h); setHits([]); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                  <b>{h.name}</b> <span className="text-muted-foreground">{h.track_stock ? "" : "· stock tracking is off"}</span></button></li>)}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2"><Check className="size-4 text-brand" /><b className="flex-1">{item.name}</b>
            <Button variant="ghost" size="icon-sm" onClick={() => { setItem(null); setQ(""); }} aria-label="Change"><X /></Button></div>
        )}
        {item && !item.track_stock && <p className="text-xs text-warning">Turn on “Track stock” for this item first (Inventory → item).</p>}
        <div className="grid gap-2 sm:grid-cols-5">
          <Select value={f.location_id} onValueChange={(v) => setF({ ...f, location_id: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Where" /></SelectTrigger>
            <SelectContent>{locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select>
          <Input placeholder="Batch / lot" value={f.batch_no} onChange={(e) => setF({ ...f, batch_no: e.target.value })} />
          <Input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} aria-label="Expiry" aria-invalid={!!expired} />
          <Input inputMode="decimal" placeholder="Qty" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          <Input inputMode="decimal" placeholder="Cost each (Rs.)" value={f.unit_cost} onChange={(e) => setF({ ...f, unit_cost: e.target.value })} />
        </div>
        {expired && <p className="text-sm font-semibold text-danger">This batch is already expired — don&apos;t accept it.</p>}
        <Button variant="outline" className="justify-self-end" disabled={pending || !item || !item.track_stock || !(Number(f.qty) > 0) || f.unit_cost === "" || !!expired}
          onClick={() => run(() => addPurchaseLine(purchaseId, { item_id: item!.id, ...f }), () => { setItem(null); setQ(""); setF({ ...f, batch_no: "", expiry_date: "", qty: "", unit_cost: "" }); })}>
          <Plus /> Add line</Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button variant="ghost" onClick={() => { if (confirm("Cancel this delivery?")) run(() => cancelPurchase(purchaseId)); }}>Cancel delivery</Button>
        <div className="flex items-center gap-4">
          <span className="text-lg">Total <b className="tabular">{formatPKR(total)}</b></span>
          <Button size="lg" disabled={pending || !lines.length} onClick={() => { if (confirm("Add all of this to stock? This can't be edited afterwards.")) run(() => receivePurchase(purchaseId)); }}>
            {pending ? <Loader2 className="animate-spin" /> : <PackageCheck />} Receive into stock</Button>
        </div>
      </div>
    </div>
  );
}

export function HeaderFields({ purchaseId, invoiceNo, invoiceDate, onSave }: { purchaseId: string; invoiceNo: string; invoiceDate: string; onSave: (id: string, p: { supplier_invoice_no?: string; invoice_date?: string }) => Promise<FormState> }) {
  const [no, setNo] = useState(invoiceNo);
  const [date, setDate] = useState(invoiceDate);
  const save = () => onSave(purchaseId, { supplier_invoice_no: no, invoice_date: date }).then((r) => { if (!r.ok) toast.error(r.message); });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Supplier's invoice / bill no."><Input value={no} onChange={(e) => setNo(e.target.value)} onBlur={save} /></FormField>
      <FormField label="Invoice date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={save} /></FormField>
    </div>
  );
}

