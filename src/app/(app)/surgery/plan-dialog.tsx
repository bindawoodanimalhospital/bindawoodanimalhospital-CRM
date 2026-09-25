"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, PawPrint, Scissors, Search } from "lucide-react";
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
import { planSurgery } from "./actions";

export type ProcedureOption = { id: string; name: string; default_minutes: number | null };
type FixedPet = { pet_id: string; pet_name: string; customer_id: string; visit_id?: string; consultation_id?: string | null };

export function PlanSurgeryDialog({ procedures, doctors, fixed, trigger }: {
  procedures: ProcedureOption[]; doctors: DoctorOption[]; fixed?: FixedPet; trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PetOption[]>([]);
  const [pet, setPet] = useState<{ id: string; name: string; customer_id: string } | null>(
    fixed ? { id: fixed.pet_id, name: fixed.pet_name, customer_id: fixed.customer_id } : null);
  const [procedureId, setProcedureId] = useState("");
  const [procedureName, setProcedureName] = useState("");
  const [indication, setIndication] = useState("");
  const [urgency, setUrgency] = useState<"elective" | "urgent" | "emergency">("elective");
  const [surgeon, setSurgeon] = useState("none");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [estimate, setEstimate] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    if (pet || q.trim().length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => { const r = await searchPets(q); if (id === seq.current) setResults(r); }, 250);
    return () => clearTimeout(t);
  }, [q, pet]);

  const pickProcedure = (id: string) => {
    setProcedureId(id);
    const p = procedures.find((x) => x.id === id);
    if (p && p.name !== "Other procedure") setProcedureName(p.name); else setProcedureName("");
  };

  const submit = () => start(async () => {
    if (!pet) return;
    const r = await planSurgery({
      pet_id: pet.id, customer_id: pet.customer_id, visit_id: fixed?.visit_id, consultation_id: fixed?.consultation_id ?? undefined,
      procedure_id: procedureId, procedure_name: procedureName, indication, urgency, surgeon_id: surgeon,
      scheduled_date: date, scheduled_time: time, estimate_amount: estimate, pre_op_instructions: instructions,
    });
    if (r && !r.ok) toast.error(r.message);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="lg"><Scissors /> Plan a surgery</Button>}</DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Plan a surgery</DialogTitle>
          <DialogDescription>You can schedule it now or later. Consent and pre-op checks come before the operation.</DialogDescription>
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
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Procedure" required>
                  <Select value={procedureId} onValueChange={pickProcedure}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>{procedures.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
                <FormField label="Procedure name (as written on records)">
                  <Input value={procedureName} onChange={(e) => setProcedureName(e.target.value)} placeholder="e.g. Mass removal — left flank" />
                </FormField>
              </div>
              <FormField label="Why is it needed?">
                <Textarea rows={2} value={indication} onChange={(e) => setIndication(e.target.value)} placeholder="Clinical reason / indication" />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Urgency">
                  <Select value={urgency} onValueChange={(v) => setUrgency(v as typeof urgency)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="elective">Planned (elective)</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="emergency">Emergency</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Surgeon">
                  <Select value={surgeon} onValueChange={setSurgeon}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Decide later</SelectItem>
                      {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Estimate (Rs.)" hint="Told to the owner before consent">
                  <Input type="number" inputMode="numeric" min={0} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
                </FormField>
                <FormField label="Date (optional)">
                  <Input type="date" min={todayPK()} value={date} onChange={(e) => setDate(e.target.value)} />
                </FormField>
                <FormField label="Time">
                  <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
                </FormField>
              </div>
              <FormField label="Instructions for the owner before surgery" hint="e.g. No food after 10 pm, water until 6 am">
                <Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
              </FormField>
            </>
          )}
        </div>

        {pet && (
          <DialogFooter>
            <Button size="lg" disabled={pending || procedureName.trim().length < 2} onClick={submit}>
              {pending && <Loader2 className="animate-spin" />} Save plan
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
