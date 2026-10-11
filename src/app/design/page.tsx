import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle, PawPrint, Plus, Search, UserPlus, Users } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppSidebar } from "@/components/app/app-sidebar";
import { EmptyState, Field, PageHeader, StatusPill } from "@/components/app/page-header";
import { FormField, FormSection } from "@/components/app/form-field";
import { LogoMark } from "@/components/brand/logo";
import { QueueBoard, type QueueVisit } from "@/app/(app)/queue/queue-board";
import { SurgeryWorkspace, type SurgeryData } from "@/app/(app)/surgery/[id]/workspace";
import { InvoiceEditor } from "@/app/(app)/billing/[id]/editor";

export const metadata: Metadata = { title: "Design system" };

/**
 * Living style guide (development only). Shows the shell and every building block with sample data,
 * so new screens can copy patterns instead of inventing new ones. See docs/DESIGN.md.
 */
/** Sample timestamps "m minutes ago" for the demo queue. */
function ago(m: number) {
  return new Date(Date.now() - m * 60000).toISOString();
}

const SAMPLE_SURGERY: SurgeryData = {
  id: "sample", code: "SX-000001", status: "pre_op", urgency: "elective", procedure_name: "Spay (ovariohysterectomy)",
  fields: { procedure_name: "Spay (ovariohysterectomy)", urgency: "elective", indication: "Elective spay", surgeon_id: "d1",
    scheduled_at: null, estimate_amount: 25000, estimate_notes: "Includes 1 night in ward", preop_weight_kg: 18.2, asa_class: 1,
    fasting_confirmed: true, discharge_instructions: null },
  preop_checklist: { "Owner consent recorded": true, "Fasting confirmed": true }, preop_checked_at: null, preop_checked_by_name: null,
  procedure_start: null, procedure_end: null, discharged_at: null, emergency_override_reason: null, cancel_reason: null, reopened_reason: null,
  owner: { name: "Ahmed Raza", phone: "+923001234567" }, pet: { id: "p1", name: "Bella", customer_id: "c1" },
  consents: [{ id: "k1", signed_by_name: "Ahmed Raza", relationship: "Owner", method: "signed_paper", signed_at: new Date(0).toISOString(), revoked_at: null, revoked_reason: null, witness: "Reception" }],
  team: [], events: [], consumables: [{ id: "m1", item_name: "Suture — absorbable", quantity: 2, unit: "packs", batch_no: null }], admission_id: null,
};

export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const perms = ["customers.view", "pets.view", "queue.manage", "appointments.view", "clinical.view", "clinical.reopen", "staff.view", "audit.view", "settings.manage"];
  const sample: QueueVisit[] = [
    { id: "1", token_no: 7, status: "waiting", priority: "emergency", reason: "Hit by a car, bleeding from the leg", checked_in_at: ago(4), status_changed_at: ago(4), completed_at: null,
      pet: { id: "p1", name: "Sheru", species: "Dog", special_handling: "Aggressive — muzzle first" }, owner: { id: "c1", full_name: "Bilal Ahmed" }, doctor: null, type: "Emergency" },
    { id: "2", token_no: 5, status: "waiting", priority: "normal", reason: "Second puppy vaccine", checked_in_at: ago(38), status_changed_at: ago(38), completed_at: null,
      pet: { id: "p2", name: "Moti", species: "Dog", special_handling: null }, owner: { id: "c2", full_name: "Ahmed Raza" }, doctor: null, type: "Vaccination" },
    { id: "3", token_no: 4, status: "with_doctor", priority: "urgent", reason: "Not eating since 2 days", checked_in_at: ago(50), status_changed_at: ago(12), completed_at: null,
      pet: { id: "p3", name: "Mano", species: "Cat", special_handling: null }, owner: { id: "c3", full_name: "Ayesha Khan" }, doctor: { id: "d1", full_name: "Dr. Musab Bin Dawood" }, type: "Consultation" },
    { id: "4", token_no: 3, status: "in_treatment", priority: "normal", reason: "Ultrasound", checked_in_at: ago(70), status_changed_at: ago(9), completed_at: null,
      pet: { id: "p4", name: "Rani", species: "Goat", special_handling: null }, owner: { id: "c4", full_name: "Usman Ali" }, doctor: { id: "d1", full_name: "Dr. Musab Bin Dawood" }, type: "Ultrasound" },
    { id: "5", token_no: 2, status: "ready_for_billing", priority: "normal", reason: "Tick treatment", checked_in_at: ago(90), status_changed_at: ago(3), completed_at: null,
      pet: { id: "p5", name: "Tiger", species: "Dog", special_handling: null }, owner: { id: "c5", full_name: "Hina Tariq" }, doctor: { id: "d1", full_name: "Dr. Musab Bin Dawood" }, type: "Consultation" },
  ];

  return (
    <SidebarProvider>
      <AppSidebar permissions={perms} user={{ name: "Dr. Musab Bin Dawood", email: "owner@example.com", roles: ["Owner / Admin"] }} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 rounded-t-2xl border-b bg-card/85 px-4 backdrop-blur-md md:px-6">
          <SidebarTrigger className="-ml-1 size-9" />
          <div className="flex h-11 w-full min-w-0 max-w-xl items-center gap-2.5 rounded-xl bg-muted/80 px-4 text-muted-foreground">
            <Search className="size-[18px] shrink-0" /> <span className="truncate">Search a pet, owner or phone number…</span>
          </div>
          <Button className="ml-auto"><Plus /> New</Button>
        </header>
        <main className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-4 py-6 md:px-8 md:py-8">
          <section className="relative overflow-hidden rounded-3xl bg-ink bg-hero-gradient px-6 py-8 text-white shadow-float shadow-brand/20 md:px-10 md:py-10">
            <LogoMark tone="white" className="pointer-events-none absolute -right-8 -bottom-12 w-60 opacity-[0.07]" />
            <div className="relative">
              <p className="text-sm font-medium text-white/60">Thursday, 25 September</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight md:text-4xl">Good evening, Dr. Musab</h1>
              <p className="mt-2 text-white/70">What would you like to do today?</p>
              <div className="mt-6 flex h-13 w-full max-w-xl items-center gap-3 rounded-2xl bg-white px-5 text-muted-foreground shadow-lg">
                <Search className="size-5 text-brand" /> Search a pet, owner or phone number…
              </div>
            </div>
          </section>

          <div>
            <PageHeader title="Today's queue" description="Thursday, 25 September · 2 waiting · updates live on every screen" actions={<Button size="lg"><Plus /> Check in a pet</Button>} />
            <QueueBoard visits={sample} doctors={[{ id: "d1", full_name: "Dr. Musab Bin Dawood" }]} canManage canClinical />
          </div>

          <div>
            <PageHeader title="New bill" description="Ahmed Raza · Bella — suggestions from the visit, lines, and checkout with a partial payment." />
            <InvoiceEditor invoiceId="sample" customerName="Ahmed Raza" customerCredit={5000} perms={{ discount: true }}
              methods={[{ key: "cash", label: "Cash", needs_reference: false }, { key: "jazzcash", label: "JazzCash", needs_reference: true }, { key: "easypaisa", label: "Easypaisa", needs_reference: true }]}
              suggestions={[
                { key: "v", item_id: "i1", name: "Consultation fee", quantity: 1, unit_price: 1500, reason: "Visit fee", source_table: "visits", source_id: "x", kind: "service" },
                { key: "d", item_id: "i2", name: "Abdominal ultrasound", quantity: 1, unit_price: 3500, reason: "Test", source_table: "diagnostic_orders", source_id: "y", kind: "service" },
                { key: "w", item_id: "i3", name: "Ward stay (per day)", quantity: 2, unit_price: 0, reason: "Ward stay (2 days)", source_table: "admissions", source_id: "z", kind: "service" },
              ]}
              unmatched={["DHPPi"]}
              lines={[{ id: "l1", item_id: "i9", description: "Spay (ovariohysterectomy)", kind: "service", quantity: 1, unit_price: 25000, discount_amount: 0, line_total: 25000, price_is_editable: false, track_stock: false },
                { id: "l2", item_id: "i8", description: "Meloxicam 1.5 mg/ml syrup", kind: "product", quantity: 1, unit_price: 850, discount_amount: 0, line_total: 850, price_is_editable: false, track_stock: true }]}
              totals={{ subtotal: 25850, line_discounts: 0, invoice_discount: 0, tax_total: 0, total: 25850, discount_reason: null }} />
          </div>

          <div>
            <PageHeader title="Surgery workspace" description="Pre-op stage: consent recorded, pre-op check still missing → Start surgery is locked." />
            <SurgeryWorkspace s={SAMPLE_SURGERY} doctors={[{ id: "d1", full_name: "Dr. Musab Bin Dawood" }]} staff={[{ id: "d1", full_name: "Dr. Musab Bin Dawood" }]}
              checklist={["Owner consent recorded", "Fasting confirmed", "Weight taken today", "IV line placed"]} consentText={{ en: "", ur: "" }}
              perms={{ manage: true, assist: true, consent: true, reopen: true, clinical: true }} />
          </div>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { t: "New pet owner", d: "Register an owner and their pet in one go", i: UserPlus, p: true },
              { t: "Find a pet or owner", d: "Search by name, phone number or ID", i: Search },
              { t: "Add a pet", d: "Add another pet to an existing owner", i: PawPrint },
              { t: "Add staff", d: "Give a doctor or receptionist a login", i: Users },
            ].map((a) => (
              <div key={a.t} className="group flex flex-col items-start rounded-2xl bg-card p-5 shadow-card ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-float hover:ring-brand-muted">
                <span className={`flex size-12 items-center justify-center rounded-2xl ${a.p ? "bg-brand-gradient text-white shadow-md shadow-brand/30" : "bg-brand-soft text-brand"}`}>
                  <a.i className="size-6" />
                </span>
                <span className="mt-4 text-base font-semibold">{a.t}</span>
                <span className="mt-1 text-sm text-muted-foreground">{a.d}</span>
              </div>
            ))}
          </section>

          <div>
            <PageHeader title="Pet owners" description="248 pet owners" back={{ href: "#", label: "Back" }}
              actions={<><Button variant="outline"><MessageCircle /> WhatsApp</Button><Button><UserPlus /> New pet owner</Button></>} />
            <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>ID</TableHead><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Pets</TableHead><TableHead className="text-right">Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {[["C-00012", "Ahmed Raza", "0300 1234567", "Tiger, Moti", "success"], ["C-00011", "Ayesha Khan", "0321 7654321", "Mano", "warning"], ["C-00010", "Bilal Ahmed", "042 35761234", "Sheru", "neutral"]].map(([id, n, ph, p, tone]) => (
                    <TableRow key={id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{id}</TableCell>
                      <TableCell className="font-semibold">{n}</TableCell>
                      <TableCell>{ph}</TableCell>
                      <TableCell className="text-muted-foreground">{p}</TableCell>
                      <TableCell className="text-right"><StatusPill tone={tone as "success"}>{tone === "success" ? "Active" : tone === "warning" ? "Payment due" : "Inactive"}</StatusPill></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Buttons</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button>Primary</Button><Button variant="ink">Ink</Button><Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button><Button variant="destructive">Delete</Button><Button size="lg">Large action</Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Status</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <StatusPill tone="success">Paid</StatusPill><StatusPill tone="warning">Due today</StatusPill>
                <StatusPill tone="danger">Overdue</StatusPill><StatusPill tone="info">With doctor</StatusPill>
                <StatusPill tone="brand">Primary owner</StatusPill><StatusPill>Inactive</StatusPill>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Profile fields</CardTitle></CardHeader>
              <CardContent><dl className="grid grid-cols-2 gap-4"><Field label="Mobile">0300 1234567</Field><Field label="Area">DHA Phase 5</Field></dl></CardContent>
            </Card>
          </div>

          <FormSection title="Owner" description="Form sections group related fields.">
            <FormField label="Full name" required><Input defaultValue="Ahmed Raza" /></FormField>
            <FormField label="Mobile number" hint="e.g. 0300 1234567" required><Input /></FormField>
            <FormField label="Email" error="Invalid email"><Input aria-invalid defaultValue="ahmed@" /></FormField>
          </FormSection>

          <EmptyState icon={PawPrint} title="No pets yet" description="Pets are registered from the owner's profile." action={<Button><Plus /> Add pet</Button>} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
