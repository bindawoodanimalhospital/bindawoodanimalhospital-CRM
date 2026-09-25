"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, Plus, Star, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { useFormAction } from "@/hooks/use-form-action";
import { searchCustomers, type CustomerOption } from "../../customers/actions";
import { addAlert, addOwner, addWeight, makePrimaryOwner, resolveAlert } from "../actions";

export function WeightForm({ petId }: { petId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const { pending, onSubmit, errors } = useFormAction(addWeight.bind(null, petId), {
    onSuccess: () => ref.current?.reset(),
  });
  return (
    <form ref={ref} onSubmit={onSubmit} className="flex items-start gap-2">
      <div className="grid gap-1">
        <Input name="weight_kg" type="number" step="0.01" min="0" inputMode="decimal" placeholder="kg" className="w-24"
          aria-invalid={!!errors.weight_kg} />
      </div>
      <Input name="note" placeholder="Note (optional)" className="flex-1" />
      <Button type="submit" size="icon" variant="outline" disabled={pending} aria-label="Record weight">
        {pending ? <Loader2 className="animate-spin" /> : <Plus />}
      </Button>
    </form>
  );
}

export function AlertForm({ petId }: { petId: string }) {
  const [open, setOpen] = useState(false);
  const { pending, onSubmit, errors } = useFormAction(addAlert.bind(null, petId), {
    onSuccess: () => setOpen(false),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus /> Add</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add alert</DialogTitle>
          <DialogDescription>Allergies, chronic conditions and handling warnings appear on every screen for this pet.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" id="alert-form">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Type">
              <Select name="kind" defaultValue="allergy">
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allergy">Allergy</SelectItem>
                  <SelectItem value="condition">Chronic condition</SelectItem>
                  <SelectItem value="behaviour">Behaviour / handling</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Severity">
              <Select name="severity" defaultValue="warning">
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="Alert" htmlFor="label" error={errors.label} required>
            <Input id="label" name="label" placeholder="e.g. Penicillin allergy" />
          </FormField>
          <FormField label="Notes" htmlFor="notes">
            <Input id="notes" name="notes" />
          </FormField>
        </form>
        <DialogFooter>
          <Button type="submit" form="alert-form" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save alert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResolveAlertButton({ petId, alertId }: { petId: string; alertId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="icon-xs" variant="ghost" title="Mark resolved" disabled={pending}
      onClick={() => start(() => resolveAlert(petId, alertId))}>
      {pending ? <Loader2 className="animate-spin" /> : <Check />}
    </Button>
  );
}

export function MakePrimaryButton({ petId, customerId }: { petId: string; customerId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="icon-xs" variant="ghost" title="Make primary owner" disabled={pending}
      onClick={() => start(() => makePrimaryOwner(petId, customerId))}>
      {pending ? <Loader2 className="animate-spin" /> : <Star />}
    </Button>
  );
}

export function AddOwnerDialog({ petId, existing }: { petId: string; existing: string[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [relationship, setRelationship] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    const t = setTimeout(async () => setOptions((await searchCustomers(q)).filter((o) => !existing.includes(o.id))), 250);
    return () => clearTimeout(t);
  }, [q, existing]);

  const pick = (o: CustomerOption) =>
    start(async () => {
      const res = await addOwner(petId, o.id, relationship || null);
      if (res.ok) { toast.success(res.message); setOpen(false); } else toast.error(res.message);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><UserPlus /> Add</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add another owner</DialogTitle>
          <DialogDescription>For family members who also bring this pet in. They must already be a customer.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder="Relationship (e.g. Brother, Wife)" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer by name or phone…" autoFocus />
          <ul className="max-h-56 overflow-auto rounded-lg border empty:hidden">
            {options.map((o) => (
              <li key={o.id}>
                <button type="button" disabled={pending} onClick={() => pick(o)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                  <span className="font-medium">{o.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{o.subtitle}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
