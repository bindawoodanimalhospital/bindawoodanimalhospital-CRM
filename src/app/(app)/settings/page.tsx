import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Syringe } from "lucide-react";
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
        <Link href="/settings/vaccines" className="group flex items-center gap-4 rounded-2xl bg-brand-wash p-5 ring-1 ring-brand-muted transition hover:shadow-card">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white"><Syringe className="size-6" /></span>
          <span className="flex-1">
            <span className="block font-semibold">Vaccine schedules</span>
            <span className="block text-sm text-muted-foreground">Review and approve multi-dose vaccination schedules (senior doctor).</span>
          </span>
          <ArrowRight className="size-5 text-brand transition group-hover:translate-x-0.5" />
        </Link>
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
