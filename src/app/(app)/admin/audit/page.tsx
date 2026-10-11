import type { Metadata } from "next";
import Link from "next/link";
import {
  Coffee, Copy, Download, ExternalLink, Eye, FileClock, KeyRound, LogIn, LogOut, Mail, MessageCircle, Pencil, Phone, Plus, Printer,
  Search, ShieldAlert, ShieldX, Sparkles, SquareX, Trash2, Undo2, type LucideIcon,
} from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatTime, initials, TIMEZONE, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AuditGroup } from "./audit-group";

export const metadata: Metadata = { title: "Activity log" };
const PAGE_SIZE = 300;

/** Plain-language names for record types (anything not listed is shown with underscores removed). */
const TABLE_LABEL: Record<string, string> = {
  customers: "Pet owner", pets: "Pet", pet_owners: "Pet ↔ owner link", pet_alerts: "Pet alert", pet_weights: "Weight",
  staff: "Staff", staff_roles: "Staff role", roles: "Role", role_permissions: "Role permission", permissions: "Permission type",
  system_settings: "Setting", staff_schedules: "Staff schedule",
  appointments: "Appointment", appointment_types: "Appointment type", visits: "Visit", visit_status_events: "Queue status",
  consultations: "Consultation", consultation_diagnoses: "Diagnosis", consultation_revisions: "Consultation edit",
  clinical_templates: "Clinical template", vaccinations: "Vaccination", vaccines: "Vaccine", due_items: "Due reminder",
  vaccination_protocols: "Vaccine schedule", vaccination_protocol_steps: "Vaccine schedule step",
  prescriptions: "Prescription", prescription_items: "Prescription medicine", medicines: "Medicine",
  diagnostic_orders: "Test", diagnostic_types: "Test type", documents: "Document",
  surgeries: "Surgery", surgery_events: "Surgery step", surgery_revisions: "Surgery edit", surgery_team: "Surgery team",
  surgery_consents: "Surgery consent", surgery_consumables: "Surgery consumable", surgery_procedures: "Surgery procedure",
  admissions: "Ward admission", admission_orders: "Ward order", admission_administrations: "Ward dose given",
  admission_notes: "Ward note", kennels: "Kennel",
  invoices: "Bill", invoice_items: "Bill line", payments: "Payment", payment_allocations: "Payment split", dues: "Unpaid bill",
  due_promises: "Payment promise", invoice_returns: "Return", payment_methods: "Payment method",
  catalog_items: "Price-list item", catalog_costs: "Cost price", inventory_movements: "Stock movement",
  inventory_locations: "Stock location", product_batches: "Stock batch", batch_costs: "Batch cost",
  suppliers: "Supplier", purchases: "Stock delivery", purchase_lines: "Stock delivery line", supplier_payments: "Supplier payment",
  stock_loans: "Stock loan", stock_loan_lines: "Stock loan item", stock_loan_returns: "Stock loan return",
  stock_loan_return_lines: "Stock loan return item", partner_businesses: "Nearby business",
  expenses: "Expense", expense_categories: "Expense category", tasks: "Task", task_comments: "Task comment",
  messages: "Message", message_templates: "Message template", reminder_rules: "Reminder rule", reminder_tracks: "Reminder track",
  reminder_events: "Reminder event", campaigns: "Campaign", breeds: "Breed", species: "Species",
};
const TABLES = Object.keys(TABLE_LABEL).sort((a, b) => TABLE_LABEL[a].localeCompare(TABLE_LABEL[b]));

/** Where a record lives in the app, for "open" links. */
const HREF: Record<string, string> = {
  customers: "/customers/", pets: "/pets/", invoices: "/billing/", visits: "/visits/", staff: "/admin/staff/",
  surgeries: "/surgery/", catalog_items: "/inventory/", tasks: "/tasks",
};

const SIGNIN = ["auth.sign_in", "auth.sign_out", "auth.sign_in_failed"];
const CHANGES = ["insert", "update", "delete"];
const CONTACT = ["contact.call", "contact.whatsapp", "contact.email", "link.external", "file.download", "data.copied"];
const PRESENCE = ["session.idle", "session.active", "session.closed"];
const KINDS = [
  { key: "", label: "Everything" },
  { key: "signin", label: "Sign-ins & sign-outs" },
  { key: "changes", label: "Changes to records" },
  { key: "views", label: "Pages opened" },
  { key: "prints", label: "Prints" },
  { key: "contact", label: "Calls, WhatsApp, links & copying" },
  { key: "search", label: "Searches" },
  { key: "presence", label: "Away, back & tab closed" },
  { key: "denied", label: "Blocked pages" },
  { key: "events", label: "Other actions" },
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Keys that are noise in a diff view. */
const HIDDEN = new Set(["search_text", "updated_at", "created_at", "idempotency_key", "refresh_token_hmac_key"]);

type Row = {
  id: number; occurred_at: string; actor_id: string | null; action: string; table_name: string | null; record_id: string | null;
  old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; changed: string[] | null;
  reason: string | null; context: Record<string, unknown> | null;
};

/** "Chrome on Windows" from a browser user-agent string. */
function device(ua: unknown) {
  if (typeof ua !== "string" || !ua) return null;
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android phone" : /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${b} on ${os}` : b;
}

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

const pageTitle = (r: Row) => String(r.context?.title ?? "").replace(/\s*·\s*Bin Dawood Animal Hospital$/, "").trim();

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireStaff("audit.view");
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const table = TABLES.includes(str(sp.table)) ? str(sp.table) : "";
  const actor = UUID.test(str(sp.actor)) ? str(sp.actor) : "";
  const kind = KINDS.some((k) => k.key === str(sp.kind)) ? str(sp.kind) : "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.from)) ? str(sp.from) : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.to)) ? str(sp.to) : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  let q = supabase.from("audit_logs")
    .select("id, occurred_at, actor_id, action, table_name, record_id, old_data, new_data, changed, reason, context", { count: "exact" })
    .order("occurred_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (table) q = q.eq("table_name", table);
  if (actor) q = q.eq("actor_id", actor);
  if (kind === "signin") q = q.in("action", SIGNIN);
  if (kind === "changes") q = q.in("action", CHANGES);
  if (kind === "views") q = q.eq("action", "page.view");
  if (kind === "prints") q = q.eq("action", "page.print");
  if (kind === "contact") q = q.in("action", CONTACT);
  if (kind === "search") q = q.eq("action", "search.used");
  if (kind === "presence") q = q.in("action", PRESENCE);
  if (kind === "denied") q = q.eq("action", "access.denied");
  if (kind === "events") q = q.not("action", "in", `(${[...SIGNIN, ...CHANGES, ...CONTACT, ...PRESENCE, "page.view", "page.print", "search.used", "access.denied"].join(",")})`);
  if (from) q = q.gte("occurred_at", `${from}T00:00:00+05:00`);
  if (to) q = q.lte("occurred_at", `${to}T23:59:59.999+05:00`);

  const [{ data, count }, { data: staff }, { data: roles }, { data: seen }] = await Promise.all([
    q,
    supabase.from("staff").select("id, full_name, email, is_active").order("full_name"),
    supabase.from("roles").select("id, name"),
    supabase.rpc("staff_last_seen"),
  ]);
  const rows = (data ?? []) as Row[];
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name || s.email]));
  const roleNames = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const lastSeen = new Map(((seen ?? []) as { staff_id: string; last_sign_in: string | null; last_active: string | null }[]).map((s) => [s.staff_id, s]));
  const now = new Date().getTime();
  const who = (id: string | null) => (id ? names.get(id) ?? "Unknown user" : "System");

  /** Human name of the record a row is about. */
  const recordName = (r: Row): string | null => {
    const d = r.new_data ?? r.old_data;
    if (!d) return null;
    if (r.table_name === "staff_roles") return `${names.get(String(d.staff_id)) ?? "staff"} → ${roleNames.get(String(d.role_id)) ?? "role"}`;
    if (r.table_name === "role_permissions") return `${roleNames.get(String(d.role_id)) ?? "role"} → ${String(d.permission_key ?? "")}`;
    const raw = d.full_name ?? d.name ?? d.label ?? d.title ?? d.number ?? d.code ?? d.description ?? d.key ?? null;
    return raw != null && String(raw).trim() && !UUID.test(String(raw)) ? String(raw) : null;
  };

  /** One line describing what a single row did. */
  const onPage = (r: Row) => (pageTitle(r) ? `on ${pageTitle(r)}` : r.record_id);
  const describe = (r: Row): { icon: LucideIcon; tone: string; text: string; detail?: string | null; href?: string | null } => {
    const c = (k: string) => (r.context?.[k] == null || r.context?.[k] === "" ? null : String(r.context[k]));
    switch (r.action) {
      case "auth.sign_in":
        return { icon: LogIn, tone: "bg-success-soft text-success", text: "Signed in",
          detail: [device(r.context?.device), r.context?.ip ? `IP ${r.context.ip}` : null, r.context?.note as string | null].filter(Boolean).join(" · ") || null };
      case "auth.sign_out":
        return { icon: LogOut, tone: "bg-muted text-muted-foreground", text: "Signed out", detail: device(r.context?.device) };
      case "auth.sign_in_failed":
        return { icon: ShieldAlert, tone: "bg-danger-soft text-danger", text: "Wrong password entered at sign-in" };
      case "page.view":
        return { icon: Eye, tone: "bg-muted text-muted-foreground", text: `Opened ${pageTitle(r) || "a page"}`, detail: r.record_id, href: r.record_id };
      case "page.print":
        return { icon: Printer, tone: "bg-info-soft text-info", text: `Printed ${pageTitle(r) || "a page"}`, detail: r.record_id, href: r.record_id };
      case "contact.call":
        return { icon: Phone, tone: "bg-success-soft text-success", text: `Tapped to call ${c("to") ?? "a number"}`, detail: onPage(r) };
      case "contact.whatsapp":
        return { icon: MessageCircle, tone: "bg-success-soft text-success", text: `Opened WhatsApp${c("to") ? ` to ${c("to")}` : ""}`, detail: onPage(r) };
      case "contact.email":
        return { icon: Mail, tone: "bg-info-soft text-info", text: `Started an email to ${c("to") ?? "someone"}`, detail: onPage(r) };
      case "link.external":
        return { icon: ExternalLink, tone: "bg-muted text-muted-foreground", text: `Opened an outside website`, detail: c("url") };
      case "file.download":
        return { icon: Download, tone: "bg-info-soft text-info", text: `Downloaded ${c("file") ?? "a file"}`, detail: onPage(r) };
      case "data.copied":
        return { icon: Copy, tone: "bg-warning-soft text-warning", text: `Copied ${c("chars") ?? "some"} characters of text`, detail: onPage(r) };
      case "search.used":
        return { icon: Search, tone: "bg-muted text-muted-foreground",
          text: `Searched “${c("q") ?? ""}”`, detail: `${c("results") ?? 0} result(s) · ${c("opened") ? `opened ${c("opened")}` : "opened nothing"}` };
      case "session.idle":
        return { icon: Coffee, tone: "bg-muted text-muted-foreground", text: "Went idle (no activity for 10 minutes)", detail: onPage(r) };
      case "session.active":
        return { icon: Undo2, tone: "bg-muted text-muted-foreground", text: `Came back after about ${c("away_minutes") ?? "?"} minutes away`, detail: onPage(r) };
      case "session.closed":
        return { icon: SquareX, tone: "bg-muted text-muted-foreground", text: "Closed or refreshed the CRM tab", detail: onPage(r) };
      case "access.denied":
        return { icon: ShieldX, tone: "bg-danger-soft text-danger", text: "Tried to open a page they're not allowed to",
          detail: [c("from") && `from ${c("from")}`, c("permission") && `needs “${String(c("permission")).replace(/[._]/g, " ")}”`].filter(Boolean).join(" · ") || null };
    }
    const type = TABLE_LABEL[r.table_name ?? ""] ?? r.table_name?.replace(/_/g, " ") ?? "";
    const name = recordName(r);
    const href = r.table_name && HREF[r.table_name] && r.record_id && UUID.test(r.record_id) && r.action !== "delete"
      ? (HREF[r.table_name].endsWith("/") ? HREF[r.table_name] + r.record_id : HREF[r.table_name]) : null;
    if (r.action === "insert") {
      const text = r.table_name === "staff" && !r.actor_id ? `Login account created for ${name ?? String((r.new_data?.email as string | undefined) ?? "a new staff member")}` : `Added ${type.toLowerCase()}${name ? ` “${name}”` : ""}`;
      return { icon: Plus, tone: "bg-success-soft text-success", text, href };
    }
    if (r.action === "update") {
      const fields = (r.changed ?? []).filter((f) => !HIDDEN.has(f)).map((f) => f.replace(/_/g, " "));
      return { icon: Pencil, tone: "bg-info-soft text-info", text: `Changed ${type.toLowerCase()}${name ? ` “${name}”` : ""}`, detail: fields.length ? fields.join(", ") : null, href };
    }
    if (r.action === "delete") return { icon: Trash2, tone: "bg-danger-soft text-danger", text: `Removed ${type.toLowerCase()}${name ? ` “${name}”` : ""}` };
    if (r.action === "staff.password_reset") return { icon: KeyRound, tone: "bg-warning-soft text-warning", text: "Reset a staff password", href };
    return { icon: Sparkles, tone: "bg-warning-soft text-warning", text: r.action.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase()), detail: type || null, href };
  };

  // One entry per action: rows written together (same moment, same person) are one thing someone did.
  type Group = { key: string; at: string; actor: string | null; rows: Row[] };
  const groups: Group[] = [];
  for (const r of rows) {
    const g = groups.at(-1);
    if (g && g.at === r.occurred_at && g.actor === r.actor_id) g.rows.push(r);
    else groups.push({ key: String(r.id), at: r.occurred_at, actor: r.actor_id, rows: [r] });
  }
  // …and grouped by day.
  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(iso));
  const today = todayPK();
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(now - 86400000));
  const days: { day: string; groups: Group[] }[] = [];
  for (const g of groups) {
    const d = dayOf(g.at);
    if (days.at(-1)?.day === d) days.at(-1)!.groups.push(g);
    else days.push({ day: d, groups: [g] });
  }
  const dayLabel = (d: string) => (d === today ? "Today" : d === yesterday ? "Yesterday"
    : new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TIMEZONE }).format(new Date(`${d}T12:00:00+05:00`)));

  const params = { table, actor, kind, from, to };
  const filtered = Object.values(params).some(Boolean);

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
              className={cn("flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 transition hover:ring-brand-muted", actor === s.id ? "ring-brand" : "ring-border")}>
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
          <select name="actor" defaultValue={actor} className={SELECT}>
            <option value="">Everyone</option>
            {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
          </select>
        </Field>
        <Field label="What">
          <select name="kind" defaultValue={kind} className={SELECT}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Record">
          <select name="table" defaultValue={table} className={SELECT}>
            <option value="">All records</option>
            {TABLES.map((t) => <option key={t} value={t}>{TABLE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="From"><input type="date" name="from" defaultValue={from} className={SELECT} /></Field>
        <Field label="To"><input type="date" name="to" defaultValue={to} className={SELECT} /></Field>
        <button className="h-10 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white" type="submit">Show</button>
        {filtered && <Link href="/admin/audit" className="h-10 px-2 text-sm leading-10 font-semibold text-brand hover:underline">Clear</Link>}
        <span className="ml-auto self-center text-xs text-muted-foreground">{(count ?? 0).toLocaleString("en-PK")} entries</span>
      </form>

      {!groups.length ? <EmptyState icon={FileClock} title={filtered ? "Nothing matches these filters" : "Nothing logged yet"} /> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {days.map((d) => (
            <section key={d.day}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{dayLabel(d.day)}</h2>
              <div className="divide-y overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
                {d.groups.map((g) => {
                  const main = describe(g.rows[0]);
                  const types = [...new Set(g.rows.map((r) => r.table_name).filter(Boolean))];
                  const extra = g.rows.length - 1;
                  return (
                    <AuditGroup key={g.key}
                      rows={g.rows.map((r) => { const x = describe(r); return { id: r.id, text: x.text, detail: x.detail ?? null, href: x.href ?? null, reason: r.reason, isChange: CHANGES.includes(r.action) }; })}
                      header={<>
                        <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", main.tone)}><main.icon className="size-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block">
                            <b className="font-semibold">{who(g.actor)}</b> <span>{main.text.charAt(0).toLowerCase() + main.text.slice(1)}</span>
                            {extra > 0 && <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">+{extra} more change{extra === 1 ? "" : "s"}</span>}
                          </span>
                          {(main.detail || (extra > 0 && types.length > 1)) && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {extra > 0 && types.length > 1 ? types.map((t) => `${TABLE_LABEL[t!] ?? t} ×${g.rows.filter((r) => r.table_name === t).length}`).join(" · ") : main.detail}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={formatDateTime(g.at)}>{formatTime(g.at)}</span>
                      </>} />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={params} />
    </>
  );
}

const SELECT = "h-10 max-w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-xs font-medium text-muted-foreground">{label}{children}</label>;
}
