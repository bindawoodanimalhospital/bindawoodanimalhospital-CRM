import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { searchPattern } from "@/lib/queries";
import { formatDate } from "@/lib/format";
import { formatPhone, whatsappLink } from "@/lib/phone";

export const metadata: Metadata = { title: "Customers" };
const PAGE_SIZE = 25;

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const me = await requireStaff("customers.view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, code, full_name, phone, whatsapp, area, created_at, pet_owners(pets(name, status))", { count: "exact" })
    .neq("status", "merged")
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const pattern = searchPattern(q);
  if (pattern) query = query.ilike("search_text", pattern);
  const { data: customers, count } = await query;

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${count ?? 0} pet owner${count === 1 ? "" : "s"}`}
        actions={me.can("customers.create") && (
          <Button asChild><Link href="/customers/new"><UserPlus /> New customer</Link></Button>
        )}
      />
      <form className="mb-4 max-w-sm">
        <Input name="q" defaultValue={q} placeholder="Filter by name, phone, area or ID…" className="bg-card" />
      </form>

      {!customers?.length ? (
        <EmptyState icon={Users} title={q ? "No matching customers" : "No customers yet"}
          description={q ? "Try a different spelling or the phone number." : "Register the first pet owner to get started."} />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="hidden md:table-cell">Area</TableHead>
                <TableHead className="hidden lg:table-cell">Pets</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => {
                const pets = (c.pet_owners ?? []).flatMap((po) => {
                  const p = po.pets as unknown as { name: string; status: string } | null;
                  return p && p.status === "active" ? [p.name] : [];
                });
                const wa = whatsappLink(c.whatsapp);
                return (
                  <TableRow key={c.id} className="relative">
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.code}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/customers/${c.id}`} className="after:absolute after:inset-0">{c.full_name}</Link>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        {formatPhone(c.phone)}
                        {wa && (
                          <a href={wa} target="_blank" rel="noreferrer" className="relative z-10 text-success" title="WhatsApp">
                            <MessageCircle className="size-3.5" />
                          </a>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{c.area}</TableCell>
                    <TableCell className="hidden max-w-56 truncate lg:table-cell">{pets.join(", ")}</TableCell>
                    <TableCell className="hidden text-right text-muted-foreground sm:table-cell">{formatDate(c.created_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={{ q }} />
    </>
  );
}
