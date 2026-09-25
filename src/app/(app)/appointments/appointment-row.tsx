"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleCheck, EllipsisVertical, Loader2, LogIn, MessageCircle, Pencil, Phone, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/app/page-header";
import { APPOINTMENT_STATUS } from "@/lib/clinic";
import { formatTime } from "@/lib/format";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { AppointmentTypeOption, DoctorOption } from "@/lib/queries";
import { BookingDialog, type EditableAppointment } from "./booking-dialog";
import { cancelAppointment, checkInAppointment, setAppointmentStatus } from "./actions";

export type AgendaItem = EditableAppointment & {
  starts_at: string; ends_at: string; status: string; visit_id: string | null;
  pet_name: string | null; owner_phone: string; owner_whatsapp: string | null; type_name: string; type_tone: string; doctor_name: string | null;
};

export function AppointmentRow({ a, doctors, types, canManage, canCheckIn }: {
  a: AgendaItem; doctors: DoctorOption[]; types: AppointmentTypeOption[]; canManage: boolean; canCheckIn: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const status = APPOINTMENT_STATUS[a.status];
  const open = a.status === "booked" || a.status === "confirmed";
  const wa = whatsappLink(a.owner_whatsapp, `Assalam o Alaikum ${a.customer.title}, this is Bin Dawood Animal Hospital. A reminder of ${a.pet_name ?? "your pet"}'s appointment at ${formatTime(a.starts_at)}.`);

  const run = (fn: () => Promise<{ ok?: boolean; message?: string; visitId?: string }>, goToVisit = false) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.message); return; }
      if (r.message) toast.success(r.message);
      if (goToVisit && r.visitId) router.push("/queue");
    });

  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border",
      (a.status === "cancelled" || a.status === "no_show") && "opacity-60", a.is_urgent && open && "ring-2 ring-warning/50")}>
      <div className="w-20 shrink-0">
        <p className="text-lg font-bold tabular">{formatTime(a.starts_at)}</p>
        <p className="text-xs text-muted-foreground">to {formatTime(a.ends_at)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {a.pet_name ?? <span className="text-muted-foreground">Pet not registered</span>}
          <span className="font-normal text-muted-foreground"> · {a.customer.title}</span>
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {[a.type_name, a.doctor_name ?? "Any doctor", a.reason].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {a.is_urgent && open && <StatusPill tone="warning">Urgent</StatusPill>}
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        {canCheckIn && open && (
          <Button disabled={pending || !a.pet_id} title={!a.pet_id ? "Register the pet first" : undefined}
            onClick={() => run(() => checkInAppointment(a.id), true)}>
            {pending ? <Loader2 className="animate-spin" /> : <LogIn />} Arrived — check in
          </Button>
        )}
        {a.status === "arrived" && a.visit_id && (
          <Button asChild variant="outline"><Link href={`/visits/${a.visit_id}`}><CircleCheck /> Open visit</Link></Button>
        )}
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><EllipsisVertical /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl">
              <DropdownMenuItem asChild><a href={`tel:${a.owner_phone}`}><Phone /> Call {formatPhone(a.owner_phone)}</a></DropdownMenuItem>
              {wa && <DropdownMenuItem asChild><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp reminder</a></DropdownMenuItem>}
              {open && (
                <>
                  <DropdownMenuSeparator />
                  {a.status === "booked" && <DropdownMenuItem onSelect={() => run(() => setAppointmentStatus(a.id, "confirmed"))}><Check /> Mark confirmed</DropdownMenuItem>}
                  <BookingDialog doctors={doctors} types={types} defaultDate={a.date} appointment={a}
                    trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()}><Pencil /> Change time / details</DropdownMenuItem>} />
                  <DropdownMenuItem onSelect={() => run(() => setAppointmentStatus(a.id, "no_show"))}><UserX /> Didn&apos;t come (no-show)</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setCancelOpen(true)}><X /> Cancel appointment</DropdownMenuItem>
                </>
              )}
              {a.status === "no_show" && (
                <DropdownMenuItem onSelect={() => run(() => setAppointmentStatus(a.id, "booked"))}>Undo no-show</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Cancel this appointment?</DialogTitle>
            <DialogDescription>It stays in the history with your reason.</DialogDescription>
          </DialogHeader>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner called to cancel" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep</Button>
            <Button variant="destructive" disabled={reason.trim().length < 3 || pending}
              onClick={() => { run(() => cancelAppointment(a.id, reason)); setCancelOpen(false); setReason(""); }}>Cancel appointment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
