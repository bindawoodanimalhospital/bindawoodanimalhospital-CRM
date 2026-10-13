import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, History, Lock, MessageCircle, PawPrint, Pencil, Phone, Plus, Receipt, ShoppingBag, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatAge, formatDate, formatDateTime, sentence } from "@/lib/format";
import { formatPhone, whatsappLink } from "@/lib/phone";
import { CONTACT, contactOf } from "@/lib/contacts";
import { MergeCustomerDialog } from "./merge-dialog";
import { RemovalPanel } from "@/components/app/removal-panel";
import { removalState } from "@/lib/removals";
import { NewBillButton } from "../../billing/new-bill";
import { CustomerSummaryCards } from "./summary-cards";
import { ContactHistory } from "./contact-history";
import { ServiceHistory } from "./service-history";

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
    .select(`*, ${CONTACT}, merged_into:merged_into_id(id, full_name),
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

  // Numbers and email are only returned for staff allowed to see them (Owner by default).
  const canContact = me.can("customers.contact");
  const contact = contactOf(c);
  const wa = whatsappLink(contact.whatsapp ?? contact.phone);
  const mergedInto = c.merged_into as { id: string; full_name: string } | null;
  const removal = c.status !== "merged" ? await removalState(me, "customer", c.id, c.full_name) : null;

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
            {c.status !== "active" && <StatusPill tone="warning">{sentence(c.status)}</StatusPill>}
          </span>
        }
        description={`Customer since ${formatDate(c.created_at)}`}
        actions={
          <>
            {contact.phone && <Button asChild variant="outline"><a href={`tel:${contact.phone}`}><Phone /> Call</a></Button>}
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

      {c.status !== "merged" && (
        <div className="-mt-4 mb-6 flex flex-wrap gap-2">
          {me.can("billing.create") && <NewBillButton customer={{ id: c.id }} label="New bill" />}
          {me.can("pos.use") && <Button asChild variant="outline"><Link href="/pos"><ShoppingBag /> Pet store sale</Link></Button>}
          {me.can("appointments.manage") && <Button asChild variant="outline"><Link href="/appointments"><CalendarPlus /> Book appointment</Link></Button>}
          <Button asChild variant="outline"><Link href={`/customers/${c.id}/history`}><History /> Full history — all pets</Link></Button>
          {me.can("billing.view") && <Button asChild variant="ghost"><Link href={`/customers/${c.id}/account`}><Receipt /> Account & statement</Link></Button>}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        {/* Left: contact profile */}
        <Card className="lg:sticky lg:top-20">
          <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              {canContact ? (
                <>
                  <Field label="Mobile">{formatPhone(contact.phone)}</Field>
                  <Field label="WhatsApp">{formatPhone(contact.whatsapp)}</Field>
                  <Field label="Alternate">{formatPhone(contact.alt_phone)}</Field>
                  <Field label="Prefers">{CHANNEL[c.preferred_channel]}</Field>
                  <Field label="Email" className="col-span-2">{contact.email}</Field>
                </>
              ) : (
                <>
                  <p className="col-span-2 flex items-center gap-2 rounded-lg bg-muted/70 p-2.5 text-xs text-muted-foreground">
                    <Lock className="size-3.5 shrink-0" /> Phone numbers and email are private to the clinic owner.
                  </p>
                  <Field label="Prefers">{CHANNEL[c.preferred_channel]}</Field>
                </>
              )}
              <Field label="House number">{c.house_no}</Field>
              <Field label="Block">{c.block}</Field>
              <Field label="Full address" className="col-span-2">{c.address}</Field>
              <Field label="Area">{c.area}</Field>
              <Field label="City">{c.city}</Field>
              <Field label="Found us via">{c.referral_source}</Field>
              <Field label="Campaign messages">{c.marketing_opt_in ? "Opted in" : "No"}</Field>
            </dl>
            {c.notes && (
              <div className="mt-4 rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">{c.notes}</div>
            )}
          </CardContent>
        </Card>

        {/* Right: money & bookings at a glance, pets, history */}
        <div className="grid min-w-0 gap-6 lg:col-span-2">
        <CustomerSummaryCards customerId={c.id} petIds={pets.map((p) => p.id)} me={me} />
        <Card>
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
                      className="group rounded-2xl p-4 ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-card hover:ring-brand-muted">
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                          <PawPrint className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{p.name}</span>
                            {p.status !== "active" && <StatusPill>{sentence(p.status)}</StatusPill>}
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

        <ServiceHistory customerId={c.id} me={me} />
        {me.can("crm.view") && <ContactHistory customerId={c.id} canLog={me.can("crm.manage")} />}
        </div>
      </div>

      {removal && <RemovalPanel state={removal} />}
      <p className="mt-6 text-xs text-muted-foreground">Last updated {formatDateTime(c.updated_at)}</p>
    </>
  );
}
