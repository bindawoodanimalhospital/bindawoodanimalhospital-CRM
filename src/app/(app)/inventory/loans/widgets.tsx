"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, Ban, Building2, Loader2, Plus, Search, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelLoan, recordLoan, recordLoanReturn, savePartner, searchStockItems, type StockItemOption } from "./actions";

export type PartnerOption = { id: string; name: string; kind: string };
type Loc = { id: string; name: string };
type Line = { item: StockItemOption; qty: string; batch_no: string; expiry_date: string; location_id: string };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const PARTNER_KIND: Record<string, string> = { clinic: "Clinic", hospital: "Hospital", pet_store: "Pet store", pharmacy: "Pharmacy", other: "Other" };

/** Record stock borrowed from, or lent to, another business. */
export function LoanDialog({ direction, partners, locations, defaultLocation }: {
  direction: "borrowed" | "lent"; partners: PartnerOption[]; locations: Loc[]; defaultLocation: string;
}) {
  const router = useRouter();
  const borrowed = direction === "borrowed";
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<PartnerOption[]>([]);   // businesses created from this dialog
  const [partnerId, setPartnerId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [loanDate, setLoanDate] = useState(todayPK());
  const [expected, setExpected] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const key = useRef(newKey());

  const list = [...partners, ...added.filter((a) => !partners.some((p) => p.id === a.id))].sort((a, b) => a.name.localeCompare(b.name));
  const reset = () => { setPartnerId(""); setLines([]); setLoanDate(todayPK()); setExpected(""); setReference(""); setNotes(""); key.current = newKey(); };

  const add = (item: StockItemOption) => {
    if (lines.some((l) => l.item.id === item.id)) { toast.error(`${item.name} is already on the list.`); return; }
    setLines((ls) => [...ls, { item, qty: "", batch_no: "", expiry_date: "", location_id: defaultLocation }]);
  };
  const set = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.item.id === id ? { ...l, ...patch } : l)));
  const problem = !partnerId ? "Choose the business."
    : !lines.length ? "Add at least one product."
    : lines.some((l) => !(Number(l.qty) > 0)) ? "Enter a quantity for every product."
    : !borrowed && lines.some((l) => Number(l.qty) > l.item.usable) ? "You can't lend more than is in stock."
    : expected && expected < loanDate ? "The expected return date is before the loan date."
    : null;

  const submit = () => start(async () => {
    const r = await recordLoan({
      key: key.current, direction, partner_id: partnerId, loan_date: loanDate, expected_return: expected, reference, notes,
      lines: lines.map((l) => ({ item_id: l.item.id, qty: Number(l.qty), batch_no: l.batch_no, expiry_date: l.expiry_date, location_id: l.location_id })),
    });
    if (r.ok) { toast.success(r.message); setOpen(false); reset(); if (r.id) router.push(`/inventory/loans/${r.id}`); }
    else toast.error(r.message);
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant={borrowed ? "default" : "outline"}>{borrowed ? <ArrowDownToLine /> : <ArrowUpFromLine />} {borrowed ? "We borrowed" : "We lent"}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{borrowed ? "Stock borrowed from another business" : "Stock lent to another business"}</DialogTitle>
          <DialogDescription>
            {borrowed
              ? "Adds the products to our stock and keeps a balance of what we owe back. Not a purchase — no bill is made."
              : "Takes the products out of our stock and keeps a balance of what they owe back. Not a sale — no bill is made."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label={borrowed ? "Borrowed from" : "Lent to"} required>
            <div className="flex gap-2">
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose the clinic / store" /></SelectTrigger>
                <SelectContent>{list.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} <span className="text-muted-foreground">· {PARTNER_KIND[p.kind]}</span></SelectItem>)}</SelectContent>
              </Select>
              <PartnerDialog onSaved={(p) => { setAdded((l) => [...l, p]); setPartnerId(p.id); }}
                trigger={<Button type="button" variant="outline"><Plus /> New</Button>} />
            </div>
          </FormField>

          <div className="grid gap-2">
            <Label>Products</Label>
            <ItemSearch onPick={add} />
            {lines.length > 0 && (
              <ul className="grid gap-2">
                {lines.map((l) => (
                  <li key={l.item.id} className="grid gap-2 rounded-xl bg-surface p-3 ring-1 ring-border">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{l.item.name}</span>
                      <span className="text-xs text-muted-foreground">{l.item.usable} {l.item.unit} in stock</span>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setLines((ls) => ls.filter((x) => x.item.id !== l.item.id))}><Trash2 /></Button>
                    </div>
                    <div className={cn("grid gap-2", borrowed ? "sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-4")}>
                      <label className="grid gap-1 text-xs font-medium">Quantity ({l.item.unit})
                        <Input inputMode="decimal" value={l.qty} onChange={(e) => set(l.item.id, { qty: e.target.value.replace(/[^\d.]/g, "") })} className="tabular" />
                      </label>
                      {borrowed && (
                        <>
                          <label className="grid gap-1 text-xs font-medium">Their batch no.
                            <Input value={l.batch_no} onChange={(e) => set(l.item.id, { batch_no: e.target.value })} placeholder="optional" />
                          </label>
                          <label className="grid gap-1 text-xs font-medium">Expiry
                            <Input type="date" value={l.expiry_date} onChange={(e) => set(l.item.id, { expiry_date: e.target.value })} />
                          </label>
                          <label className="grid gap-1 text-xs font-medium">Put in
                            <Select value={l.location_id} onValueChange={(v) => set(l.item.id, { location_id: v })}>
                              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                              <SelectContent>{locations.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </label>
                        </>
                      )}
                    </div>
                    {!borrowed && <p className="text-xs text-muted-foreground">Taken from the batch that expires first (expired stock is never lent).</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={borrowed ? "Date received" : "Date given"}><Input type="date" value={loanDate} max={todayPK()} onChange={(e) => setLoanDate(e.target.value)} /></FormField>
            <FormField label="Expected return" hint="Optional — used to flag overdue returns"><Input type="date" value={expected} min={loanDate} onChange={(e) => setExpected(e.target.value)} /></FormField>
            <FormField label="Reference" hint="Their slip no., who agreed it…"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></FormField>
            <FormField label="Notes" hint="Reason or agreed arrangement"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
          </div>
          {problem && lines.length > 0 && <p className="text-sm text-danger">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || !!problem} onClick={submit}>{pending && <Loader2 className="animate-spin" />} {borrowed ? "Save — add to stock" : "Save — take out of stock"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemSearch({ onPick }: { onPick: (i: StockItemOption) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<StockItemOption[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => setHits(await searchStockItems(q)), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setHits([]); }} className="pl-9" placeholder="Search a product — food, litter, medicine…" />
      {q.trim().length >= 2 && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl bg-popover p-1 shadow-float ring-1 ring-border">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => { onPick(h); setQ(""); setHits([]); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                <b>{h.name}</b><span className="text-muted-foreground">{h.usable} {h.unit}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted-foreground">Only items with stock tracking are listed.</p>
    </div>
  );
}

export function PartnerDialog({ partner, onSaved, trigger }: {
  partner?: { id: string; name: string; kind: string; contact_name: string | null; phone: string | null; address: string | null; notes: string | null };
  onSaved?: (p: PartnerOption) => void; trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: partner?.name ?? "", kind: partner?.kind ?? "clinic", contact_name: partner?.contact_name ?? "",
    phone: partner?.phone ?? "", address: partner?.address ?? "", notes: partner?.notes ?? "" });
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await savePartner(partner?.id ?? null, { ...f, kind: f.kind as "clinic" });
    if (r.ok && r.id) { toast.success(r.message); setOpen(false); onSaved?.({ id: r.id, name: f.name.trim(), kind: f.kind }); }
    else toast.error(r.message);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Building2 className="size-5 text-brand" /> {partner ? "Edit business" : "Add a nearby business"}</DialogTitle>
          <DialogDescription>A clinic, hospital or pet store you borrow from or lend to.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Business name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></FormField>
          <FormField label="Type">
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PARTNER_KIND).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label="Phone"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormField>
          <FormField label="Contact person"><Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></FormField>
          <FormField label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></FormField>
          <FormField label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || f.name.trim().length < 2} onClick={save}>{pending && <Loader2 className="animate-spin" />} Save business</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ReturnLine = { id: string; item_name: string; unit: string; qty: number; returned_qty: number };

/** Record part or all of a loan coming back. Can be used many times until nothing is outstanding. */
export function ReturnDialog({ loanId, direction, partnerName, lines, loanDate }: {
  loanId: string; direction: "borrowed" | "lent"; partnerName: string; lines: ReturnLine[]; loanDate: string;
}) {
  const borrowed = direction === "borrowed";
  const open_ = lines.filter((l) => l.qty > l.returned_qty);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<Record<string, { batch_no: string; expiry_date: string }>>({});
  const [date, setDate] = useState(todayPK());
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const key = useRef(newKey());
  const over = open_.find((l) => Number(qty[l.id] || 0) > l.qty - l.returned_qty);
  const any = open_.some((l) => Number(qty[l.id] || 0) > 0);

  const submit = () => start(async () => {
    const r = await recordLoanReturn(loanId, {
      key: key.current, returned_on: date, notes,
      lines: open_.map((l) => ({ loan_line_id: l.id, qty: Number(qty[l.id] || 0), ...(batch[l.id] ?? {}) })),
    });
    if (r.ok) { toast.success(r.message); setOpen(false); setQty({}); setBatch({}); setNotes(""); key.current = newKey(); }
    else toast.error(r.message);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Undo2 /> Record return</Button></DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{borrowed ? `Give stock back to ${partnerName}` : `Stock returned by ${partnerName}`}</DialogTitle>
          <DialogDescription>
            {borrowed ? "Takes the quantity out of our stock (earliest expiry first)." : "Puts the quantity back into our stock — into the batch it left from, unless you enter new batch details."}
            {" "}Part returns are fine; record the rest later.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2">
          {open_.map((l) => {
            const left = l.qty - l.returned_qty;
            return (
              <li key={l.id} className="grid gap-2 rounded-xl bg-surface p-3 ring-1 ring-border">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{l.item_name}</span>
                  <span className="text-xs text-muted-foreground">{left} {l.unit} outstanding</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input inputMode="decimal" placeholder={`Quantity (max ${left})`} value={qty[l.id] ?? ""} className="tabular"
                    onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/[^\d.]/g, "") })} />
                  <Button type="button" variant="outline" onClick={() => setQty({ ...qty, [l.id]: String(left) })}>All {left}</Button>
                </div>
                {!borrowed && Number(qty[l.id] || 0) > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="New batch no. (optional)" value={batch[l.id]?.batch_no ?? ""} onChange={(e) => setBatch({ ...batch, [l.id]: { batch_no: e.target.value, expiry_date: batch[l.id]?.expiry_date ?? "" } })} />
                    <Input type="date" aria-label="Expiry" value={batch[l.id]?.expiry_date ?? ""} onChange={(e) => setBatch({ ...batch, [l.id]: { batch_no: batch[l.id]?.batch_no ?? "", expiry_date: e.target.value } })} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Date"><Input type="date" value={date} min={loanDate} max={todayPK()} onChange={(e) => setDate(e.target.value)} /></FormField>
          <FormField label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" /></FormField>
        </div>
        {over && <p className="text-sm text-danger">Only {over.qty - over.returned_qty} {over.unit} of {over.item_name} are outstanding.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || !any || !!over} onClick={submit}>{pending && <Loader2 className="animate-spin" />} Save return</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelLoanDialog({ loanId, code }: { loanId: string; code: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" className="text-danger"><Ban /> Cancel record</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Cancel {code}?</DialogTitle>
          <DialogDescription>Only for a record entered by mistake. Its stock movement is reversed. Records with returns can&apos;t be cancelled.</DialogDescription>
        </DialogHeader>
        <FormField label="Reason" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" autoFocus /></FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Keep it</Button>
          <Button variant="destructive" disabled={pending || reason.trim().length < 3} onClick={() => start(async () => {
            const r = await cancelLoan(loanId, reason);
            if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.message);
          })}>{pending && <Loader2 className="animate-spin" />} Cancel record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
