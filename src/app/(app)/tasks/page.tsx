import type { Metadata } from "next";
import Link from "next/link";
import { ListTodo } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStaffOptions } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { isPast } from "@/lib/format";
import { NewTaskDialog, TaskCard, type TaskRow } from "./widgets";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const me = await requireStaff();
  const { view: v } = await searchParams;
  const all = me.can("tasks.view_all");
  const view = v === "all" && all ? "all" : v === "done" ? "done" : v === "created" ? "created" : "mine";
  const supabase = await createClient();
  let q = supabase.from("tasks").select(`id, title, details, priority, status, due_at, outcome, assigned_to, created_by, completed_at,
    customers(id, full_name), pets(id, name), task_comments(body, created_by, created_at)`);
  if (view === "mine") q = q.eq("assigned_to", me.id).in("status", ["open", "in_progress"]);
  if (view === "created") q = q.eq("created_by", me.id).in("status", ["open", "in_progress"]);
  if (view === "all") q = q.in("status", ["open", "in_progress"]);
  if (view === "done") q = q.in("status", ["done", "cancelled"]).order("completed_at", { ascending: false }).limit(60);
  else q = q.order("due_at", { ascending: true, nullsFirst: false });
  const [{ data }, staff] = await Promise.all([q, getStaffOptions()]);
  const names = new Map(staff.map((s) => [s.id, s.full_name]));
  const rank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const rows: TaskRow[] = (data ?? []).map((t) => ({
    id: t.id, title: t.title, details: t.details, priority: t.priority, status: t.status, due_at: t.due_at, outcome: t.outcome,
    assigned_name: t.assigned_to ? names.get(t.assigned_to) ?? null : null, created_name: t.created_by ? names.get(t.created_by) ?? null : null,
    customer: t.customers as unknown as TaskRow["customer"], pet: t.pets as unknown as TaskRow["pet"],
    comments: ((t.task_comments ?? []) as { body: string; created_by: string | null; created_at: string }[])
      .sort((a, b) => a.created_at.localeCompare(b.created_at)).map((c) => ({ body: c.body, at: c.created_at, by: c.created_by ? names.get(c.created_by) ?? null : null })),
    overdue: isPast(t.due_at),
  }));
  if (view !== "done") rows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || rank[a.priority] - rank[b.priority]);

  const tabs = [{ k: "mine", l: "My tasks" }, { k: "created", l: "I asked others" }, ...(all ? [{ k: "all", l: "Everyone" }] : []), { k: "done", l: "Done" }];
  return (
    <>
      <PageHeader title="Tasks" description="Things to follow up — they stay here until someone writes what was done."
        actions={me.can("tasks.manage") && <NewTaskDialog staff={staff} meId={me.id} />} />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t.k} href={`?view=${t.k}`} className={cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold ring-1",
            view === t.k ? "bg-brand-gradient text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted")}>{t.l}</Link>
        ))}
      </div>
      {rows.length === 0 ? <EmptyState icon={ListTodo} title={view === "done" ? "Nothing finished yet" : "No open tasks"} description="Nice — nothing waiting." />
        : <ul className="grid gap-3">{rows.map((t) => <TaskCard key={t.id} t={t} />)}</ul>}
    </>
  );
}
