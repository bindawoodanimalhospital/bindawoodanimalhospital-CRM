"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Loader2, Pencil, Truck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DeliveryStatus } from "@/lib/clinic";
import { formatPKR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";
import { collectAndDeliver, updateDelivery } from "../actions";

type Order = { id: string; number: string; status: DeliveryStatus; balance: number; address: string; charge: number; customerId: string | null; rider: string | null };
type Method = { key: string; label: string; needs_reference: boolean };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Next step for a home delivery order: dispatch → delivered (collecting cash on delivery), plus edits while allowed. */
export function DeliveryActions({ order, chargeLocked, canWaive, methods }: { order: Order; chargeLocked: boolean; canWaive: boolean; methods: Method[] }) {
  const [open, setOpen] = useState<"dispatch" | "deliver" | "edit" | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>) => start(async () => {
    const r = await fn();
    if (r.ok) { toast.success(r.message); setOpen(null); } else toast.error(r.message);
  });

  return (
    <>
      {order.status === "pending" && (
        <>
          <Button variant="outline" size="sm" onClick={() => setOpen("edit")}><Pencil /> Edit</Button>
          <Button size="sm" onClick={() => setOpen("dispatch")}><Truck /> Dispatch</Button>
        </>
      )}
      {order.status === "dispatched" && (
        <>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => updateDelivery(order.id, { status: "pending", note: "Not sent yet" }))}><Undo2 /> Not sent</Button>
          <Button size="sm" onClick={() => setOpen("deliver")}><Check /> Delivered</Button>
        </>
      )}

      {/* Mounted only while open, so each dialog starts from the order as it is NOW
          (e.g. the amount to collect after the delivery charge was changed). */}
      {open === "dispatch" && (
        <DispatchDialog open onOpenChange={(o) => setOpen(o ? "dispatch" : null)} order={order} pending={pending}
          onConfirm={(rider, note) => run(() => updateDelivery(order.id, { status: "dispatched", rider, note }))} />
      )}
      {open === "deliver" && (
        <DeliverDialog open onOpenChange={(o) => setOpen(o ? "deliver" : null)} order={order} pending={pending} methods={methods}
          onConfirm={(payment, key) => run(() => order.customerId
            ? collectAndDeliver(order.id, order.customerId, payment, key)
            : updateDelivery(order.id, { status: "delivered" }))} />
      )}
      {open === "edit" && (
        <EditDialog open onOpenChange={(o) => setOpen(o ? "edit" : null)} order={order} pending={pending}
          chargeLocked={chargeLocked} canWaive={canWaive}
          onConfirm={(patch) => run(() => updateDelivery(order.id, patch))} />
      )}
    </>
  );
}

function DispatchDialog({ open, onOpenChange, order, pending, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; order: Order; pending: boolean; onConfirm: (rider: string, note: string) => void;
}) {
  const [rider, setRider] = useState(order.rider ?? "");
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Send out {order.number}</DialogTitle>
          <DialogDescription>{order.address}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="rider">Who is taking it? <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="rider" value={rider} onChange={(e) => setRider(e.target.value)} placeholder="e.g. Ali (rider)" /></div>
          <div className="grid gap-1.5"><Label htmlFor="dnote">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="dnote" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          {order.balance > 0 && <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">Rider must collect <b>{formatPKR(order.balance)}</b>.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => onConfirm(rider, note)}>{pending ? <Loader2 className="animate-spin" /> : <Truck />} Out for delivery</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliverDialog({ open, onOpenChange, order, pending, methods, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; order: Order; pending: boolean; methods: Method[];
  onConfirm: (payment: { amount: number; method: string; reference?: string } | null, key: string) => void;
}) {
  const [collected, setCollected] = useState(order.balance > 0);
  const [amount, setAmount] = useState(String(order.balance));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const key = useRef(newKey());
  const m = methods.find((x) => x.key === method);
  const amt = Number(amount) || 0;
  const invalid = collected && (amt <= 0 || amt > order.balance || (m?.needs_reference && !reference.trim()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>{order.number} delivered</DialogTitle>
          <DialogDescription>{order.balance > 0 ? `${formatPKR(order.balance)} was still to be paid on this order.` : "This order is already paid."}</DialogDescription>
        </DialogHeader>
        {order.balance > 0 && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Was money collected?">
              {([[true, "Money collected"], [false, "Not paid yet"]] as const).map(([v, label]) => (
                <button key={label} type="button" role="radio" aria-checked={collected === v} onClick={() => setCollected(v)}
                  className={cn("h-9 rounded-lg text-sm font-semibold transition", collected === v ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground")}>{label}</button>
              ))}
            </div>
            {collected ? (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {methods.slice(0, 6).map((x) => (
                    <button key={x.key} type="button" onClick={() => setMethod(x.key)}
                      className={cn("h-10 rounded-xl text-sm font-semibold ring-1", method === x.key ? "bg-ink text-white ring-ink" : "bg-card ring-border")}>{x.label.split(" ")[0]}</button>
                  ))}
                </div>
                <div className="grid gap-1.5"><Label htmlFor="amt">Amount received (Rs.)</Label>
                  <Input id="amt" inputMode="decimal" className="text-right text-lg font-semibold tabular" value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /></div>
                {m?.needs_reference && <Input placeholder={`${m.label} transaction ID`} value={reference} onChange={(e) => setReference(e.target.value)} />}
                {amt > 0 && amt < order.balance && <p className="text-xs text-warning">{formatPKR(order.balance - amt)} stays on the customer&apos;s account as unpaid.</p>}
              </>
            ) : <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">The {formatPKR(order.balance)} stays on the customer&apos;s account (Unpaid bills) until they pay.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending || invalid} onClick={() => onConfirm(collected && order.balance > 0 ? { amount: amt, method, reference } : null, key.current)}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} {collected && order.balance > 0 ? `Record ${formatPKR(amt)} & mark delivered` : "Mark delivered"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ open, onOpenChange, order, pending, chargeLocked, canWaive, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; order: Order; pending: boolean; chargeLocked: boolean; canWaive: boolean;
  onConfirm: (patch: { charge?: number; address?: string; note?: string }) => void;
}) {
  const [address, setAddress] = useState(order.address);
  const [charge, setCharge] = useState(String(order.charge));
  const [note, setNote] = useState("");
  const c = Number(charge);
  const chargeChanged = !chargeLocked && charge.trim() !== "" && c !== order.charge;
  const problem = !address.trim() ? "Enter the address." : chargeChanged && c === 0 && !canWaive ? "Only staff who can give discounts can waive the charge." : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Edit delivery {order.number}</DialogTitle>
          <DialogDescription>Allowed until the order leaves the shop. Every change is kept in the history log.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="addr">Deliver to</Label>
            <Textarea id="addr" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="chg">Delivery charge (Rs.)</Label>
            <Input id="chg" inputMode="decimal" disabled={chargeLocked} value={charge} onChange={(e) => setCharge(e.target.value.replace(/[^\d.]/g, ""))} className="tabular" />
            {chargeLocked && <p className="text-xs text-muted-foreground">Money was already taken on this order, so the charge is locked. Use a refund on the bill if needed.</p>}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="enote">Reason / note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="enote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. farther than expected" /></div>
          {problem && <p className="text-xs text-danger">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={pending || !!problem} onClick={() => onConfirm({
            address: address.trim() !== order.address ? address.trim() : undefined,
            charge: chargeChanged ? c : undefined, note: note.trim() || undefined,
          })}>{pending && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
