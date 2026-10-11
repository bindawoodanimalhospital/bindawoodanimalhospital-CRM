"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { BedDouble, Check, Loader2, PawPrint, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { todayPK } from "@/lib/format";
import type { DoctorOption } from "@/lib/queries";
import { searchPets, type PetOption } from "../queue/actions";
import { admitPet } from "./actions";

export type KennelOption = { id: string; name: string; ward: string; occupied: boolean; is_isolation: boolean };
type Fixed = { pet_id: string; pet_name: string; customer_id: string; visit_id?: string; surgery_id?: string; reason?: string };

export function AdmitDialog({ kennels, doctors, fixed, defaultKennel, trigger }: {
  kennels: KennelOption[]; doctors: DoctorOption[]; fixed?: Fixed; defaultKennel?: string; trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PetOption[]>([]);
  const [pet, setPet] = useState<{ id: string; name: string; customer_id: string } | null>(
    fixed ? { id: fixed.pet_id, name: fixed.pet_name, customer_id: fixed.customer_id } : null);
  const [kennel, setKennel] = useState(defaultKennel ?? "none");
  const [doctor, setDoctor] = useState("none");
  const [reason, setReason] = useState(fixed?.reason ?? "");
  const [until, setUntil] = useState("");
  const [feeding, setFeeding] = useState("");
  const [care, setCare] = useState("");
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (pet || q.trim().length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => { const r = await searchPets(q); if (id === seq.current) setResults(r); }, 250);
    return () => clearTimeout(t);
  }, [q, pet]);

  const free = kennels.filter((k) => !k.occupied);
  const submit = () => start(async () => {
    if (!pet) return;
    const r = await admitPet({
      pet_id: pet.id, customer_id: pet.customer_id, visit_id: fixed?.visit_id, surgery_id: fixed?.surgery_id,
      kennel_id: kennel, attending_doctor_id: doctor, reason, expected_discharge_on: until, feeding_plan: feeding, care_notes: care,
    });
    if (r && !r.ok) toast.error(r.message);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="lg"><BedDouble /> Admit a pet</Button>}</DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Admit to ward</DialogTitle>
          <DialogDescription>For observation, treatment or recovery after surgery.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!pet ? (
            <div className="grid gap-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-9 text-base" placeholder="Pet name or owner's phone" />
              </div>
              {results.map((p) => (
                <button key={p.id} type="button" onClick={() => p.owners[0] && setPet({ id: p.id, name: p.name, customer_id: p.owners[0].id })}
                  className="flex items-center gap-3 rounded-xl p-2.5 text-left hover:bg-muted">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand"><PawPrint className="size-4" /></span>
                  <span><b className="block">{p.name}</b><span className="text-sm text-muted-foreground">{p.subtitle}</span></span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-brand-wash p-3 ring-1 ring-brand-muted">
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-gradient text-white"><Check className="size-4" /></span>
              <b className="flex-1">{pet.name}</b>
              {!fixed && <Button variant="ghost" size="sm" onClick={() => setPet(null)}>Change</Button>}
            </div>
          )}
          {pet && (
            <>
              <FormField label="Reason for stay" required>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Parvo — IV fluids & monitoring" />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Kennel / cage">
                  <Select value={kennel} onValueChange={setKennel}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Decide later</SelectItem>
                      {free.map((k) => <SelectItem key={k.id} value={k.id}>{k.name} · {k.ward}{k.is_isolation ? " (isolation)" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {free.length === 0 && <span className="text-xs text-warning">All kennels are occupied.</span>}
                </FormField>
                <FormField label="Doctor in charge">
                  <Select value={doctor} onValueChange={setDoctor}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Expected to go home">
                  <Input type="date" min={todayPK()} value={until} onChange={(e) => setUntil(e.target.value)} />
                </FormField>
              </div>
              <FormField label="Feeding plan"><Input value={feeding} onChange={(e) => setFeeding(e.target.value)} placeholder="e.g. Nothing by mouth 12 h, then soft food" /></FormField>
              <FormField label="Care / handling notes"><Input value={care} onChange={(e) => setCare(e.target.value)} placeholder="e.g. Cone on, bites when touched" /></FormField>
            </>
          )}
        </div>
        {pet && (
          <DialogFooter>
            <Button size="lg" disabled={pending || reason.trim().length < 3} onClick={submit}>
              {pending && <Loader2 className="animate-spin" />} Admit {pet.name}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
