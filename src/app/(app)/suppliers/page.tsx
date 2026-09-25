import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { SupplierDialog } from "./widgets";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const me = await requireStaff("suppliers.manage");
  const supabase = await createClient();
  const [{ data: suppliers }, { data: purchases }, { data: pays }] = await Promise.all([
    supabase.from("suppliers").select("id, name, contact_name, phone, is_active").order("name"),
    supabase.from("purchases").select("supplier_id, total, status"),
    supabase.from("supplier_payments").select("supplier_id, amount"),
  ]);
  const bought = new Map<string, number>(); const paid = new Map<string, number>(); const drafts = new Map<string, number>();
  for (const p of purchases ?? []) {
    if (p.status === "received") bought.set(p.supplier_id, (bought.get(p.supplier_id) ?? 0) + Number(p.total));
    if (p.status === "draft") drafts.set(p.supplier_id, (drafts.get(p.supplier_id) ?? 0) + 1);
  }
  for (const p of pays ?? []) paid.set(p.supplier_id, (paid.get(p.supplier_id) ?? 0) + Number(p.amount));
  const seeMoney = me.can("finance.view");

  return (
    <>
      <PageHeader title="Suppliers" description="Who you buy from, deliveries received and what you owe." actions={<SupplierDialog />} />
      {!suppliers?.length ? <EmptyState icon={Truck} title="No suppliers yet" description="Add your distributors, then receive deliveries into stock." /> : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
          <Table>
            <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead className="hidden md:table-cell">Contact</TableHead>
              {seeMoney && <><TableHead className="text-right">Bought</TableHead><TableHead className="text-right">You owe</TableHead></>}</TableRow></TableHeader>
            <TableBody>
              {suppliers.map((s) => {
                const owe = (bought.get(s.id) ?? 0) - (paid.get(s.id) ?? 0);
                return (
                  <TableRow key={s.id} className="relative">
                    <TableCell><Link href={`/suppliers/${s.id}`} className="font-semibold after:absolute after:inset-0">{s.name}</Link>
                      {drafts.get(s.id) ? <StatusPill tone="warning" className="ml-2">{drafts.get(s.id)} delivery not received</StatusPill> : null}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{[s.contact_name, formatPhone(s.phone)].filter(Boolean).join(" · ")}</TableCell>
                    {seeMoney && <>
                      <TableCell className="text-right tabular">{formatPKR(bought.get(s.id) ?? 0)}</TableCell>
                      <TableCell className="text-right">{owe > 0 ? <StatusPill tone="warning">{formatPKR(owe)}</StatusPill> : <span className="text-sm text-muted-foreground">—</span>}</TableCell>
                    </>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
