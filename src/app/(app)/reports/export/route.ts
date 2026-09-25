import type { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentStaff, type CurrentStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPhone } from "@/lib/phone";
import { parseRange, type FinancialReport } from "@/lib/reports";
import type { Permission } from "@/lib/permissions";

type Col = { header: string; key: string; width?: number; money?: boolean };
type Row = Record<string, string | number | null>;
type Supabase = Awaited<ReturnType<typeof createClient>>;

const MAX_ROWS = 20_000;
const PAGE = 1000;
const pk = (ts: string | null) => (ts ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(new Date(ts)).replace(",", "") : null);
const range = (from: string, to: string) => ({ start: `${from}T00:00:00+05:00`, end: `${to}T23:59:59.999+05:00` });

/** PostgREST returns at most 1,000 rows per request — page through (RLS still applies to every page). */
async function all<T>(page: (lo: number, hi: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let lo = 0; lo < MAX_ROWS; lo += PAGE) {
    const { data, error } = await page(lo, lo + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

type Dataset = { title: string; needs: Permission[]; cols: Col[]; load: (s: Supabase, from: string, to: string) => Promise<Row[]> };

/* eslint-disable @typescript-eslint/no-explicit-any */
const one = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null;

const DATASETS: Record<string, Dataset> = {
  summary: {
    title: "Money summary", needs: ["reports.financial"],
    cols: [{ header: "Period starting", key: "bucket", width: 14 }, { header: "Billed (Rs.)", key: "billed", money: true },
      { header: "Collected (Rs.)", key: "collected", money: true }, { header: "Expenses (Rs.)", key: "expenses", money: true }],
    load: async (s, from, to) => {
      const { data, error } = await s.rpc("report_financial", { p_from: from, p_to: to });
      if (error) throw new Error(error.message);
      return (data as FinancialReport).series.map((r) => ({ ...r }));
    },
  },
  invoices: {
    title: "Bills", needs: ["billing.view"],
    cols: [{ header: "Bill no.", key: "number", width: 16 }, { header: "Issued", key: "issued", width: 17 }, { header: "Type", key: "kind" },
      { header: "Owner", key: "owner", width: 24 }, { header: "Mobile", key: "phone", width: 15 }, { header: "Pet", key: "pet" }, { header: "Status", key: "status" },
      { header: "Total (Rs.)", key: "total", money: true }, { header: "Discounts (Rs.)", key: "discounts", money: true },
      { header: "Returned (Rs.)", key: "returned", money: true }, { header: "Paid (Rs.)", key: "paid", money: true }, { header: "Balance (Rs.)", key: "balance", money: true }],
    load: async (s, from, to) => {
      const { start, end } = range(from, to);
      const rows = await all<any>((lo, hi) => s.from("invoices")
        .select("number, issued_at, kind, status, total, line_discounts, invoice_discount, returned_amount, amount_paid, balance, customers(full_name, phone), pets(name)")
        .in("status", ["issued", "void"]).gte("issued_at", start).lte("issued_at", end).order("issued_at").range(lo, hi));
      return rows.map((r) => ({ number: r.number, issued: pk(r.issued_at), kind: r.kind === "store" ? "Pet store" : "Clinic",
        owner: one(r.customers)?.full_name ?? "Walk-in", phone: formatPhone(one(r.customers)?.phone) || null, pet: one(r.pets)?.name ?? null,
        status: r.status === "void" ? "Cancelled" : "Issued", total: Number(r.total), discounts: Number(r.line_discounts) + Number(r.invoice_discount),
        returned: Number(r.returned_amount), paid: Number(r.amount_paid), balance: Number(r.balance) }));
    },
  },
  payments: {
    title: "Payments", needs: ["billing.view"],
    cols: [{ header: "Receipt", key: "code", width: 14 }, { header: "Received", key: "at", width: 17 }, { header: "Type", key: "kind" },
      { header: "Owner", key: "owner", width: 24 }, { header: "Method", key: "method" }, { header: "Reference", key: "reference", width: 16 },
      { header: "Amount (Rs.)", key: "amount", money: true }],
    load: async (s, from, to) => {
      const { start, end } = range(from, to);
      const rows = await all<any>((lo, hi) => s.from("payments").select("code, received_at, kind, method, reference, amount, customers(full_name)")
        .gte("received_at", start).lte("received_at", end).order("received_at").range(lo, hi));
      return rows.map((r) => ({ code: r.code, at: pk(r.received_at), kind: r.kind === "payment" ? "Payment" : r.kind === "refund" ? "Refund" : "Written off",
        owner: one(r.customers)?.full_name ?? "Walk-in", method: r.method, reference: r.reference,
        amount: r.kind === "refund" ? -Number(r.amount) : Number(r.amount) }));
    },
  },
  dues: {
    title: "Unpaid bills", needs: ["billing.view"],
    cols: [{ header: "Owner", key: "owner", width: 24 }, { header: "Mobile", key: "phone", width: 15 }, { header: "Bill no.", key: "number", width: 16 },
      { header: "Promised date", key: "promised", width: 13 }, { header: "Reason", key: "reason", width: 30 }, { header: "Missed promises", key: "missed" },
      { header: "Original (Rs.)", key: "original", money: true }, { header: "Still owed (Rs.)", key: "balance", money: true }],
    load: async (s) => {
      const rows = await all<any>((lo, hi) => s.from("dues").select("promised_date, reason, missed_promises, original_amount, invoices(number, balance), customers(full_name, phone)")
        .eq("status", "open").order("promised_date").range(lo, hi));
      return rows.map((r) => ({ owner: one(r.customers)?.full_name, phone: formatPhone(one(r.customers)?.phone) || null, number: one(r.invoices)?.number,
        promised: r.promised_date, reason: r.reason, missed: r.missed_promises, original: Number(r.original_amount), balance: Number(one(r.invoices)?.balance ?? 0) }));
    },
  },
  expenses: {
    title: "Expenses", needs: ["expenses.view"],
    cols: [{ header: "Date", key: "date", width: 12 }, { header: "Category", key: "category", width: 18 }, { header: "Paid to", key: "payee", width: 20 },
      { header: "Description", key: "description", width: 32 }, { header: "Method", key: "method" }, { header: "Reference", key: "reference" },
      { header: "Amount (Rs.)", key: "amount", money: true }],
    load: async (s, from, to) => {
      const rows = await all<any>((lo, hi) => s.from("expenses").select("spent_on, payee, description, method, reference, amount, expense_categories(name)")
        .gte("spent_on", from).lte("spent_on", to).order("spent_on").range(lo, hi));
      return rows.map((r) => ({ date: r.spent_on, category: one(r.expense_categories)?.name, payee: r.payee, description: r.description,
        method: r.method, reference: r.reference, amount: Number(r.amount) }));
    },
  },
  visits: {
    title: "Visits", needs: [],
    cols: [{ header: "Date", key: "date", width: 12 }, { header: "Token", key: "token" }, { header: "Pet", key: "pet" }, { header: "Species", key: "species" },
      { header: "Owner", key: "owner", width: 24 }, { header: "Doctor", key: "doctor", width: 20 }, { header: "Visit type", key: "type", width: 18 },
      { header: "Priority", key: "priority" }, { header: "Status", key: "status" }, { header: "Checked in", key: "in", width: 17 },
      { header: "Seen", key: "seen", width: 17 }, { header: "Completed", key: "done", width: 17 }],
    load: async (s, from, to) => {
      const rows = await all<any>((lo, hi) => s.from("visits")
        .select("visit_date, token_no, priority, status, checked_in_at, started_at, completed_at, pets(name, species(name)), customers(full_name), doctor:doctor_id(full_name), appointment_types(name)")
        .gte("visit_date", from).lte("visit_date", to).order("visit_date").order("token_no").range(lo, hi));
      return rows.map((r) => ({ date: r.visit_date, token: r.token_no, pet: one(r.pets)?.name, species: one(one(r.pets)?.species)?.name,
        owner: one(r.customers)?.full_name, doctor: one(r.doctor)?.full_name ?? null, type: one(r.appointment_types)?.name ?? "Walk-in",
        priority: r.priority, status: String(r.status).replaceAll("_", " "), in: pk(r.checked_in_at), seen: pk(r.started_at), done: pk(r.completed_at) }));
    },
  },
  customers: {
    title: "Pet owners", needs: ["customers.view"],
    cols: [{ header: "ID", key: "code", width: 10 }, { header: "Name", key: "name", width: 24 }, { header: "Mobile", key: "phone", width: 15 },
      { header: "WhatsApp", key: "whatsapp", width: 15 }, { header: "Area", key: "area", width: 18 }, { header: "City", key: "city" },
      { header: "Language", key: "lang" }, { header: "OK to receive offers", key: "optin" }, { header: "Found us via", key: "referral", width: 16 },
      { header: "Registered", key: "registered", width: 12 }],
    load: async (s) => {
      const rows = await all<any>((lo, hi) => s.from("customers")
        .select("code, full_name, phone, whatsapp, area, city, preferred_language, marketing_opt_in, referral_source, created_at")
        .neq("status", "merged").order("created_at").range(lo, hi));
      return rows.map((r) => ({ code: r.code, name: r.full_name, phone: formatPhone(r.phone) || null, whatsapp: formatPhone(r.whatsapp) || null,
        area: r.area, city: r.city, lang: r.preferred_language === "en" ? "English" : "Urdu", optin: r.marketing_opt_in ? "Yes" : "No",
        referral: r.referral_source, registered: pk(r.created_at)?.slice(0, 10) ?? null }));
    },
  },
  stock: {
    title: "Stock levels", needs: ["inventory.view"],
    cols: [{ header: "Item", key: "name", width: 28 }, { header: "Category", key: "category", width: 16 }, { header: "Unit", key: "unit" },
      { header: "Usable", key: "usable" }, { header: "Expired (remove)", key: "expired" }, { header: "Reorder level", key: "reorder" },
      { header: "Next expiry", key: "expiry", width: 12 }, { header: "Sale price (Rs.)", key: "price", money: true }],
    load: async (s) => {
      const rows = await all<any>((lo, hi) => s.from("stock_levels").select("name, category, unit, usable_qty, expired_qty, reorder_level, next_expiry, sale_price")
        .order("name").range(lo, hi));
      return rows.map((r) => ({ name: r.name, category: r.category, unit: r.unit, usable: Number(r.usable_qty), expired: Number(r.expired_qty),
        reorder: r.reorder_level == null ? null : Number(r.reorder_level), expiry: r.next_expiry, price: Number(r.sale_price) }));
    },
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function allowed(me: CurrentStaff, key: string, d: Dataset) {
  if (!me.can("data.export")) return false;
  if (key === "visits") return me.can("queue.manage") || me.can("clinical.view");
  return d.needs.every((p) => me.can(p));
}

/** Text that a spreadsheet could run as a formula gets a leading apostrophe. */
function safeText(v: string) {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function toCsv(cols: Col[], rows: Row[]) {
  const cell = (v: string | number | null) => {
    if (v == null) return "";
    if (typeof v === "number") return String(v);
    const s = safeText(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  // BOM so Excel opens Urdu names correctly.
  return "﻿" + [cols.map((c) => cell(c.header)).join(","), ...rows.map((r) => cols.map((c) => cell(r[c.key])).join(","))].join("\r\n");
}

async function toXlsx(title: string, cols: Col[], rows: Row[], note: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bin Dawood Animal Hospital CRM";
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ state: "frozen", ySplit: 2 }] });
  ws.addRow([note]).font = { italic: true, color: { argb: "FF6B6B6B" } };
  const head = ws.addRow(cols.map((c) => c.header));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7A1F30" } }; });
  for (const r of rows) ws.addRow(cols.map((c) => { const v = r[c.key]; return typeof v === "string" ? safeText(v) : v; }));
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? Math.max(10, c.header.length + 2);
    if (c.money) col.numFmt = "#,##0";
  });
  if (rows.length && cols.some((c) => c.money)) {
    const total = ws.addRow(cols.map((c, i) => (i === 0 ? "Total" : c.money ? rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0) : null)));
    total.font = { bold: true };
  }
  return wb.xlsx.writeBuffer();
}

export async function GET(request: NextRequest) {
  const me = await getCurrentStaff();
  if (!me || !me.isActive) return new Response("Please sign in", { status: 401 });
  const q = request.nextUrl.searchParams;
  const key = q.get("dataset") ?? "";
  const d = DATASETS[key];
  if (!d) return new Response("Unknown export", { status: 404 });
  if (!allowed(me, key, d)) return new Response("You don't have permission to export this", { status: 403 });
  const format = q.get("format") === "csv" ? "csv" : "xlsx";
  const { from, to } = parseRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, range: q.get("range") ?? undefined });

  const supabase = await createClient();
  let rows: Row[];
  try {
    rows = await d.load(supabase, from, to);
  } catch (e) {
    return new Response(`Export failed: ${(e as Error).message}`, { status: 400 });
  }
  const snapshot = key === "dues" || key === "customers" || key === "stock";
  // Record the export before handing over the file — no audit row, no file.
  const { error } = await supabase.rpc("log_export", {
    p_dataset: key, p_rows: rows.length, p_filters: snapshot ? { snapshot: true, format } : { from, to, format },
  });
  if (error) return new Response(`Export not allowed: ${error.message}`, { status: 403 });

  const name = `BDAH-${key}-${snapshot ? to : `${from}_to_${to}`}.${format}`;
  const note = `${d.title} · ${snapshot ? `as of ${to}` : `${from} to ${to}`} · exported by ${me.fullName} · ${rows.length} rows${rows.length >= MAX_ROWS ? " (limit reached — use a shorter date range)" : ""}`;
  const headers = { "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" };
  if (format === "csv") return new Response(toCsv(d.cols, rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  const buf = await toXlsx(d.title, d.cols, rows, note);
  return new Response(buf as ArrayBuffer, { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
}
