"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatPKR } from "@/lib/format";
import { recordPayment } from "../../../billing/actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Payment towards the whole account (oldest bills first) or an advance/deposit when nothing is owed. */
export function PayBalance({ customerId, balance, methods }: { customerId: string; balance: number; methods: { key: string; label: string; needs_reference: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : "");
  const [method, setMethod] = useState("cash");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const k = useRef(newKey());
  const m = methods.find((x) => x.key === method);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="lg"><Wallet /> {balance > 0 ? "Receive payment" : "Take advance / deposit"}</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>{balance > 0 ? "Payment towards balance" : "Advance / deposit"}</DialogTitle>
          <DialogDescription>{balance > 0 ? "Pays the oldest unpaid bills first. Anything extra is kept as advance." : "E.g. a surgery deposit. It can be used on the next bill."}</DialogDescription>
        </DialogHeader>
        <Input className="h-12 text-right text-xl font-bold tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        <Select value={method} onValueChange={setMethod}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{methods.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent></Select>
        {m?.needs_reference && <Input placeholder={`${m.label} transaction ID`} value={ref} onChange={(e) => setRef(e.target.value)} />}
        <Input placeholder="Note (optional) — e.g. deposit for spay surgery" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <DialogFooter><Button disabled={pending || !(Number(amount) > 0) || (m?.needs_reference && !ref.trim())} onClick={() => start(async () => {
          const r = await recordPayment({ customer_id: customerId, amount: Number(amount), method, reference: ref, key: k.current, notes });
          if (r.ok) { toast.success(r.message); setOpen(false); k.current = newKey(); } else toast.error(r.message);
        })}>{pending && <Loader2 className="animate-spin" />} Save {formatPKR(Number(amount) || 0)}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
