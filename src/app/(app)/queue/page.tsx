import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAppointmentTypes, getDoctors } from "@/lib/queries";
import { TIMEZONE, todayPK } from "@/lib/format";
import { CheckInDialog } from "./check-in-dialog";
import { QueueBoard, type QueueVisit } from "./queue-board";

export const metadata: Metadata = { title: "Today's queue" };

export default async function QueuePage() {
  const me = await requireStaff();
  if (!me.can("queue.manage") && !me.can("clinical.view")) redirect("/dashboard?denied=1");
  const supabase = await createClient();
  const [{ data }, doctors, types] = await Promise.all([
    supabase.from("visits")
      .select(`id, token_no, status, priority, reason, checked_in_at, status_changed_at, completed_at,
        pets(id, name, special_handling, species(name)), customers(id, full_name),
        doctor:doctor_id(id, full_name), appointment_types(name)`)
      .eq("visit_date", todayPK())
      .neq("status", "cancelled")
      .order("checked_in_at"),
    getDoctors(),
    getAppointmentTypes(),
  ]);

  const visits: QueueVisit[] = (data ?? []).map((v) => {
    const pet = v.pets as unknown as { id: string; name: string; special_handling: string | null; species: { name: string } | null };
    return {
      id: v.id, token_no: v.token_no, status: v.status, priority: v.priority, reason: v.reason,
      checked_in_at: v.checked_in_at, status_changed_at: v.status_changed_at, completed_at: v.completed_at,
      pet: { id: pet.id, name: pet.name, species: pet.species?.name ?? null, special_handling: pet.special_handling },
      owner: v.customers as unknown as { id: string; full_name: string },
      doctor: v.doctor as unknown as { id: string; full_name: string } | null,
      type: (v.appointment_types as unknown as { name: string } | null)?.name ?? null,
    };
  });
  const waiting = visits.filter((v) => v.status === "waiting").length;
  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE }).format(new Date());

  return (
    <>
      <PageHeader
        title="Today's queue"
        description={`${dateLine} · ${waiting} waiting · updates live on every screen`}
        actions={me.can("queue.manage") && <CheckInDialog doctors={doctors} types={types} />}
      />
      <QueueBoard visits={visits} doctors={doctors} canManage={me.can("queue.manage")} canClinical={me.can("clinical.create")} canBill={me.can("billing.create")} />
    </>
  );
}
