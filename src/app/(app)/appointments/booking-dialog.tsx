"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, CalendarPlus, Check, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { formatTime, todayPK } from "@/lib/format";
import type { AppointmentTypeOption, DoctorOption } from "@/lib/queries";
import { searchCustomers, type CustomerOption } from "../customers/actions";
import { findConflicts, getCustomerPets, saveAppointment } from "./actions";

export type EditableAppointment = {
  id: string; customer: { id: string; title: string; subtitle: string }; pet_id: string | null; appointment_type_id: string;
  doctor_id: string | null; date: string; time: string; minutes: number; source: string; is_urgent: boolean;
  reason: string | null; pre_visit_instructions: string | null;
};

export function BookingDialog({ doctors, types, defaultDate, appointment, trigger }: {
  doctors: DoctorOption[]; types: AppointmentTypeOption[]; defaultDate: string;
  appointment?: EditableAppointment; trigger?: React.ReactNode;
}) {
  const a = appointment;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [customer, setCustomer] = useState<{ id: string; title: string; subtitle: string } | null>(a?.customer ?? null);
  const [pets, setPets] = useState<{ id: string; name: string; species: string | null }[]>([]);
  const [petId, setPetId] = useState(a?.pet_id ?? "none");
  const [typeId, setTypeId] = useState(a?.appointment_type_id ?? types[0]?.id ?? "");
  const [minutes, setMinutes] = useState(a?.minutes ?? types[0]?.default_minutes ?? 15);
  const [doctorId, setDoctorId] = useState(a?.doctor_id ?? "any");
  const [date, setDate] = useState(a?.date ?? defaultDate);
  const [time, setTime] = useState(a?.time ?? "");
  const [source, setSource] = useState(a?.source ?? "phone");
  const [urgent, setUrgent] = useState(a?.is_urgent ?? false);
  const [reason, setReason] = useState(a?.reason ?? "");
  const [instructions, setInstructions] = useState(a?.pre_visit_instructions ?? "");
  const [conflicts, setConflicts] = useState<{ id: string; starts_at: string; customer_name: string; pet_name: string | null }[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (customer) return;
    const t = setTimeout(async () => setOptions(await searchCustomers(q)), 250);
    return () => clearTimeout(t);
  }, [q, customer]);

  useEffect(() => {
    if (!customer) return;
    let live = true;
    getCustomerPets(customer.id).then((p) => {
      if (!live) return;
      setPets(p);
      setPetId((cur) => (cur !== "none" ? cur : p.length === 1 ? p[0].id : "none"));
    });
    return () => { live = false; };
  }, [customer]);

  useEffect(() => {
    const t = setTimeout(async () => setConflicts(await findConflicts(doctorId, date, time, minutes, a?.id)), 300);
    return () => clearTimeout(t);
  }, [doctorId, date, time, minutes, a?.id]);

  const pickType = (id: string) => {
    setTypeId(id);
    const t = types.find((x) => x.id === id);
    if (t && !a) setMinutes(t.default_minutes);
  };

  const submit = () => start(async () => {
    if (!customer) return;
    const r = await saveAppointment({
      id: a?.id, customer_id: customer.id, pet_id: petId, appointment_type_id: typeId, doctor_id: doctorId, date, time,
      minutes, source: source as "phone", is_urgent: urgent, reason, pre_visit_instructions: instructions,
    });
    if (r.ok) { toast.success(r.message); setOpen(false); if (!a) { setCustomer(null); setQ(""); setTime(""); setReason(""); setInstructions(""); setPetId("none"); } }
    else toast.error(r.message);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="lg"><CalendarPlus /> Book appointment</Button>}</DialogTrigger>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{a ? "Change appointment" : "Book an appointment"}</DialogTitle>
          <DialogDescription>Search the owner by name or phone number.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!customer ? (
            <div className="grid gap-2">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-9 text-base" placeholder="Owner name or phone" />
              </div>
              {options.map((o) => (
                <button key={o.id} type="button" onClick={() => setCustomer(o)} className="rounded-xl p-2.5 text-left hover:bg-muted">
                  <span className="block font-semibold">{o.title}</span>
                  <span className="block text-sm text-muted-foreground">{o.subtitle}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-brand-wash p-3 ring-1 ring-brand-muted">
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-gradient text-white"><Check className="size-4" /></span>
              <span className="min-w-0 flex-1"><b className="block">{customer.title}</b><span className="block truncate text-sm text-muted-foreground">{customer.subtitle}</span></span>
              {!a && <Button variant="ghost" size="sm" onClick={() => { setCustomer(null); setPets([]); setPetId("none"); }}>Change</Button>}
            </div>
          )}

          {customer && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Pet">
                  <Select value={petId} onValueChange={setPetId}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not registered yet</SelectItem>
                      {pets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.species ? ` (${p.species})` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Visit for">
                  <Select value={typeId} onValueChange={pickType}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{types.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
                <FormField label="Date">
                  <Input type="date" value={date} min={todayPK()} onChange={(e) => setDate(e.target.value)} />
                </FormField>
                <FormField label="Time">
                  <Input type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} />
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
                <FormField label="Length (minutes)">
                  <Input type="number" min={5} max={480} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
                </FormField>
                <FormField label="Booked by">
                  <Select value={source} onValueChange={setSource}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="phone">Phone call</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="in_person">In person</SelectItem>
                      <SelectItem value="online">Online</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <Label className="mt-6 font-normal"><Checkbox checked={urgent} onCheckedChange={(v) => setUrgent(v === true)} /> Urgent</Label>
              </div>

              {conflicts.length > 0 && (
                <div className="flex gap-2 rounded-xl bg-warning-soft p-3 text-sm text-warning ring-1 ring-warning/30">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    This doctor already has {conflicts.length === 1 ? "an appointment" : `${conflicts.length} appointments`} at this time:{" "}
                    {conflicts.map((c) => `${formatTime(c.starts_at)} ${c.pet_name ?? c.customer_name}`).join(", ")}. You can still book.
                  </span>
                </div>
              )}

              <FormField label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Second puppy vaccine" />
              </FormField>
              <FormField label="Instructions for the owner" hint="e.g. Don't feed after midnight before surgery">
                <Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
              </FormField>
            </>
          )}
        </div>

        <DialogFooter>
          <Button size="lg" disabled={!customer || !time || !date || pending} onClick={submit}>
            {pending && <Loader2 className="animate-spin" />} {a ? "Save changes" : "Book appointment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
