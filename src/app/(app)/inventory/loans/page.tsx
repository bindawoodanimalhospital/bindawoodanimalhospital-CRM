import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Building2, Pencil, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LOAN_STATUS, qtyText } from "./labels";
import { LoanDialog, PARTNER_KIND, PartnerDialog } from "./widgets";

export const metadata: Metadata = { title: "Stock loans" };
const PAGE = 30;

type LoanRow = {
  id: string; code: string; direction: "borrowed" | "lent"; loan_date: string; expected_return_date: string | null; status: string;
  partner_businesses: { id: string; name: string } | null;
  stock_loan_lines: { qty: number; returned_qty: number; unit: string; item_id: string; catalog_items: { name: string } | null }[];
};

export default async function StockLoansPage({ searchParams }: PageProps<"/inventory/loans">) {
  const me = await requireStaff();
  if (!me.can("inventory.view")) redirect("/dashboard?denied=1");
  const canManage = me.can("inventory.manage");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const view = str("view") === "all" ? "all" : "open";
  const direction = ["borrowed", "lent"].includes(str("dir")) ? str("dir") : "";
  const partner = str("partner");
  const status = Object.keys(LOAN_STATUS).includes(str("status")) ? str("status") : "";
  const product = str("q").replace(/[%_,()]/g, "");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str("from")) ? str("from") : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(str("to")) ? str("to") : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const today = todayPK();
  const supabase = await createClient();

  // Product filter: loans that contain a matching product.
  let loanIdsForProduct: string[] | null = null;
  if (product) {
    const { data } = await supabase.from("stock_loan_lines").select("loan_id, catalog_items!inner(name)").ilike("catalog_items.name", `%${product}%`).limit(500);
    loanIdsForProduct = [...new Set((data ?? []).map((r) => r.loan_id))];
  }

  let q = supabase.from("stock_loans")
    .select(`id, code, direction, loan_date, expected_return_date, status, partner_businesses(id, name),
      stock_loan_lines(qty, returned_qty, unit, item_id, catalog_items(name))`, { count: "exact" })
    .order("loan_date", { ascending: false }).order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (view === "open") q = q.in("status", ["pending_return", "partially_returned"]);
  if (status) q = q.eq("status", status);
  if (direction) q = q.eq("direction", direction);
  if (partner) q = q.eq("partner_id", partner);
  if (from) q = q.gte("loan_date", from);
  if (to) q = q.lte("loan_date", to);
  if (loanIdsForProduct) q = q.in("id", loanIdsForProduct.length ? loanIdsForProduct : ["00000000-0000-0000-0000-000000000000"]);

  const [{ data, count }, { data: partners }, { data: outstanding }, { data: locations }] = await Promise.all([
    q,
    supabase.from("partner_businesses").select("id, name, kind, contact_name, phone, address, notes, is_active").order("name"),
    supabase.from("stock_loan_outstanding").select("partner_id, partner_name, direction, item_name, unit, outstanding_qty, is_overdue, loan_id"),
    supabase.from("inventory_locations").select("id, name, is_default").eq("is_active", true).order("sort_order"),
  ]);
  const loans = (data ?? []) as unknown as LoanRow[];
  const out = outstanding ?? [];
  const overdueLoans = new Set(out.filter((o) => o.is_overdue).map((o) => o.loan_id)).size;

  // Who owes what, per business (spec: "identify which business owes a return").
  const byPartner = new Map<string, { name: string; weOwe: string[]; theyOwe: string[]; overdue: boolean }>();
  for (const o of out) {
    const p = byPartner.get(o.partner_id) ?? { name: o.partner_name, weOwe: [], theyOwe: [], overdue: false };
    (o.direction === "borrowed" ? p.weOwe : p.theyOwe).push(`${qtyText(o.outstanding_qty)} ${o.unit} ${o.item_name}`);
    p.overdue ||= o.is_overdue;
    byPartner.set(o.partner_id, p);
  }
  const activePartners = (partners ?? []).filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name, kind: p.kind }));
  const locs = (locations ?? []).map((l) => ({ id: l.id, name: l.name }));
  const defaultLoc = locations?.find((l) => l.is_default)?.id ?? locations?.[0]?.id ?? "";
  const params = { view, dir: direction, partner, status, q: product, from, to };
  const href = (patch: Record<string, string>) => `?${new URLSearchParams(Object.entries({ ...params, ...patch }).filter(([, v]) => v))}`;

  return (
    <>
      <PageHeader back={{ href: "/inventory", label: "Inventory" }} title="Stock borrowed & lent"
        description="Products borrowed from or lent to nearby clinics and pet stores until stock is replenished. Not purchases or sales."
        actions={canManage && (
          <>
            <LoanDialog direction="lent" partners={activePartners} locations={locs} defaultLocation={defaultLoc} />
            <LoanDialog direction="borrowed" partners={activePartners} locations={locs} defaultLocation={defaultLoc} />
          </>
        )} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="We owe back" value={new Set(out.filter((o) => o.direction === "borrowed").map((o) => o.loan_id)).size} sub="borrowed records open" icon={ArrowDownToLine} />
        <Tile label="Owed to us" value={new Set(out.filter((o) => o.direction === "lent").map((o) => o.loan_id)).size} sub="lent records open" icon={ArrowUpFromLine} />
        <Tile label="Overdue returns" value={overdueLoans} sub="past the expected date" icon={ArrowLeftRight} danger={overdueLoans > 0} />
      </div>

      {byPartner.size > 0 && (
        <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...byPartner.entries()].map(([id, p]) => (
            <Link key={id} href={href({ partner: id, view: "open" })}
              className={cn("rounded-2xl bg-card p-4 shadow-card ring-1 ring-border transition hover:ring-brand-muted", p.overdue && "ring-danger/40")}>
              <p className="flex items-center gap-2 font-semibold"><Building2 className="size-4 text-brand" />{p.name}
                {p.overdue && <StatusPill tone="danger">Overdue</StatusPill>}</p>
              {p.weOwe.length > 0 && <p className="mt-2 text-sm"><span className="font-medium text-warning">We owe them:</span> {p.weOwe.join(", ")}</p>}
              {p.theyOwe.length > 0 && <p className="mt-1 text-sm"><span className="font-medium text-info">They owe us:</span> {p.theyOwe.join(", ")}</p>}
            </Link>
          ))}
        </section>
      )}

      <form className="mb-4 grid gap-2 rounded-2xl bg-card p-3 shadow-card ring-1 ring-border sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_9.5rem_9.5rem_auto]">
        <input type="hidden" name="view" value={view} />
        <select name="dir" defaultValue={direction} className="h-10 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Borrowed or lent">
          <option value="">Borrowed & lent</option><option value="borrowed">Borrowed (we owe)</option><option value="lent">Lent (owed to us)</option>
        </select>
        <select name="partner" defaultValue={partner} className="h-10 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Business">
          <option value="">All businesses</option>
          {(partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select name="status" defaultValue={status} className="h-10 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Return status">
          <option value="">Any status</option>
          {Object.entries(LOAN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <Input name="q" defaultValue={product} placeholder="Product…" aria-label="Product" />
        <Input name="from" type="date" defaultValue={from} aria-label="From date" title="From date" />
        <Input name="to" type="date" defaultValue={to} aria-label="To date" title="To date" />
        <Button type="submit" variant="outline">Filter</Button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        {[{ k: "open", l: "Outstanding" }, { k: "all", l: "All records" }].map((t) => (
          <Link key={t.k} href={href({ view: t.k, page: "" })} className={cn("inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold ring-1",
            view === t.k ? "bg-brand-gradient text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted")}>{t.l}</Link>
        ))}
      </div>

      {!loans.length ? (
        <EmptyState icon={ArrowLeftRight} title={view === "open" ? "Nothing borrowed or lent right now" : "No records match"}
          description="When you borrow stock from a nearby clinic, or lend them some, record it here so nobody forgets to return it." />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Record</TableHead><TableHead>Business</TableHead><TableHead className="hidden lg:table-cell">Products (outstanding)</TableHead>
              <TableHead className="hidden md:table-cell">Expected back</TableHead><TableHead className="text-right">Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loans.map((l) => {
                const overdue = !!l.expected_return_date && l.expected_return_date < today && ["pending_return", "partially_returned"].includes(l.status);
                const st = LOAN_STATUS[l.status];
                return (
                  <TableRow key={l.id} className="relative">
                    <TableCell>
                      <Link href={`/inventory/loans/${l.id}`} className="font-semibold after:absolute after:inset-0">{l.code}</Link>
                      <StatusPill tone={l.direction === "borrowed" ? "warning" : "info"} className="ml-2">{l.direction === "borrowed" ? "Borrowed" : "Lent"}</StatusPill>
                      <span className="block text-xs text-muted-foreground">{formatDate(l.loan_date)}</span>
                    </TableCell>
                    <TableCell>{l.partner_businesses?.name}</TableCell>
                    <TableCell className="hidden max-w-sm lg:table-cell">
                      <span className="line-clamp-2 text-sm">
                        {l.stock_loan_lines.map((ln) => `${ln.catalog_items?.name}: ${qtyText(ln.qty - ln.returned_qty)} of ${qtyText(ln.qty)} ${ln.unit}`).join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell className={cn("hidden md:table-cell", overdue && "font-semibold text-danger")}>
                      {l.expected_return_date ? formatDate(l.expected_return_date) : <span className="text-muted-foreground">—</span>}{overdue && " · overdue"}
                    </TableCell>
                    <TableCell className="text-right"><StatusPill tone={st.tone}>{st.label}</StatusPill></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE} total={count ?? 0} params={params} />

      {(partners?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Nearby businesses</h2>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {(partners ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 ring-border">
                <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand"><Building2 className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[PARTNER_KIND[p.kind], p.contact_name].filter(Boolean).join(" · ")}
                    {p.phone && <a href={`tel:${p.phone}`} className="ml-1 inline-flex items-center gap-0.5 hover:text-brand"><Phone className="size-3" />{p.phone}</a>}
                  </span>
                </span>
                {canManage && <PartnerDialog partner={p} trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.name}`}><Pencil /></Button>} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Tile({ label, value, sub, icon: Icon, danger }: { label: string; value: number; sub: string; icon: React.ComponentType<{ className?: string }>; danger?: boolean }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" />{label}</p>
      <p className={cn("mt-1 text-3xl font-bold tabular", danger && "text-danger")}>{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
