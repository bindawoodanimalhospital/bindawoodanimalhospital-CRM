"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban, Coffee, Copy, Download, ExternalLink, Eye, FileClock, KeyRound, Loader2, LogIn, LogOut, Mail, MessageCircle, Pencil, Phone, Plus, Printer,
  Search, ShieldAlert, ShieldX, Sparkles, SquareX, Trash2, Undo2, type LucideIcon, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/page-header";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime, formatTime, TIMEZONE } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AuditGroup } from "./audit-group";
import { applyFilters, BATCH, CHANGES, COLUMNS, TABLE_LABEL, UUID, type LogFilters, type LogRow } from "./log-model";

/** Where a record lives in the app, for "open" links. */
const HREF: Record<string, string> = {
  customers: "/customers/", pets: "/pets/", invoices: "/billing/", visits: "/visits/", staff: "/admin/staff/",
  surgeries: "/surgery/", catalog_items: "/inventory/", tasks: "/tasks",
};
/** Keys that are noise in a list of changed fields. */
const HIDDEN = new Set(["search_text", "updated_at", "created_at", "idempotency_key", "refresh_token_hmac_key"]);

/** "Chrome on Windows" from a browser user-agent string. */
function device(ua: unknown) {
  if (typeof ua !== "string" || !ua) return null;
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android phone" : /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${b} on ${os}` : b;
}
const pageTitle = (r: LogRow) => String(r.context?.title ?? "").replace(/\s*·\s*Bin Dawood Animal Hospital$/, "").trim();

/**
 * The log itself, newest first, grouped by day and by action. The page renders the first batch;
 * more is fetched as you scroll (or with "Load more"), so a long log never loads all at once.
 */
export function ActivityFeed({ initial, total, filters, names, roleNames }: {
  initial: LogRow[]; total: number; filters: LogFilters; names: Record<string, string>; roleNames: Record<string, string>;
}) {
  const [rows, setRows] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initial.length < BATCH);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    if (busy.current || done) return;
    busy.current = true; setLoading(true);
    const last = rows.at(-1);
    let q = createClient().from("audit_logs").select(COLUMNS)
      .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(BATCH);
    q = applyFilters(q, filters);
    // Continue strictly after the last entry shown (same order as the page: newest first).
    if (last) q = q.or(`occurred_at.lt."${last.occurred_at}",and(occurred_at.eq."${last.occurred_at}",id.lt.${last.id})`);
    const { data } = await q;
    const more = (data ?? []) as LogRow[];
    setRows((r) => [...r, ...more.filter((m) => !r.some((x) => x.id === m.id))]);
    if (more.length < BATCH) setDone(true);
    setLoading(false); busy.current = false;
  }, [rows, done, filters]);

  // Load the next batch when the bottom of the list comes into view. IntersectionObserver, plus a
  // scroll check (captures scrolling inside the app's panel too) in case the observer is held back.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const near = () => el.getBoundingClientRect().top < window.innerHeight + 600;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) void loadMore(); }, { rootMargin: "600px" });
    io.observe(el);
    const onScroll = () => { if (near()) void loadMore(); };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", onScroll, { capture: true }); };
  }, [loadMore, done]);

  const who = useCallback((id: string | null) => (id ? names[id] ?? "Unknown user" : "System"), [names]);
  const describe = useMemo(() => makeDescribe(names, roleNames), [names, roleNames]);

  // One entry per action: rows written together (same moment, same person) are one thing someone did; then by day.
  const days = useMemo(() => {
    type Group = { key: string; at: string; actor: string | null; rows: LogRow[] };
    const groups: Group[] = [];
    for (const r of rows) {
      const g = groups.at(-1);
      if (g && g.at === r.occurred_at && g.actor === r.actor_id) g.rows.push(r);
      else groups.push({ key: String(r.id), at: r.occurred_at, actor: r.actor_id, rows: [r] });
    }
    const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(iso));
    const out: { day: string; groups: Group[] }[] = [];
    for (const g of groups) {
      const d = dayOf(g.at);
      if (out.at(-1)?.day === d) out.at(-1)!.groups.push(g);
      else out.push({ day: d, groups: [g] });
    }
    return out;
  }, [rows]);

  if (!rows.length) return <EmptyState icon={FileClock} title={Object.values(filters).some(Boolean) ? "Nothing matches these filters" : "Nothing logged yet"} />;

  return (
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
      <div ref={sentinel} className="flex flex-col items-center gap-2 py-2 text-sm text-muted-foreground">
        {done ? <span>{rows.length >= total ? "That's everything." : `Showing ${rows.length.toLocaleString("en-PK")} entries.`}</span> : (
          <>
            <span>Showing {rows.length.toLocaleString("en-PK")} of {total.toLocaleString("en-PK")} entries</span>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadMore()}>
              {loading && <Loader2 className="animate-spin" />} {loading ? "Loading…" : "Load more"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function dayLabel(d: string) {
  const fmt = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(x);
  const now = new Date();
  if (d === fmt(now)) return "Today";
  if (d === fmt(new Date(now.getTime() - 86400000))) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TIMEZONE }).format(new Date(`${d}T12:00:00+05:00`));
}

type Described = { icon: LucideIcon; tone: string; text: string; detail?: string | null; href?: string | null };

function makeDescribe(names: Record<string, string>, roleNames: Record<string, string>) {
  /** Human name of the record a row is about. */
  const recordName = (r: LogRow): string | null => {
    const d = r.new_data ?? r.old_data;
    if (!d) return null;
    if (r.table_name === "staff_roles") return `${names[String(d.staff_id)] ?? "staff"} → ${roleNames[String(d.role_id)] ?? "role"}`;
    if (r.table_name === "role_permissions") return `${roleNames[String(d.role_id)] ?? "role"} → ${String(d.permission_key ?? "")}`;
    const raw = d.full_name ?? d.name ?? d.label ?? d.title ?? d.number ?? d.code ?? d.description ?? d.key ?? null;
    return raw != null && String(raw).trim() && !UUID.test(String(raw)) ? String(raw) : null;
  };
  const onPage = (r: LogRow) => (pageTitle(r) ? `on ${pageTitle(r)}` : r.record_id);

  /** One line describing what a single row did. */
  return (r: LogRow): Described => {
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
      case "order.cancelled":
        return { icon: Ban, tone: "bg-danger-soft text-danger", text: `Cancelled order ${c("number") ?? ""}`.trim(),
          detail: [r.reason, Number(c("refunded") ?? 0) > 0 ? `refunded Rs. ${Number(c("refunded")).toLocaleString("en-PK")}` : null].filter(Boolean).join(" · ") || null,
          href: r.record_id ? `/billing/${r.record_id}` : null };
      case "batch.edited": {
        const fmt = (x: { batch_no?: string; expiry?: string | null; qty?: number }) =>
          `${x.qty ?? ""} ${x.expiry ? `exp ${x.expiry}` : "no expiry"}${x.batch_no ? ` (batch ${x.batch_no})` : ""}`.trim();
        const before = (r.context?.before ?? {}) as { batch_no?: string; expiry?: string | null; qty?: number };
        const after = (r.context?.after ?? []) as { batch_no?: string; expiry?: string | null; qty?: number }[];
        return { icon: CalendarClock, tone: "bg-muted text-muted-foreground", text: `Changed expiry / batch of ${c("item") ?? "a product"}`,
          detail: [`${fmt(before)} → ${after.map(fmt).join(" + ")}`, r.reason].filter(Boolean).join(" · ") };
      }
      case "customer.deleted":
        return { icon: Trash2, tone: "bg-danger-soft text-danger", text: `Deleted pet owner “${c("name") ?? ""}”${c("code") ? ` (${c("code")})` : ""}`,
          detail: [r.reason, Number(c("pets_deleted") ?? 0) > 0 ? `with ${c("pets_deleted")} pet(s)` : null].filter(Boolean).join(" · ") || null };
      case "pet.deleted":
        return { icon: Trash2, tone: "bg-danger-soft text-danger", text: `Deleted pet “${c("name") ?? ""}”${c("code") ? ` (${c("code")})` : ""}`, detail: r.reason };
      case "item.deleted":
        return { icon: Trash2, tone: "bg-danger-soft text-danger", text: `Deleted price-list item “${c("name") ?? ""}”`,
          detail: [r.reason, c("price") != null ? `was Rs. ${Number(c("price")).toLocaleString("en-PK")}` : null].filter(Boolean).join(" · ") || null };
      case "invoice.refund":
        return { icon: Undo2, tone: "bg-warning-soft text-warning", text: `Refunded Rs. ${Number(c("amount") ?? 0).toLocaleString("en-PK")}`,
          detail: r.reason, href: r.record_id ? `/billing/${r.record_id}` : null };
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
    return { icon: Sparkles, tone: "bg-warning-soft text-warning", text: r.action.replace(/[._]/g, " ").replace(/^./, (x) => x.toUpperCase()), detail: type || null, href };
  };
}
