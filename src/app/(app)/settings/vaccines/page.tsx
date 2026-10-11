import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProtocolCard, type Protocol } from "./protocol-card";

export const metadata: Metadata = { title: "Vaccine schedules" };

export default async function VaccineSchedulesPage() {
  const me = await requireStaff("clinical.view");
  const supabase = await createClient();
  const [{ data: protocols }, { data: vaccines }, { data: staff }] = await Promise.all([
    supabase.from("vaccination_protocols")
      .select("id, name, description, species_id, booster_interval_days, is_approved, approved_by, approved_at, is_active, species(name), vaccination_protocol_steps(step_no, label, vaccine_id, min_age_weeks, days_after_previous)")
      .order("name"),
    supabase.from("vaccines").select("id, name").eq("is_active", true).order("name"),
    supabase.from("staff").select("id, full_name"),
  ]);
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const list: Protocol[] = (protocols ?? []).map((p) => ({
    id: p.id, name: p.name, description: p.description, species_id: p.species_id,
    species_name: (p.species as unknown as { name: string } | null)?.name ?? null,
    booster_interval_days: p.booster_interval_days, is_approved: p.is_approved, is_active: p.is_active,
    approved_by_name: p.approved_by ? names.get(p.approved_by) ?? null : null, approved_at: p.approved_at,
    steps: ((p.vaccination_protocol_steps ?? []) as Protocol["steps"]).sort((a, b) => a.step_no - b.step_no),
  }));
  const canEdit = me.can("clinical.reopen");

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Vaccine schedules"
        description="Multi-dose schedules (e.g. Dose 1 → Dose 2 after N days → yearly booster). Used only to suggest the next date."
      />
      <div className="mb-6 flex gap-3 rounded-2xl bg-brand-wash p-4 ring-1 ring-brand-muted">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" />
        <div className="text-sm">
          <p className="font-semibold">Safety first</p>
          <p className="mt-1 text-muted-foreground">
            The schedules below are <b>examples</b> and start as drafts. Nothing is suggested to doctors until a senior
            doctor reviews the intervals and approves. Any change after approval turns it back into a draft.
            {!canEdit && " Only a senior doctor or the owner can change or approve schedules."}
          </p>
        </div>
      </div>
      <div className="grid gap-6">
        {list.map((p) => <ProtocolCard key={p.id} p={p} vaccines={vaccines ?? []} canEdit={canEdit} />)}
      </div>
    </>
  );
}
