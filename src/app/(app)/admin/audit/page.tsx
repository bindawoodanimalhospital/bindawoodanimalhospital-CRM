import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ActivityFeed } from "./activity-feed";
import { applyFilters, BATCH, COLUMNS, KINDS, TABLE_LABEL, TABLES, UUID, type LogFilters, type LogRow } from "./log-model";

export const metadata: Metadata = { title: "Activity log" };

function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} day${d === 1 ? "" : "s"} ago` : formatDate(iso);
}

/** Everything staff do, newest first. The first batch is rendered here; the feed loads more as you scroll. */
export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireStaff("audit.view");
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const filters: LogFilters = {
    table: TABLES.includes(str(sp.table)) ? str(sp.table) : "",
    actor: UUID.test(str(sp.actor)) ? str(sp.actor) : "",
    kind: KINDS.some((k) => k.key === str(sp.kind)) ? str(sp.kind) : "",
    from: /^\d{4}-\d{2}-\d{2}$/.test(str(sp.from)) ? str(sp.from) : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(str(sp.to)) ? str(sp.to) : "",
  };

  const supabase = await createClient();
  const first = applyFilters(supabase.from("audit_logs").select(COLUMNS, { count: "exact" })
    .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(BATCH), filters);
  const [{ data, count }, { data: staff }, { data: roles }, { data: seen }] = await Promise.all([
    first,
    supabase.from("staff").select("id, full_name, email, is_active").order("full_name"),
    supabase.from("roles").select("id, name"),
    supabase.rpc("staff_last_seen"),
  ]);
  const names = Object.fromEntries((staff ?? []).map((s) => [s.id, s.full_name || s.email]));
  const roleNames = Object.fromEntries((roles ?? []).map((r) => [r.id, r.name]));
  const lastSeen = new Map(((seen ?? []) as { staff_id: string; last_sign_in: string | null; last_active: string | null }[]).map((s) => [s.staff_id, s]));
  const now = new Date().getTime();
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader title="Activity log"
        description="Everything every staff member does — sign-ins, pages opened, prints and every change down to a single field. Entries can't be edited or deleted." />

      {/* Who has been in */}
      <section className="mb-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {(staff ?? []).map((s) => {
          const ls = lastSeen.get(s.id);
          const recent = ls?.last_active && now - new Date(ls.last_active).getTime() < 15 * 60000;
          return (
            <Link key={s.id} href={`/admin/audit?actor=${s.id}`}
              className={cn("flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 transition hover:ring-brand-muted", filters.actor === s.id ? "ring-brand" : "ring-border")}>
              <span className="relative">
                <Avatar className="size-10 rounded-xl"><AvatarFallback className="rounded-xl bg-brand-soft text-sm font-semibold text-brand">{initials(s.full_name)}</AvatarFallback></Avatar>
                {recent && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-success ring-2 ring-card" title="Active in the last 15 minutes" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{s.full_name || s.email}{!s.is_active && <span className="ml-1 text-xs font-normal text-muted-foreground">(no access)</span>}</span>
                <span className="block truncate text-xs text-muted-foreground">Signed in {ago(ls?.last_sign_in ?? null, now)}</span>
                <span className="block truncate text-xs text-muted-foreground">Last active {ago(ls?.last_active ?? null, now)}</span>
              </span>
            </Link>
          );
        })}
      </section>

      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl bg-card p-3 shadow-card ring-1 ring-border">
        <Field label="Person">
          <select name="actor" defaultValue={filters.actor} className={SELECT}>
            <option value="">Everyone</option>
            {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
          </select>
        </Field>
        <Field label="What">
          <select name="kind" defaultValue={filters.kind} className={SELECT}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Record">
          <select name="table" defaultValue={filters.table} className={SELECT}>
            <option value="">All records</option>
            {TABLES.map((t) => <option key={t} value={t}>{TABLE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="From"><input type="date" name="from" defaultValue={filters.from} className={SELECT} /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={filters.to} className={SELECT} /></Field>
        <button className="h-10 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white" type="submit">Show</button>
        {filtered && <Link href="/admin/audit" className="h-10 px-2 text-sm leading-10 font-semibold text-brand hover:underline">Clear</Link>}
        <span className="ml-auto self-center text-xs text-muted-foreground">{(count ?? 0).toLocaleString("en-PK")} entries</span>
      </form>

      {/* key: a new filter starts a fresh feed */}
      <ActivityFeed key={JSON.stringify(filters)} initial={(data ?? []) as LogRow[]} total={count ?? 0} filters={filters} names={names} roleNames={roleNames} />
    </>
  );
}

const SELECT = "h-10 max-w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-xs font-medium text-muted-foreground">{label}{children}</label>;
}
