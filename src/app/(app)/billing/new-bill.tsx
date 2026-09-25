"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { searchCustomers, type CustomerOption } from "../customers/actions";
import { createInvoice } from "./actions";

/** Start a bill for a customer (without a visit — e.g. medicine refill, old balance). */
export function NewBillButton({ customer, label = "New bill" }: { customer?: { id: string }; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => setOptions(await searchCustomers(q)), 250);
    return () => clearTimeout(t);
  }, [q, open]);
  const go = (id: string) => start(async () => { const r = await createInvoice(id); if (r && !r.ok) toast.error(r.message); });

  if (customer) return <Button disabled={pending} onClick={() => go(customer.id)}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} {label}</Button>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="lg"><Plus /> {label}</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>New bill</DialogTitle><DialogDescription>For a visit, use “Bill this visit” in the queue — it fills in the bill for you.</DialogDescription></DialogHeader>
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-9" placeholder="Customer name or phone" />
        </div>
        <ul className="grid gap-1">
          {options.map((o) => (
            <li key={o.id}><button type="button" disabled={pending} onClick={() => go(o.id)} className="w-full rounded-xl p-2.5 text-left hover:bg-muted">
              <b className="block">{o.title}</b><span className="text-sm text-muted-foreground">{o.subtitle}</span></button></li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
