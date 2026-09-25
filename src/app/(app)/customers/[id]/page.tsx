import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarDays, MessageCircle, Pencil, PawPrint, Phone, Plus, Receipt, Syringe, TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatAge, formatDate, formatDateTime } from "@/lib/format";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { MergeCustomerDialog } from "./merge-dialog";

export async function generateMetadata({ params }: PageProps<"/customers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("full_name").eq("id", id).maybeSingle();
  return { title: data?.full_name ?? "Customer" };
}

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", call: "Phone call", sms: "SMS", email: "Email" };

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const me = await requireStaff("customers.view");
  const { id } = await params;
  const supabase = await createClient();

  const { data: c } = await supabase
    .from("customers")
    .select(`*, merged_into:merged_into_id(id, full_name),
      pet_owners(is_primary, relationship,
        pets(id, code, name, sex, date_of_birth, dob_is_estimate, status, special_handling, breed_text,
             species(name), breeds(name), pet_alerts(label, severity, is_active)))`)
    .eq("id", id)
    .maybeSingle();
  if (!c) notFound();

  type PetRow = {
    id: string; code: string; name: string; sex: string; date_of_birth: string | null; dob_is_estimate: boolean;
    status: string; special_handling: string | null; breed_text: string | null;
    species: { name: string } | null; breeds: { name: string } | null;
    pet_alerts: { label: string; severity: string; is_active: boolean }[];
  };
  const pets: (PetRow & { is_primary: boolean })[] = ((c.pet_owners ?? []) as { is_primary: boolean; pets: PetRow | null }[])
    .flatMap((po) => (po.pets ? [{ ...po.pets, is_primary: po.is_primary }] : []))
    .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1));

  const wa = whatsappLink(c.whatsapp);
  const mergedInto = c.merged_into as { id: string; full_name: string } | null;

  return (
    <>
      <Suspense><NoticeToast /></Suspense>
      <PageHeader
        back={{ href: "/customers", label: "Customers" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.full_name}
            {c.full_name_ur && <span dir="rtl" lang="ur" className="text-lg font-normal text-muted-foreground">{c.full_name_ur}</span>}
            <span className="font-mono text-sm font-normal text-muted-foreground">{c.code}</span>
            {c.status !== "active" && <StatusPill tone="warning">{c.status}</StatusPill>}
          </span>
        }
        description={`Customer since ${formatDate(c.created_at)}`}
        actions={
          <>
            <Button asChild variant="outline"><a href={`tel:${c.phone}`}><Phone /> Call</a></Button>
            {wa && <Button asChild variant="outline"><a href={wa} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a></Button>}
            {me.can("customers.edit") && c.status !== "merged" && (
              <Button asChild variant="outline"><Link href={`/customers/${c.id}/edit`}><Pencil /> Edit</Link></Button>
            )}
            {me.can("customers.merge") && c.status !== "merged" && <MergeCustomerDialog source={{ id: c.id, name: c.full_name }} />}
          </>
        }
      />

      {mergedInto && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm">
          <TriangleAlert className="size-4 text-warning" />
          This record was merged into
          <Link href={`/customers/${mergedInto.id}`} className="font-medium underline underline-offset-2">{mergedInto.full_name}</Link>.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: contact profile */}
        <Card className="lg:row-span-2">
          <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Mobile">{formatPhone(c.phone)}</Field>
              <Field label="WhatsApp">{formatPhone(c.whatsapp)}</Field>
              <Field label="Alternate">{formatPhone(c.alt_phone)}</Field>
              <Field label="Prefers">{CHANNEL[c.preferred_channel]}</Field>
              <Field label="Email" className="col-span-2">{c.email}</Field>
              <Field label="Area">{c.area}</Field>
              <Field label="City">{c.city}</Field>
              <Field label="Address" className="col-span-2">{c.address}</Field>
              <Field label="Found us via">{c.referral_source}</Field>
              <Field label="Campaign messages">{c.marketing_opt_in ? "Opted in" : "No"}</Field>
            </dl>
            {c.notes && (
              <div className="mt-4 rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">{c.notes}</div>
            )}
          </CardContent>
        </Card>

        {/* Right: pets */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pets <span className="font-normal text-muted-foreground">({pets.length})</span></CardTitle>
            {me.can("pets.create") && c.status !== "merged" && (
              <CardAction>
                <Button asChild size="sm" variant="outline"><Link href={`/pets/new?customer=${c.id}`}><Plus /> Add pet</Link></Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {pets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pets registered yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {pets.map((p) => {
                  const alerts = (p.pet_alerts ?? []).filter((a) => a.is_active);
                  return (
                    <Link key={p.id} href={`/pets/${p.id}`}
                      className="group rounded-lg border p-3 transition-colors hover:border-foreground/25">
                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                          <PawPrint className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{p.name}</span>
                            {p.status !== "active" && <StatusPill>{p.status}</StatusPill>}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {[p.species?.name, p.breeds?.name ?? p.breed_text, p.sex !== "unknown" ? p.sex : null,
                              formatAge(p.date_of_birth, p.dob_is_estimate)].filter(Boolean).join(" · ")}
                          </p>
                          {(alerts.length > 0 || p.special_handling) && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {p.special_handling && <StatusPill tone="danger">{p.special_handling}</StatusPill>}
                              {alerts.map((a) => (
                                <StatusPill key={a.label} tone={a.severity === "critical" ? "danger" : "warning"}>{a.label}</StatusPill>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Placeholders for modules arriving in later phases — keeps the 360 layout stable. */}
        <div className="grid gap-6 sm:grid-cols-3 lg:col-span-2">
          {[
            { title: "Balance", icon: Receipt, text: "Invoices, dues & ledger arrive in Phase 4." },
            { title: "Appointments", icon: CalendarDays, text: "Upcoming visits arrive in Phase 2." },
            { title: "Vaccinations due", icon: Syringe, text: "Due & overdue doses arrive in Phase 2." },
          ].map((b) => (
            <Card key={b.title} className="border-dashed shadow-none">
              <CardContent>
                <b.icon className="mb-2 size-4 text-muted-foreground" />
                <p className="text-sm font-medium">{b.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{b.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">Last updated {formatDateTime(c.updated_at)}</p>
    </>
  );
}
