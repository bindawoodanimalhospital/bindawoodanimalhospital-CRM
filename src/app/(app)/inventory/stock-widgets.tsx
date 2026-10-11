"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, Loader2, PackagePlus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import type { FormState } from "@/lib/validation";
import { addStockCount, adjustBatch, transferBatch } from "./actions";

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
      <DialogTrigger asChild><Button variant="ghost" size="sm"><SlidersHorizontal /> Adjust</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Batch {batch.batch_no || "(no batch)"} — {batch.qty} in stock</DialogTitle><DialogDescription>Every change is logged with your name and reason.</DialogDescription></DialogHeader>
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
