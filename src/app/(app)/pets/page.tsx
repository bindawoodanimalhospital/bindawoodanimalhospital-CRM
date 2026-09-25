import type { Metadata } from "next";
import Link from "next/link";
import { PawPrint } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, StatusPill } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSpeciesOptions, searchPattern } from "@/lib/queries";
import { formatAge, sentence } from "@/lib/format";

export const metadata: Metadata = { title: "Pets" };
const PAGE_SIZE = 25;

export default async function PetsPage({ searchParams }: PageProps<"/pets">) {
  await requireStaff("pets.view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const speciesFilter = typeof sp.species === "string" ? sp.species : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  let query = supabase
    .from("pets")
    .select(`id, code, name, sex, date_of_birth, dob_is_estimate, status, breed_text, special_handling,
      species(name), breeds(name), pet_owners(is_primary, customers(id, full_name))`, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const pattern = searchPattern(q);
  if (pattern) query = query.ilike("search_text", pattern);
  if (speciesFilter) query = query.eq("species_id", speciesFilter);
  const [{ data: pets, count }, species] = await Promise.all([query, getSpeciesOptions()]);

  return (
    <>
      <PageHeader title="Pets" description={`${count ?? 0} patient${count === 1 ? "" : "s"}`} />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Filter by pet name, ID, microchip…" className="max-w-sm bg-card" />
        <select name="species" defaultValue={speciesFilter}
          className="h-10 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="">All species</option>
          {species.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="h-10 rounded-xl border border-input bg-card px-4 text-sm font-semibold hover:bg-muted" type="submit">Filter</button>
      </form>

      {!pets?.length ? (
        <EmptyState icon={PawPrint} title={q || speciesFilter ? "No matching pets" : "No pets yet"}
          description="Pets are registered from the owner's profile." />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Species / breed</TableHead>
                <TableHead className="hidden md:table-cell">Age</TableHead>
                <TableHead className="hidden md:table-cell">Owner</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pets.map((p) => {
                const owners = (p.pet_owners ?? []) as unknown as { is_primary: boolean; customers: { id: string; full_name: string } | null }[];
                const owner = owners.find((o) => o.is_primary)?.customers ?? owners[0]?.customers;
                const sp = p.species as unknown as { name: string } | null;
                const br = p.breeds as unknown as { name: string } | null;
                return (
                  <TableRow key={p.id} className="relative">
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.code}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/pets/${p.id}`} className="after:absolute after:inset-0">{p.name}</Link>
                      {p.special_handling && <StatusPill tone="danger" className="ml-2">!</StatusPill>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{[sp?.name, br?.name ?? p.breed_text].filter(Boolean).join(" · ")}</TableCell>
                    <TableCell className="hidden md:table-cell">{formatAge(p.date_of_birth, p.dob_is_estimate)}</TableCell>
                    <TableCell className="hidden md:table-cell">{owner?.full_name}</TableCell>
                    <TableCell className="text-right">
                      <StatusPill tone={p.status === "active" ? "success" : "neutral"}>{sentence(p.status)}</StatusPill>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={{ q, species: speciesFilter }} />
    </>
  );
}
