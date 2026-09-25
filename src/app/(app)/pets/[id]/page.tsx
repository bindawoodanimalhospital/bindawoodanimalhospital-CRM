import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, MessageCircle, OctagonAlert, Pencil, PawPrint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatAge, formatDate, formatDateTime } from "@/lib/format";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { AddOwnerDialog, AlertForm, MakePrimaryButton, ResolveAlertButton, WeightForm } from "./widgets";

export async function generateMetadata({ params }: PageProps<"/pets/[id]">): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("pets").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Pet" };
}

const KIND_LABEL: Record<string, string> = { allergy: "Allergy", condition: "Condition", behaviour: "Handling", other: "Note" };

export default async function PetPage({ params }: PageProps<"/pets/[id]">) {
  const me = await requireStaff("pets.view");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: p }, { data: weights }, { data: alerts }] = await Promise.all([
    supabase.from("pets")
      .select(`*, species(name), breeds(name),
        pet_owners(is_primary, relationship, customers(id, code, full_name, phone, whatsapp))`)
      .eq("id", id).maybeSingle(),
    supabase.from("pet_weights").select("id, weight_kg, measured_at, note").eq("pet_id", id)
      .order("measured_at", { ascending: false }).limit(12),
    supabase.from("pet_alerts").select("id, kind, label, severity, notes, created_at").eq("pet_id", id)
      .eq("is_active", true).order("severity", { ascending: false }),
  ]);
  if (!p) notFound();

  const species = p.species as { name: string } | null;
  const breed = p.breeds as { name: string } | null;
  type Owner = { is_primary: boolean; relationship: string | null;
    customers: { id: string; code: string; full_name: string; phone: string; whatsapp: string | null } };
  const owners = ((p.pet_owners ?? []) as Owner[]).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const latest = weights?.[0];
  const canEdit = me.can("pets.edit");
  const critical = [...(alerts ?? []).filter((a) => a.severity !== "info")];

  return (
    <>
      <Suspense><NoticeToast /></Suspense>
      <PageHeader
        back={owners[0] ? { href: `/customers/${owners[0].customers.id}`, label: owners[0].customers.full_name } : { href: "/pets", label: "Pets" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted"><PawPrint className="size-5" /></span>
            {p.name}
            <span className="font-mono text-sm font-normal text-muted-foreground">{p.code}</span>
            <StatusPill tone={p.status === "active" ? "success" : "neutral"}>{p.status}</StatusPill>
          </span>
        }
        description={[species?.name, breed?.name ?? p.breed_text,
          p.sex !== "unknown" ? `${p.sex}${p.is_neutered ? " (neutered)" : ""}` : null,
          formatAge(p.date_of_birth, p.dob_is_estimate), latest ? `${Number(latest.weight_kg)} kg` : null]
          .filter(Boolean).join(" · ")}
        actions={canEdit && <Button asChild variant="outline"><Link href={`/pets/${p.id}/edit`}><Pencil /> Edit</Link></Button>}
      />

      {(p.special_handling || critical.length > 0) && (
        <div className="mb-6 grid gap-2">
          {p.special_handling && (
            <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              <OctagonAlert className="size-4" /> {p.special_handling}
            </div>
          )}
          {critical.map((a) => (
            <div key={a.id} className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${a.severity === "critical" ? "border-danger/30 bg-danger-soft text-danger" : "border-warning/30 bg-warning-soft text-warning"}`}>
              <OctagonAlert className="size-4" /> <b>{KIND_LABEL[a.kind]}:</b> {a.label}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Date of birth">{p.date_of_birth ? `${formatDate(p.date_of_birth)}${p.dob_is_estimate ? " (est.)" : ""}` : null}</Field>
              <Field label="Neutered">{p.is_neutered == null ? null : p.is_neutered ? "Yes" : "No"}</Field>
              <Field label="Colour">{p.color}</Field>
              <Field label="Marks">{p.markings}</Field>
              <Field label="Microchip">{p.microchip_no}</Field>
              <Field label="Tag">{p.tag_no}</Field>
              <Field label="Registered">{formatDate(p.created_at)}</Field>
              {p.status !== "active" && <Field label="Status since">{formatDate(p.status_changed_at)}</Field>}
            </dl>
            {p.notes && <div className="mt-4 rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">{p.notes}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Owners</CardTitle>
            {canEdit && <CardAction><AddOwnerDialog petId={p.id} existing={owners.map((o) => o.customers.id)} /></CardAction>}
          </CardHeader>
          <CardContent className="grid gap-3">
            {owners.map((o) => {
              const wa = whatsappLink(o.customers.whatsapp);
              return (
                <div key={o.customers.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Link href={`/customers/${o.customers.id}`} className="font-medium hover:underline">{o.customers.full_name}</Link>
                    {o.is_primary && <StatusPill className="ml-2">primary</StatusPill>}
                    <p className="text-xs text-muted-foreground">
                      {formatPhone(o.customers.phone)}{o.relationship ? ` · ${o.relationship}` : ""}
                    </p>
                  </div>
                  {wa && <a href={wa} target="_blank" rel="noreferrer" className="text-success" title="WhatsApp"><MessageCircle className="size-4" /></a>}
                  {canEdit && !o.is_primary && <MakePrimaryButton petId={p.id} customerId={o.customers.id} />}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
            {canEdit && <CardAction><AlertForm petId={p.id} /></CardAction>}
          </CardHeader>
          <CardContent>
            {alerts?.length ? (
              <ul className="grid gap-2">
                {alerts.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-sm">
                    <StatusPill tone={a.severity === "critical" ? "danger" : a.severity === "warning" ? "warning" : "info"}>
                      {KIND_LABEL[a.kind]}
                    </StatusPill>
                    <div className="min-w-0 flex-1">
                      <p>{a.label}</p>
                      {a.notes && <p className="text-xs text-muted-foreground">{a.notes}</p>}
                    </div>
                    {canEdit && <ResolveAlertButton petId={p.id} alertId={a.id} />}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No allergies or warnings recorded.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Weight</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            {(canEdit || me.can("clinical.create")) && <WeightForm petId={p.id} />}
            {weights?.length ? (
              <ul className="divide-y text-sm">
                {weights.map((w, i) => {
                  const prev = weights[i + 1];
                  const delta = prev ? Number(w.weight_kg) - Number(prev.weight_kg) : 0;
                  return (
                    <li key={w.id} className="flex items-center gap-3 py-1.5">
                      <span className="w-20 font-medium tabular-nums">{Number(w.weight_kg)} kg</span>
                      {prev && delta !== 0 && (
                        <span className={`w-14 text-xs tabular-nums ${delta > 0 ? "text-info" : "text-warning"}`}>
                          {delta > 0 ? "+" : ""}{delta.toFixed(2)}
                        </span>
                      )}
                      <span className="flex-1 truncate text-xs text-muted-foreground">{w.note}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(w.measured_at)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No weights recorded yet.</p>}
          </CardContent>
        </Card>

        <Card className="border-dashed shadow-none lg:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" /> Medical timeline</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Consultations, vaccinations, prescriptions, diagnostics and surgeries will appear here in one chronological
              timeline from Phase 2.
            </p>
          </CardContent>
        </Card>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">Last updated {formatDateTime(p.updated_at)}</p>
    </>
  );
}
