import Link from "next/link";
import { CalendarClock, FlaskConical, History, Lock, Pill, Stethoscope, Syringe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, todayPK } from "@/lib/format";

type Entry = {
  at: string; kind: "visit" | "vaccination" | "prescription" | "diagnostic";
  title: string; detail?: string | null; href?: string; tags: { label: string; tone: "success" | "warning" | "neutral" | "brand" | "info" | "danger" }[];
};

const ICONS = { visit: Stethoscope, vaccination: Syringe, prescription: Pill, diagnostic: FlaskConical };

/** One chronological history of the pet (spec §7). Server component; RLS limits what each role sees. */
export async function PetTimeline({ petId }: { petId: string }) {
  const supabase = await createClient();
  const [visits, vaccs, rx, dx] = await Promise.all([
    supabase.from("visits").select(`id, checked_in_at, status, reason, appointment_types(name), doctor:doctor_id(full_name),
      consultations(status, assessment, chief_complaint, consultation_diagnoses(label, is_primary))`)
      .eq("pet_id", petId).neq("status", "cancelled").order("checked_in_at", { ascending: false }).limit(50),
    supabase.from("vaccinations").select("id, vaccine_name, administered_at, batch_no, next_due_date, voided_at, visit_id")
      .eq("pet_id", petId).is("voided_at", null).order("administered_at", { ascending: false }).limit(50),
    supabase.from("prescriptions").select("id, code, status, issued_at, prescription_items(medicine_name)")
      .eq("pet_id", petId).eq("status", "issued").order("issued_at", { ascending: false }).limit(50),
    supabase.from("diagnostic_orders").select("id, status, created_at, impression, visit_id, diagnostic_types(name)")
      .eq("pet_id", petId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(50),
  ]);

  const entries: Entry[] = [
    ...(visits.data ?? []).map((v) => {
      const cs = (v.consultations ?? []) as { status: string; assessment: string | null; chief_complaint: string | null; consultation_diagnoses: { label: string; is_primary: boolean }[] }[];
      const c = cs[0];
      const dx = c?.consultation_diagnoses?.map((d) => d.label).join(", ");
      return {
        at: v.checked_in_at, kind: "visit" as const, href: `/visits/${v.id}`,
        title: (v.appointment_types as unknown as { name: string } | null)?.name ?? "Visit",
        detail: dx || c?.assessment || c?.chief_complaint || v.reason,
        tags: [
          ...(c ? [{ label: c.status === "finalized" ? "Finalized" : "Draft notes", tone: c.status === "finalized" ? "success" as const : "warning" as const }] : []),
          ...((v.doctor as unknown as { full_name: string } | null) ? [{ label: (v.doctor as unknown as { full_name: string }).full_name, tone: "neutral" as const }] : []),
        ],
      };
    }),
    ...(vaccs.data ?? []).map((v) => ({
      at: v.administered_at, kind: "vaccination" as const, href: v.visit_id ? `/visits/${v.visit_id}?tab=vaccines` : undefined,
      title: v.vaccine_name, detail: v.batch_no ? `Batch ${v.batch_no}` : null,
      tags: v.next_due_date ? [{ label: `Next ${formatDate(v.next_due_date)}`, tone: "info" as const }] : [],
    })),
    ...(rx.data ?? []).map((r) => ({
      at: r.issued_at!, kind: "prescription" as const, href: `/print/prescription/${r.id}`,
      title: `Prescription ${r.code}`,
      detail: ((r.prescription_items ?? []) as { medicine_name: string }[]).map((i) => i.medicine_name).join(", "),
      tags: [],
    })),
    ...(dx.data ?? []).map((d) => ({
      at: d.created_at, kind: "diagnostic" as const, href: d.visit_id ? `/visits/${d.visit_id}?tab=tests` : undefined,
      title: (d.diagnostic_types as unknown as { name: string }).name, detail: d.impression,
      tags: [{ label: d.status === "reviewed" ? "Reviewed" : d.status === "resulted" ? "Result ready" : "Pending",
        tone: d.status === "reviewed" ? "success" as const : d.status === "resulted" ? "brand" as const : "warning" as const }],
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Card className="lg:col-span-2">
      <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" /> Medical history</CardTitle></CardHeader>
      <CardContent>
        {entries.length === 0 ? <p className="text-sm text-muted-foreground">No visits yet.</p> : (
          <ol className="relative grid gap-1 before:absolute before:top-2 before:bottom-2 before:left-[19px] before:w-px before:bg-border">
            {entries.map((e, i) => {
              const Icon = ICONS[e.kind];
              const body = (
                <>
                  <span className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-brand ring-1 ring-border">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{e.title}</span>
                      {e.tags.map((t) => <StatusPill key={t.label} tone={t.tone}>{t.label === "Finalized" && <Lock className="mr-1 size-3" />}{t.label}</StatusPill>)}
                    </span>
                    {e.detail && <span className="block truncate text-sm text-muted-foreground">{e.detail}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
                </>
              );
              return (
                <li key={`${e.kind}-${i}`}>
                  {e.href
                    ? <Link href={e.href} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted/60">{body}</Link>
                    : <div className="flex items-center gap-3 p-2">{body}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** Pending vaccinations & follow-ups for this pet. */
export async function PetDueCard({ petId }: { petId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("due_items").select("id, title, due_on, kind").eq("pet_id", petId).eq("status", "pending").order("due_on");
  const today = todayPK();
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" /> Due</CardTitle></CardHeader>
      <CardContent>
        {!data?.length ? <p className="text-sm text-muted-foreground">Nothing due.</p> : (
          <ul className="grid gap-2">
            {data.map((d) => {
              const overdue = d.due_on < today;
              const isToday = d.due_on === today;
              return (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  {d.kind === "vaccination" ? <Syringe className="size-4 text-muted-foreground" /> : <Stethoscope className="size-4 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <StatusPill tone={overdue ? "danger" : isToday ? "warning" : "neutral"}>
                    {overdue ? `Overdue · ${formatDate(d.due_on)}` : isToday ? "Today" : formatDate(d.due_on)}
                  </StatusPill>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
