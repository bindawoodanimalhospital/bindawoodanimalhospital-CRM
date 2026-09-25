"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Clock, EllipsisVertical, Loader2, OctagonAlert, Stethoscope, UserRound, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/client";
import { NEXT_STEP, PRIORITY, VISIT_STAGES, VISIT_STATUS_LABEL, minutesSince, waitedFor, type VisitPriority, type VisitStatus } from "@/lib/clinic";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DoctorOption } from "@/lib/queries";
import { assignDoctor, cancelVisit, moveVisit } from "./actions";
import { BillVisitButton } from "../billing/bill-visit-button";

export type QueueVisit = {
  id: string; token_no: number; status: VisitStatus; priority: VisitPriority; reason: string | null;
  checked_in_at: string; status_changed_at: string; completed_at: string | null;
  pet: { id: string; name: string; species: string | null; special_handling: string | null };
  owner: { id: string; full_name: string };
  doctor: { id: string; full_name: string } | null;
  type: string | null;
};

export function QueueBoard({ visits, doctors, canManage, canClinical, canBill = false }: {
  visits: QueueVisit[]; doctors: DoctorOption[]; canManage: boolean; canClinical: boolean; canBill?: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());

  // Live: any change to today's visits (from any screen) refreshes the board.
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("queue-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "visits" }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 300);
      })
      .subscribe();
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => { clearInterval(tick); clearTimeout(timer); supabase.removeChannel(channel); };
  }, [router]);

  const active = visits.filter((v) => v.status !== "completed" && v.status !== "cancelled");
  const done = visits.filter((v) => v.status === "completed");
  const sort = (a: QueueVisit, b: QueueVisit) =>
    PRIORITY[a.priority].rank - PRIORITY[b.priority].rank || a.checked_in_at.localeCompare(b.checked_in_at);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {VISIT_STAGES.map((stage) => {
          const items = active.filter((v) => v.status === stage.status).sort(sort);
          return (
            <section key={stage.status} className="flex min-h-40 flex-col rounded-2xl bg-surface p-3 ring-1 ring-border">
              <header className="flex items-center gap-2 px-1 pb-3">
                <span className={cn("size-2.5 rounded-full", {
                  "bg-warning": stage.tone === "warning", "bg-brand": stage.tone === "brand",
                  "bg-info": stage.tone === "info", "bg-success": stage.tone === "success",
                })} />
                <h2 className="font-semibold">{stage.label}</h2>
                <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-sm font-bold tabular ring-1 ring-border">{items.length}</span>
              </header>
              <div className="grid gap-3">
                {items.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">{stage.hint}</p>}
                {items.map((v) => (
                  <VisitCard key={v.id} v={v} now={now} doctors={doctors} canManage={canManage} canClinical={canClinical} canBill={canBill} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {done.length > 0 && (
        <details className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
          <summary className="cursor-pointer font-semibold">Finished today ({done.length})</summary>
          <ul className="mt-3 divide-y">
            {done.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")).map((v) => (
              <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-10 font-mono font-bold text-muted-foreground">#{v.token_no}</span>
                <Link href={`/visits/${v.id}`} className="font-semibold hover:underline">{v.pet.name}</Link>
                <span className="text-muted-foreground">{v.owner.full_name}</span>
                <span className="ml-auto text-muted-foreground">{formatTime(v.completed_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function VisitCard({ v, now, doctors, canManage, canClinical, canBill }: {
  v: QueueVisit; now: Date; doctors: DoctorOption[]; canManage: boolean; canClinical: boolean; canBill: boolean;
}) {
  const [pending, start] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const next = NEXT_STEP[v.status];
  const waitingMins = minutesSince(v.status_changed_at, now);
  const longWait = v.status === "waiting" && waitingMins >= 30;

  const run = (fn: () => Promise<{ ok?: boolean; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.message); else if (res.message) toast.success(res.message);
    });

  return (
    <article className={cn("rounded-2xl bg-card p-4 shadow-card ring-1 ring-border transition",
      v.priority === "emergency" && "ring-2 ring-danger/60",
      v.priority === "urgent" && "ring-2 ring-warning/50")}>
      <div className="flex items-start gap-3">
        <div className={cn("flex size-12 shrink-0 flex-col items-center justify-center rounded-xl text-white",
          v.priority === "emergency" ? "bg-danger" : "bg-brand-gradient")}>
          <span className="text-[10px] leading-none font-semibold opacity-80">TOKEN</span>
          <span className="text-lg leading-tight font-bold tabular">{v.token_no}</span>
        </div>
        <div className="min-w-0 flex-1">
          <Link href={`/visits/${v.id}`} className="block truncate text-base font-bold hover:underline">{v.pet.name}</Link>
          <p className="truncate text-sm text-muted-foreground">{[v.pet.species, v.owner.full_name].filter(Boolean).join(" · ")}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions"><EllipsisVertical /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-xl">
            <DropdownMenuItem asChild><Link href={`/visits/${v.id}`}><Stethoscope /> Open visit</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href={`/pets/${v.pet.id}`}><UserRound /> Pet profile</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
            {VISIT_STAGES.filter((s) => s.status !== v.status).map((s) => (
              <DropdownMenuItem key={s.status} onSelect={() => run(() => moveVisit(v.id, s.status))}>{s.label}</DropdownMenuItem>
            ))}
            {canManage && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Assign doctor</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="rounded-xl">
                    <DropdownMenuItem onSelect={() => run(() => assignDoctor(v.id, null))}>Any doctor</DropdownMenuItem>
                    {doctors.map((d) => (
                      <DropdownMenuItem key={d.id} onSelect={() => run(() => assignDoctor(v.id, d.id))}>{d.full_name}</DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem variant="destructive" onSelect={() => setCancelOpen(true)}><X /> Remove from queue</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(v.pet.special_handling || v.priority !== "normal") && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {v.priority !== "normal" && <StatusPill tone={PRIORITY[v.priority].tone}>{PRIORITY[v.priority].label}</StatusPill>}
          {v.pet.special_handling && (
            <StatusPill tone="danger"><OctagonAlert className="mr-1 size-3" />{v.pet.special_handling}</StatusPill>
          )}
        </div>
      )}

      {v.reason && <p className="mt-3 line-clamp-2 text-sm">{v.reason}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className={cn("inline-flex items-center gap-1", longWait && "font-semibold text-danger")}>
          <Clock className="size-3.5" /> {waitedFor(v.status_changed_at, now)} {v.status === "waiting" ? "waiting" : `in ${VISIT_STATUS_LABEL[v.status].toLowerCase()}`}
        </span>
        {v.type && <span>{v.type}</span>}
        <span>{v.doctor ? v.doctor.full_name : "Any doctor"}</span>
      </div>

      {next && (canManage || canClinical) && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button className="flex-1" variant={v.status === "waiting" ? "default" : "outline"} disabled={pending}
            onClick={() => run(() => moveVisit(v.id, next.to))}>
            {pending ? <Loader2 className="animate-spin" /> : null} {next.label} {!pending && <ArrowRight />}
          </Button>
          {v.status === "ready_for_billing" && canBill && <BillVisitButton visitId={v.id} label="Make bill" className="flex-1" />}
          {v.status === "with_doctor" && (
            <Button variant="outline" disabled={pending} onClick={() => run(() => moveVisit(v.id, "in_treatment"))}>Tests</Button>
          )}
        </div>
      )}

      <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} petName={v.pet.name}
        onConfirm={(reason) => run(() => cancelVisit(v.id, reason))} />
    </article>
  );
}

function CancelDialog({ open, onOpenChange, petName, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; petName: string; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Remove {petName} from the queue?</DialogTitle>
          <DialogDescription>The visit is kept in the history as cancelled.</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason — e.g. owner left, checked in by mistake" rows={2} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3}
            onClick={() => { onConfirm(reason); onOpenChange(false); setReason(""); }}>Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
