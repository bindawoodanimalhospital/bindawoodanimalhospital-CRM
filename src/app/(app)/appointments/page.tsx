import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAppointmentTypes, getDoctors } from "@/lib/queries";
import { TIMEZONE, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BookingDialog } from "./booking-dialog";
import { AppointmentRow, type AgendaItem } from "./appointment-row";

export const metadata: Metadata = { title: "Appointments" };

const shift = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const pkDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(iso));
const pkTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIMEZONE }).format(new Date(iso));

export default async function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  const me = await requireStaff("appointments.view");
  const sp = await searchParams;
  const today = todayPK();
  const day = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const doctorFilter = typeof sp.doctor === "string" ? sp.doctor : "";

  // Week strip: Monday-based week containing the selected day.
  const dow = (new Date(`${day}T12:00:00+05:00`).getUTCDay() + 6) % 7;
  const weekStart = shift(day, -dow);
  const week = Array.from({ length: 7 }, (_, i) => shift(weekStart, i));

  const supabase = await createClient();
  let dayQuery = supabase.from("appointments")
    .select(`id, starts_at, ends_at, status, source, is_urgent, reason, pre_visit_instructions, visit_id, pet_id, doctor_id,
      appointment_type_id, customers(id, full_name, phone, whatsapp, area), pets(name), doctor:doctor_id(full_name), appointment_types(name, tone)`)
    .gte("starts_at", `${day}T00:00:00+05:00`).lt("starts_at", `${shift(day, 1)}T00:00:00+05:00`)
    .order("starts_at");
  if (doctorFilter) dayQuery = dayQuery.eq("doctor_id", doctorFilter);
  const [{ data }, { data: weekRows }, doctors, types] = await Promise.all([
    dayQuery,
    supabase.from("appointments").select("starts_at, status")
      .gte("starts_at", `${weekStart}T00:00:00+05:00`).lt("starts_at", `${shift(weekStart, 7)}T00:00:00+05:00`)
      .in("status", ["booked", "confirmed", "arrived", "completed"]),
    getDoctors(),
    getAppointmentTypes(),
  ]);

  const counts = new Map<string, number>();
  for (const r of weekRows ?? []) counts.set(pkDate(r.starts_at), (counts.get(pkDate(r.starts_at)) ?? 0) + 1);

  const items: AgendaItem[] = (data ?? []).map((a) => {
    const c = a.customers as unknown as { id: string; full_name: string; phone: string; whatsapp: string | null; area: string | null };
    const t = a.appointment_types as unknown as { name: string; tone: string };
    return {
      id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, status: a.status, visit_id: a.visit_id,
      customer: { id: c.id, title: c.full_name, subtitle: [c.phone, c.area].filter(Boolean).join(" · ") },
      pet_id: a.pet_id, pet_name: (a.pets as unknown as { name: string } | null)?.name ?? null,
      owner_phone: c.phone, owner_whatsapp: c.whatsapp, appointment_type_id: a.appointment_type_id,
      type_name: t.name, type_tone: t.tone, doctor_id: a.doctor_id,
      doctor_name: (a.doctor as unknown as { full_name: string } | null)?.full_name ?? null,
      date: pkDate(a.starts_at), time: pkTime(a.starts_at),
      minutes: Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000),
      source: a.source, is_urgent: a.is_urgent, reason: a.reason, pre_visit_instructions: a.pre_visit_instructions,
    };
  });

  const active = items.filter((i) => i.status !== "cancelled").length;
  const title = day === today ? "Today" : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE }).format(new Date(`${day}T12:00:00+05:00`));
  const qs = (d: string) => `?date=${d}${doctorFilter ? `&doctor=${doctorFilter}` : ""}`;

  return (
    <>
      <PageHeader
        title="Appointments"
        description={`${title} · ${active} appointment${active === 1 ? "" : "s"}`}
        actions={me.can("appointments.manage") && <BookingDialog doctors={doctors} types={types} defaultDate={day} />}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon" aria-label="Previous week"><Link href={qs(shift(weekStart, -7))}><ChevronLeft /></Link></Button>
          <Button asChild variant="outline" size="icon" aria-label="Next week"><Link href={qs(shift(weekStart, 7))}><ChevronRight /></Link></Button>
        </div>
        <div className="grid flex-1 grid-cols-7 gap-1.5">
          {week.map((d) => {
            const date = new Date(`${d}T12:00:00+05:00`);
            const n = counts.get(d) ?? 0;
            return (
              <Link key={d} href={qs(d)}
                className={cn("flex flex-col items-center rounded-xl py-2 ring-1 transition",
                  d === day ? "bg-brand-gradient text-white shadow-md shadow-brand/25 ring-transparent" : "bg-card ring-border hover:ring-brand-muted",
                  d === today && d !== day && "ring-2 ring-brand/40")}>
                <span className={cn("text-[11px] font-semibold uppercase", d === day ? "text-white/80" : "text-muted-foreground")}>
                  {new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: TIMEZONE }).format(date)}
                </span>
                <span className="text-lg font-bold tabular">{new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: TIMEZONE }).format(date)}</span>
                <span className={cn("text-[11px]", d === day ? "text-white/80" : "text-muted-foreground")}>{n ? `${n} booked` : "—"}</span>
              </Link>
            );
          })}
        </div>
        {day !== today && <Button asChild variant="ghost"><Link href={qs(today)}>Today</Link></Button>}
      </div>

      {doctors.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link href={`?date=${day}`} className={cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1", !doctorFilter ? "bg-ink text-white ring-ink" : "bg-card ring-border")}>All doctors</Link>
          {doctors.map((d) => (
            <Link key={d.id} href={`?date=${day}&doctor=${d.id}`}
              className={cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1", doctorFilter === d.id ? "bg-ink text-white ring-ink" : "bg-card ring-border")}>{d.full_name}</Link>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No appointments" description="Walk-ins are checked in from Today's queue." />
      ) : (
        <ul className="grid gap-3">
          {items.map((a) => (
            <AppointmentRow key={a.id} a={a} doctors={doctors} types={types}
              canManage={me.can("appointments.manage")} canCheckIn={me.can("queue.manage") && a.date === today} />
          ))}
        </ul>
      )}
    </>
  );
}
