import type { Metadata } from "next";
import { FileClock } from "lucide-react";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };
const PAGE_SIZE = 50;


const TONE: Record<string, "success" | "info" | "danger" | "warning"> = {
  insert: "success", update: "info", delete: "danger",
};

/** Plain-language names for what changed (anything not listed is shown with underscores removed). */
const TABLE_LABEL: Record<string, string> = {
  customers: "Pet owner", pets: "Pet", pet_owners: "Pet ↔ owner link", pet_alerts: "Pet alert", pet_weights: "Weight",
  staff: "Staff", staff_roles: "Staff role", roles: "Role", role_permissions: "Permission", system_settings: "Setting",
  appointments: "Appointment", visits: "Visit", consultations: "Consultation", vaccinations: "Vaccination",
  prescriptions: "Prescription", diagnostic_orders: "Test", surgeries: "Surgery", admissions: "Ward admission",
  invoices: "Bill", invoice_items: "Bill line", payments: "Payment", dues: "Unpaid bill", invoice_returns: "Return",
  catalog_items: "Price-list item", catalog_costs: "Cost price", suppliers: "Supplier", purchases: "Stock delivery",
  supplier_payments: "Supplier payment", expenses: "Expense", tasks: "Task", messages: "Message",
  partner_businesses: "Nearby business", stock_loans: "Stock loan", stock_loan_lines: "Stock loan item",
  stock_loan_returns: "Stock loan return", payment_methods: "Payment method",
};
const TABLES = Object.keys(TABLE_LABEL);
const ACTION_LABEL: Record<string, string> = { insert: "Added", update: "Changed", delete: "Deleted" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keys that are noise in a diff view. */
const HIDDEN = new Set(["search_text", "updated_at", "created_at", "idempotency_key"]);

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireStaff("audit.view");
  const sp = await searchParams;
  const table = typeof sp.table === "string" && TABLES.includes(sp.table) ? sp.table : "";
  const actor = typeof sp.actor === "string" ? sp.actor : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  let q = supabase.from("audit_logs")
    .select("id, occurred_at, actor_id, action, table_name, record_id, old_data, new_data, changed, reason", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (table) q = q.eq("table_name", table);
  if (actor) q = q.eq("actor_id", actor);
  const [{ data: rows, count }, { data: staff }] = await Promise.all([
    q, supabase.from("staff").select("id, full_name, email"),
  ]);
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name || s.email]));

  return (
    <>
      <PageHeader title="Audit log" description="Every change to records, permissions and settings — who, what and when. Entries can't be edited or deleted." />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="table" defaultValue={table} className="h-10 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="">All records</option>
          {TABLES.map((t) => <option key={t} value={t}>{TABLE_LABEL[t]}</option>)}
        </select>
        <select name="actor" defaultValue={actor} className="h-10 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="">Everyone</option>
          {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
        </select>
        <button className="h-10 rounded-xl border border-input bg-card px-4 text-sm font-semibold hover:bg-muted" type="submit">Filter</button>
      </form>

      {!rows?.length ? <EmptyState icon={FileClock} title="Nothing logged yet" /> : (
        <div className="divide-y overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
          {rows.map((r) => {
            const fields = (r.changed as string[] | null)?.filter((f) => !HIDDEN.has(f)) ?? [];
            const data = (r.new_data ?? r.old_data) as Record<string, unknown> | null;
            const raw = (data?.full_name ?? data?.name ?? data?.label ?? data?.number ?? data?.code ?? data?.description ?? r.record_id) as string | null;
            const label = raw && !UUID.test(String(raw)) ? String(raw) : null;
            return (
              <details key={r.id} className="group px-4 py-2.5 text-sm open:bg-muted/30">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-40 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateTime(r.occurred_at)}</span>
                  <StatusPill tone={TONE[r.action] ?? "warning"}>{ACTION_LABEL[r.action] ?? r.action.replace(/[._]/g, " ")}</StatusPill>
                  <span className="text-muted-foreground">{TABLE_LABEL[r.table_name ?? ""] ?? r.table_name?.replace(/_/g, " ")}</span>
                  {label && <span className="max-w-64 truncate font-medium">{label}</span>}
                  {fields.length > 0 && <span className="truncate text-xs text-muted-foreground">{fields.map((f) => f.replace(/_/g, " ")).join(", ")}</span>}
                  <span className="ml-auto text-xs">{r.actor_id ? names.get(r.actor_id) ?? "Unknown user" : "System"}</span>
                </summary>
                {r.reason && <p className="mt-2 text-xs"><b>Reason:</b> {r.reason}</p>}
                <Diff before={r.old_data as Record<string, unknown> | null} after={r.new_data as Record<string, unknown> | null}
                  only={r.action === "update" ? fields : null} />
              </details>
            );
          })}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={{ table, actor }} />
    </>
  );
}

function Diff({ before, after, only }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null; only: string[] | null }) {
  const keys = (only ?? Object.keys(after ?? before ?? {})).filter((k) => !HIDDEN.has(k));
  if (!keys.length) return null;
  const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <table className="mt-2 w-full text-xs">
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="align-top">
            <td className="w-40 py-0.5 pr-3 font-mono text-muted-foreground">{k}</td>
            {only && <td className="py-0.5 pr-3 break-all text-danger line-through">{show(before?.[k])}</td>}
            <td className="py-0.5 break-all">{show((after ?? before)?.[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
