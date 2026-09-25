import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/queries";
import { addDaysPK, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DueRow, type DueEntry } from "./due-row";

export const metadata: Metadata = { title: "Due & follow-ups" };

const VIEWS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "Next 7 days" },
] as const;

export default async function DuePage({ searchParams }: PageProps<"/due">) {
  const me = await requireStaff();
  if (!me.can("clinical.view") && !me.can("crm.view")) redirect("/dashboard?denied=1");
  const { view: v } = await searchParams;
  const view = VIEWS.some((x) => x.key === v) ? (v as (typeof VIEWS)[number]["key"]) : "overdue";
  const today = todayPK();

  const supabase = await createClient();
  let q = supabase.from("due_items")
    .select("id, kind, title, due_on, outcome, previous_due_on, pets(id, name, status, pet_owners(is_primary, customers(full_name, phone, whatsapp)))")
    .eq("status", "pending").order("due_on").limit(200);
  q = view === "overdue" ? q.lt("due_on", today) : view === "today" ? q.eq("due_on", today) : q.gt("due_on", today).lte("due_on", addDaysPK(7));
  const [{ data }, counts, clinic] = await Promise.all([
    q,
    Promise.all([
      supabase.from("due_items").select("id", { count: "exact", head: true }).eq("status", "pending").lt("due_on", today),
      supabase.from("due_items").select("id", { count: "exact", head: true }).eq("status", "pending").eq("due_on", today),
      supabase.from("due_items").select("id", { count: "exact", head: true }).eq("status", "pending").gt("due_on", today).lte("due_on", addDaysPK(7)),
    ]),
    getSetting<{ name?: string }>("clinic.profile"),
  ]);
  const count = { overdue: counts[0].count ?? 0, today: counts[1].count ?? 0, week: counts[2].count ?? 0 };

  const entries: DueEntry[] = (data ?? []).flatMap((d) => {
    const pet = d.pets as unknown as { id: string; name: string; status: string;
      pet_owners: { is_primary: boolean; customers: { full_name: string; phone: string; whatsapp: string | null } }[] };
    if (!pet || pet.status !== "active") return [];
    const owner = pet.pet_owners.find((o) => o.is_primary)?.customers ?? pet.pet_owners[0]?.customers ?? null;
    return [{ id: d.id, kind: d.kind, title: d.title, due_on: d.due_on, outcome: d.outcome, previous_due_on: d.previous_due_on,
      pet: { id: pet.id, name: pet.name }, owner }];
  });
  const canWork = me.can("crm.manage") || me.can("clinical.create") || me.can("vaccinations.manage");

  return (
    <>
      <PageHeader title="Due & follow-ups" description="Vaccine doses and follow-up visits. Items stay here until the pet comes in or someone closes them with a reason." />
      <div className="mb-6 flex flex-wrap gap-2">
        {VIEWS.map((x) => (
          <Link key={x.key} href={`?view=${x.key}`}
            className={cn("inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1",
              view === x.key ? "bg-brand-gradient text-white ring-transparent shadow-md shadow-brand/20" : "bg-card ring-border hover:ring-brand-muted")}>
            {x.label}
            <span className={cn("rounded-full px-2 text-xs", view === x.key ? "bg-white/20" : x.key === "overdue" && count.overdue ? "bg-danger-soft text-danger" : "bg-muted")}>{count[x.key]}</span>
          </Link>
        ))}
      </div>
      {entries.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="All clear" description="Nothing in this list right now." />
      ) : (
        <ul className="grid gap-3">
          {entries.map((d) => <DueRow key={d.id} d={d} canWork={canWork} clinicName={clinic?.name || "Bin Dawood Animal Hospital"} />)}
        </ul>
      )}
    </>
  );
}
