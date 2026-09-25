import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { ClinicProfileForm, SpeciesManager } from "./widgets";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireStaff("settings.manage");
  const supabase = await createClient();
  const [profile, { data: species }] = await Promise.all([
    getSetting<Record<string, string>>("clinic.profile"),
    supabase.from("species").select("id, name, breeds(id, name, is_active)").order("sort_order")
      .order("name", { referencedTable: "breeds" }),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Clinic configuration. Every change is recorded in the audit log." />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Clinic profile</CardTitle>
            <CardDescription>Printed on invoices, prescriptions and vaccination certificates.</CardDescription>
          </CardHeader>
          <CardContent><ClinicProfileForm profile={profile ?? {}} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Species & breeds</CardTitle>
            <CardDescription>What reception can pick when registering a pet. Hidden breeds stay on existing records.</CardDescription>
          </CardHeader>
          <CardContent><SpeciesManager species={species ?? []} /></CardContent>
        </Card>
      </div>
    </>
  );
}
