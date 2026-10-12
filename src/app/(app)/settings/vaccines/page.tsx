import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ProtocolCard, type Protocol } from "./protocol-card";
import { VaccineList, type Vaccine } from "./vaccine-list";

export const metadata: Metadata = { title: "Vaccines & schedules" };

export default async function VaccineSchedulesPage() {
  const me = await requireStaff("clinical.view");
  const supabase = await createClient();
  const [{ data: protocols }, { data: vaccines }, { data: staff }, { data: allVaccines }, { data: species }] = await Promise.all([
    supabase.from("vaccination_protocols")
      .select("id, name, description, species_id, booster_interval_days, is_approved, approved_by, approved_at, is_active, species(name), vaccination_protocol_steps(step_no, label, vaccine_id, min_age_weeks, days_after_previous)")
      .order("name"),
    supabase.from("vaccines").select("id, name").eq("is_active", true).order("name"),
    supabase.from("staff").select("id, full_name"),
    supabase.from("vaccines").select("id, name, protects_against, species_ids, default_manufacturer, default_route, default_dose, is_active").order("is_active", { ascending: false }).order("name"),
    supabase.from("species").select("id, name").order("name"),
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
  const canEditVaccines = me.can("clinical.reopen") || me.can("settings.manage");

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Vaccines & schedules"
        description="The vaccines doctors can record, and the multi-dose schedules (Dose 1 → Dose 2 after N days → yearly booster) used to suggest the next date."
      />
      <div className="mb-6"><VaccineList vaccines={(allVaccines ?? []) as Vaccine[]} species={species ?? []} canEdit={canEditVaccines} /></div>
      <h2 className="mb-3 text-lg font-semibold">Schedules</h2>
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
