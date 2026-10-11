import Link from "next/link";
import { CalendarClock, MessageCircle, PawPrint, Wallet, type LucideIcon } from "lucide-react";
import type { OwnerEvent, OwnerHistory } from "@/lib/owner-history";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const rs = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-PK")}`;
const ICON: Record<OwnerEvent["kind"], LucideIcon> = { appointment: CalendarClock, payment: Wallet, contact: MessageCircle };
const TONE: Record<OwnerEvent["tone"], string> = {
  success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info", neutral: "bg-muted text-muted-foreground",
};

/** Totals across the owner's whole relationship with the clinic. */
export function OwnerSummary({ h, showMoney }: { h: OwnerHistory; showMoney: boolean }) {
  const s = h.summary;
  const tiles: [string, string, boolean?][] = [
    ["Pets", String(h.pets.length)],
    ["Clinic visits", String(s.visits)],
    ["First visit", s.firstAt ? formatDate(s.firstAt) : "—"],
    ["Last visit", s.lastAt ? formatDate(s.lastAt) : "—"],
    ["Appointments", `${h.extra.appointments}${h.extra.missed ? ` (${h.extra.missed} missed)` : ""}`, h.extra.missed > 0],
    ["Calls & messages", String(h.extra.contacts)],
    ...(showMoney ? [["Total billed", rs(s.billed)], ["Still owed", rs(s.owed), s.owed > 0]] as [string, string, boolean][] : []),
  ];
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
        {tiles.map(([k, v, bad]) => (
          <div key={k} className="rounded-xl bg-surface p-3 ring-1 ring-border print:p-2">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className={cn("text-lg font-bold tabular-nums print:text-sm", bad && "text-danger")}>{v}</p>
          </div>
        ))}
      </div>
      {(s.doctors.length > 0 || s.medicines.length > 0) && (
        <div className="grid gap-1 text-sm">
          {s.doctors.length > 0 && <p><span className="text-muted-foreground">Seen by:</span> {s.doctors.join(", ")}</p>}
          {s.medicines.length > 0 && <p><span className="text-muted-foreground">Medicines prescribed to their pets:</span> {s.medicines.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}

/** One card per pet the owner has (or had), with visit count and a link to that pet's own history. */
export function OwnerPets({ h, print }: { h: OwnerHistory; print?: boolean }) {
  if (!h.pets.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
      {h.pets.map((p) => {
        const body = (
          <>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand print:hidden"><PawPrint className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-semibold">
                <span className="truncate print:whitespace-normal">{p.name}</span>
                {p.status !== "active" && <span className="rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">{p.status}</span>}
              </span>
              <span className="block truncate text-xs text-muted-foreground print:whitespace-normal">
                {[p.species, p.code, `${p.visits} visit${p.visits === 1 ? "" : "s"}`, p.lastAt && `last ${formatDate(p.lastAt)}`].filter(Boolean).join(" · ")}
              </span>
            </span>
          </>
        );
        return print
          ? <div key={p.id} className="flex items-center gap-3 rounded-xl p-2 ring-1 ring-border">{body}</div>
          : <Link key={p.id} href={`/pets/${p.id}/history`} className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 ring-border transition hover:ring-brand-muted">{body}</Link>;
      })}
    </div>
  );
}

/** Appointment / payment / call row in the owner's timeline. */
export function OwnerEventRow({ e, print }: { e: OwnerEvent; print?: boolean }) {
  const Icon = ICON[e.kind];
  const inner = (
    <>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg print:hidden", TONE[e.tone])}><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
          {e.petName && <span className="rounded-full bg-brand-soft px-2 text-xs text-brand print:bg-transparent print:px-0">{e.petName}</span>}
          {e.title}
        </span>
        {e.detail && <span className={cn("block text-xs text-muted-foreground", !print && "line-clamp-2")}>{e.detail}</span>}
        {e.by && <span className="block text-xs text-muted-foreground">{e.by}</span>}
      </span>
      <span className="shrink-0 text-right text-xs text-muted-foreground">
        <span className="block font-semibold text-foreground">{formatDate(e.at)}</span>{formatTime(e.at)}
      </span>
    </>
  );
  const cls = print ? "flex items-start gap-3 border-b py-2 break-inside-avoid" : "flex items-start gap-3 rounded-2xl bg-card px-4 py-3 shadow-card ring-1 ring-border";
  return e.href && !print ? <Link href={e.href} className={cn(cls, "transition hover:ring-brand-muted")}>{inner}</Link> : <div className={cls}>{inner}</div>;
}
