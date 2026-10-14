"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, CalendarClock, Loader2, PackagePlus, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import type { FormState } from "@/lib/validation";
import { todayPK } from "@/lib/format";
import { addStock, addStockCount, adjustBatch, saveCounts, setBatchDetails, transferBatch } from "./actions";

type Loc = { id: string; name: string };

function useRun() {
  const [pending, start] = useTransition();
  return { pending, run: (fn: () => Promise<FormState>, after?: () => void) => start(async () => { const r = await fn(); if (r.ok) { toast.success(r.message); after?.(); } else toast.error(r.message); }) };
}

export function StockCountDialog({ itemId, locations, unit }: { itemId: string; locations: Loc[]; unit: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ location_id: locations[0]?.id ?? "", batch_no: "", expiry_date: "", qty: "", reason: "Opening stock count" });
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><PackagePlus /> Add counted stock</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Add counted stock</DialogTitle><DialogDescription>For the first count or stock found. Supplier deliveries go through Suppliers → Receive stock.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Where">
            <Select value={f.location_id} onValueChange={(v) => setF({ ...f, location_id: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label={`Quantity (${unit})`}><Input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></FormField>
          <FormField label="Batch / lot"><Input value={f.batch_no} onChange={(e) => setF({ ...f, batch_no: e.target.value })} /></FormField>
          <FormField label="Expiry date"><Input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></FormField>
          <FormField label="Note" className="sm:col-span-2"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
        </div>
        <DialogFooter><Button disabled={pending || !(Number(f.qty) > 0) || !f.location_id} onClick={() => run(() => addStockCount(itemId, { ...f, qty: Number(f.qty) }), () => setOpen(false))}>
          {pending && <Loader2 className="animate-spin" />} Add stock</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustDialog({ itemId, batch, locations }: { itemId: string; batch: { id: string; batch_no: string; qty: number; location_id: string }; locations: Loc[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"count" | "wastage" | "expired" | "return_to_supplier" | "move">("count");
  const [value, setValue] = useState("");
  const [to, setTo] = useState(locations.find((l) => l.id !== batch.location_id)?.id ?? "");
  const [reason, setReason] = useState("");
  const { pending, run } = useRun();
  const n = Number(value);
  const submit = () => {
    if (mode === "move") return run(() => transferBatch(itemId, batch.id, n, to), () => setOpen(false));
    const change = mode === "count" ? n - batch.qty : -Math.abs(n);
    run(() => adjustBatch(itemId, batch.id, change, mode === "count" ? "adjust" : mode, reason), () => setOpen(false));
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="sm"><SlidersHorizontal /> Remove / correct</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Batch {batch.batch_no || "(no batch)"} — {batch.qty} in stock</DialogTitle><DialogDescription>Take pieces out (damaged, expired, sent back), fix the number, or move them to another place. Every change is logged with your name and reason. To change the expiry date, use “Expiry &amp; batch”.</DialogDescription></DialogHeader>
        <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="count">Correct the count</SelectItem>
            <SelectItem value="wastage">Damaged / wasted</SelectItem>
            <SelectItem value="expired">Expired — remove</SelectItem>
            <SelectItem value="return_to_supplier">Returned to supplier</SelectItem>
            <SelectItem value="move"><ArrowRightLeft className="inline size-4" /> Move to another place</SelectItem>
          </SelectContent>
        </Select>
        <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "count" ? "Actual quantity counted" : "Quantity"} />
        {mode === "move" ? (
          <Select value={to} onValueChange={setTo}><SelectTrigger className="w-full"><SelectValue placeholder="Move to" /></SelectTrigger>
            <SelectContent>{locations.filter((l) => l.id !== batch.location_id).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent></Select>
        ) : <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" />}
        {mode === "count" && value !== "" && <p className="text-sm text-muted-foreground">Change: {n - batch.qty > 0 ? "+" : ""}{n - batch.qty}</p>}
        <DialogFooter><Button disabled={pending || value === "" || (mode !== "move" && reason.trim().length < 3) || (mode === "count" && n === batch.qty)} onClick={submit}>
          {pending && <Loader2 className="animate-spin" />} Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The simple way to put stock in: "How many are you adding?" — one number. Where, batch and
 * expiry are optional. Adding stock switches tracking on, so every sale counts down from here.
 */
export function AddStockDialog({ itemId, itemName, unit, locations, trigger }: {
  itemId: string; itemName: string; unit: string; locations: Loc[]; trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [f, setF] = useState({ qty: "", location_id: "", batch_no: "", expiry_date: "", note: "" });
  const { pending, run } = useRun();
  const qty = Number(f.qty);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setMore(false); setF({ qty: "", location_id: "", batch_no: "", expiry_date: "", note: "" }); } }}>
      <DialogTrigger asChild>{trigger ?? <Button><PackagePlus /> Add stock</Button>}</DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Add stock — {itemName}</DialogTitle>
          <DialogDescription>Type how many {unit} you are putting on the shelf. Every sale or bill takes them out automatically.</DialogDescription>
        </DialogHeader>
        <FormField label={`How many ${unit} are you adding?`}>
          <Input autoFocus inputMode="decimal" className="h-14 text-center text-2xl font-bold tabular" value={f.qty}
            onChange={(e) => setF({ ...f, qty: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Expiry date" hint="Printed on the box. Recommended — you're warned before it expires and the oldest is sold first.">
            <Input type="date" min={todayPK()} value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} />
          </FormField>
          <FormField label="Batch / lot no." hint="Also on the box — optional"><Input value={f.batch_no} onChange={(e) => setF({ ...f, batch_no: e.target.value })} /></FormField>
        </div>
        <p className="text-xs text-muted-foreground">Pieces with different expiry dates? Add them separately — one “Add stock” per date.</p>
        {!more ? (
          <button type="button" className="justify-self-start text-sm font-semibold text-brand hover:underline" onClick={() => setMore(true)}>
            + Place or note (optional)
          </button>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Where it's kept" className="sm:col-span-2">
              <Select value={f.location_id || "auto"} onValueChange={(v) => setF({ ...f, location_id: v === "auto" ? "" : v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">The usual place</SelectItem>
                  {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Note" className="sm:col-span-2"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Bought from market" /></FormField>
          </div>
        )}
        <DialogFooter>
          <Button size="lg" disabled={pending || !(qty > 0)} onClick={() => run(() => addStock(itemId, { ...f, qty }), () => setOpen(false))}>
            {pending && <Loader2 className="animate-spin" />} Add {qty > 0 ? `${qty} ${unit}` : "stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "There are exactly N on the shelf" — corrects the count in one step. */
export function SetCountDialog({ itemId, itemName, unit, current }: { itemId: string; itemName: string; unit: string; current: number | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const { pending, run } = useRun();
  const n = Number(value);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><SlidersHorizontal /> Set the count</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>How many {unit} are on the shelf now?</DialogTitle>
          <DialogDescription>{itemName}{current != null ? ` — the system has ${current}.` : " — not counted yet."} Count them and type the number; the system corrects itself.</DialogDescription>
        </DialogHeader>
        <Input autoFocus inputMode="decimal" className="h-14 text-center text-2xl font-bold tabular" value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} placeholder={current != null ? String(current) : "0"} />
        {value !== "" && current != null && n !== current && (
          <p className="text-sm text-muted-foreground">{n > current ? `${n - current} will be added` : `${current - n} will be taken off`} (saved as “Shelf count” with your name).</p>
        )}
        <DialogFooter>
          <Button size="lg" disabled={pending || value === "" || (current != null && n === current)} onClick={() => run(() => saveCounts([{ item_id: itemId, count: n }]), () => setOpen(false))}>
            {pending && <Loader2 className="animate-spin" />} Save count
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Part = { qty: string; expiry: string; batch_no: string };

/**
 * "Expiry & batch" on one batch: correct its expiry date or batch number, or — when the pieces on
 * the shelf have different dates — split them ("6 expire in Jan, 4 in Mar"). The total stays the same.
 */
export function BatchDetailsDialog({ itemId, unit, batch, trigger }: {
  itemId: string; unit: string; batch: { id: string; batch_no: string; expiry_date: string | null; qty: number }; trigger?: React.ReactNode;
}) {
  const fresh = (): Part[] => [{ qty: String(batch.qty), expiry: batch.expiry_date ?? "", batch_no: batch.batch_no }];
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<Part[]>(fresh);
  const [reason, setReason] = useState("");
  const { pending, run } = useRun();
  const total = parts.reduce((s, p) => s + (Number(p.qty) || 0), 0);
  const split = parts.length > 1;
  const left = Math.round((batch.qty - total) * 1000) / 1000;
  const set = (i: number, patch: Partial<Part>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const ok = parts.every((p) => Number(p.qty) > 0) && left === 0;
  const today = todayPK();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setParts(fresh()); setReason(""); } }}>
      <DialogTrigger asChild>{trigger ?? <Button variant="ghost" size="sm"><CalendarClock /> Expiry &amp; batch</Button>}</DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Expiry date &amp; batch — {batch.qty} {unit}</DialogTitle>
          <DialogDescription>
            Type the expiry date printed on the box (and the batch / lot number if there is one). If these {batch.qty} {unit} don&apos;t all
            have the same date, split them — e.g. 6 expiring in January and 4 in March. The total stays {batch.qty}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {parts.map((p, i) => (
            <div key={i} className="grid grid-cols-[5rem_1fr_1fr_auto] items-end gap-2">
              <FormField label={i === 0 ? "How many" : ""}><Input inputMode="decimal" value={p.qty} className="tabular" onChange={(e) => set(i, { qty: e.target.value.replace(/[^\d.]/g, "") })} /></FormField>
              <FormField label={i === 0 ? "Expiry date" : ""}><Input type="date" value={p.expiry} onChange={(e) => set(i, { expiry: e.target.value })} /></FormField>
              <FormField label={i === 0 ? "Batch / lot no." : ""}><Input value={p.batch_no} placeholder="optional" onChange={(e) => set(i, { batch_no: e.target.value })} /></FormField>
              {split ? <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}><Trash2 /></Button> : <span className="w-9" />}
            </div>
          ))}
          <button type="button" className="justify-self-start text-sm font-semibold text-brand hover:underline"
            onClick={() => setParts((ps) => [...ps, { qty: left > 0 ? String(left) : "", expiry: "", batch_no: "" }])}>
            <Plus className="inline size-4" /> Some have a different expiry date — split
          </button>
          {split && <p className={left === 0 ? "text-sm text-success" : "text-sm text-danger"}>
            {left === 0 ? `Adds up to ${batch.qty} ✓` : left > 0 ? `${left} ${unit} still to place` : `${-left} ${unit} too many`}</p>}
          {parts.some((p) => p.expiry && p.expiry < today) && (
            <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">A date is in the past — that stock will count as <b>expired</b> and can&apos;t be sold. Remove it with “Remove / correct” → Expired.</p>
          )}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Note (optional) — e.g. read from the boxes" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || !ok} onClick={() => run(() => setBatchDetails(itemId, batch.id,
            parts.map((p) => ({ qty: Number(p.qty), expiry: p.expiry, batch_no: p.batch_no })), reason), () => setOpen(false))}>
            {pending && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
