"use client";

import { useRef, useState, useTransition } from "react";
import { History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { todayPK } from "@/lib/format";
import { addPreviousBalance } from "../../../billing/actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * Money owed from before the CRM (old paper bills). Each entry keeps its original date and old
 * bill number, appears on this account and in Unpaid bills, and shows as "previous balance" on
 * the owner's next bills until it is paid.
 */
export function AddPreviousBalance({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const key = useRef(newKey());
  const save = (another: boolean) => start(async () => {
    const r = await addPreviousBalance(customerId, { amount: Number(amount), date, ref, note, key: key.current });
    if (!r.ok) { toast.error(r.message); return; }
    toast.success(r.message);
    key.current = newKey();
    setAmount(""); setRef(""); setNote("");
    if (!another) { setOpen(false); setDate(""); }
  });
  const ok = Number(amount) > 0 && !!date;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><History /> Add previous balance</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Previous balance (before the CRM)</DialogTitle>
          <DialogDescription>
            Money this pet owner already owed from the old register. Add one line per old bill, with its date. It shows on their next bills as
            “previous balance” until paid, and payments clear the oldest first.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Amount owed (Rs.)" required>
            <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="tabular" />
          </FormField>
          <FormField label="Date of the old bill / visit" required>
            <Input type="date" max={todayPK()} value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Old bill / register no." hint="Optional"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 412" /></FormField>
          <FormField label="Note" hint="Optional"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. surgery, Feb 2025" /></FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending || !ok} onClick={() => save(true)}>Save &amp; add another</Button>
          <Button disabled={pending || !ok} onClick={() => save(false)}>{pending && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
