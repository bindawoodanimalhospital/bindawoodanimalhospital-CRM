"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Loader2, PawPrint, Plus, Search, Siren, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { cn } from "@/lib/utils";
import type { AppointmentTypeOption, DoctorOption } from "@/lib/queries";
import { checkInWalkIn, searchPets, type PetOption } from "./actions";

const PRIORITIES = [
  { value: "normal", label: "Normal", cls: "data-[on=true]:bg-ink data-[on=true]:text-white" },
  { value: "urgent", label: "Urgent", cls: "data-[on=true]:bg-warning data-[on=true]:text-white" },
  { value: "emergency", label: "Emergency", cls: "data-[on=true]:bg-danger data-[on=true]:text-white" },
] as const;

export function CheckInDialog({ doctors, types, trigger }: {
  doctors: DoctorOption[]; types: AppointmentTypeOption[]; trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PetOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [pet, setPet] = useState<PetOption | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent" | "emergency">("normal");
  const [doctorId, setDoctorId] = useState("any");
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (pet || q.trim().length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await searchPets(q);
      if (id === seq.current) { setResults(r); setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, pet]);

  const reset = () => {
    setQ(""); setResults([]); setPet(null); setOwnerId(""); setPriority("normal"); setDoctorId("any"); setReason("");
    setTypeId(types[0]?.id ?? "");
  };

  const choose = (p: PetOption) => { setPet(p); setOwnerId(p.owners[0]?.id ?? ""); };

  const submit = () =>
    start(async () => {
      if (!pet) return;
      const res = await checkInWalkIn({
        pet_id: pet.id, customer_id: ownerId, reason, priority, doctor_id: doctorId, visit_type_id: typeId,
      });
      if (res.ok) {
        toast.success(res.message, { description: `${pet.name} is now in the queue.` });
        setOpen(false); reset();
      } else toast.error(res.message);
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="lg"><Plus /> Check in a pet</Button>}
      </DialogTrigger>
      <DialogContent className="rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Check in a pet</DialogTitle>
          <DialogDescription>For walk-ins. Appointments are checked in from the Appointments page.</DialogDescription>
        </DialogHeader>

        {!pet ? (
          <div className="grid gap-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-9 text-base"
                placeholder="Pet name or owner's phone number" />
            </div>
            <div className="grid max-h-72 gap-1 overflow-auto">
              {searching && <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Searching…</p>}
              {!searching && results.map((p) => (
                <button key={p.id} type="button" onClick={() => choose(p)}
                  className="flex items-center gap-3 rounded-xl p-2.5 text-left hover:bg-muted">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand"><PawPrint className="size-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{p.name}</span>
                    <span className="block truncate text-sm text-muted-foreground">{p.subtitle}</span>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                </button>
              ))}
              {!searching && q.trim().length >= 2 && results.length === 0 && (
                <div className="rounded-xl bg-muted/60 p-4 text-center text-sm">
                  <p>No pet found. Is this a new customer?</p>
                  <Button asChild variant="outline" size="sm" className="mt-3">
                    <Link href="/customers/new"><UserPlus /> Register new owner + pet</Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex items-center gap-3 rounded-xl bg-brand-wash p-3 ring-1 ring-brand-muted">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-gradient text-white"><Check className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{pet.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{pet.subtitle}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPet(null)}>Change</Button>
            </div>

            {pet.owners.length > 1 && (
              <FormField label="Who brought the pet?">
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{pet.owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}{o.is_primary ? " (main owner)" : ""}</SelectItem>)}</SelectContent>
                </Select>
              </FormField>
            )}

            <FormField label="How urgent?">
              <div className="grid grid-cols-3 gap-2">
                {PRIORITIES.map((p) => (
                  <button key={p.value} type="button" data-on={priority === p.value} onClick={() => setPriority(p.value)}
                    className={cn("flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition", p.cls)}>
                    {p.value === "emergency" && <Siren className="size-4" />} {p.label}
                  </button>
                ))}
              </div>
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Visit for">
                <Select value={typeId} onValueChange={setTypeId}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </FormField>
              <FormField label="Doctor">
                <Select value={doctorId} onValueChange={setDoctorId}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any doctor</SelectItem>
                    {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField label="Reason (what the owner says)">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Not eating since 2 days, vomiting" />
            </FormField>
          </div>
        )}

        {pet && (
          <DialogFooter>
            <Button size="lg" className="w-full sm:w-auto" disabled={pending || !ownerId} onClick={submit}>
              {pending && <Loader2 className="animate-spin" />} Check in {pet.name}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
