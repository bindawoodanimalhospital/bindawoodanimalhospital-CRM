import type { Metadata } from "next";
import Link from "next/link";
import { Crown, Mail, Phone, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPhone } from "@/lib/phone";
import { formatDate, initials } from "@/lib/format";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const me = await requireStaff("staff.view");
  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("staff")
    .select("id, full_name, email, phone, title, is_active, is_doctor, created_at, staff_roles!staff_roles_staff_id_fkey(valid_until, roles(key, name))")
    .order("is_active", { ascending: false })
    .order("full_name");

  type Row = NonNullable<typeof staff>[number];
  type RoleLink = { valid_until: string | null; roles: { key: string; name: string } };
  const currentRoles = (s: Row) => ((s.staff_roles ?? []) as unknown as RoleLink[])
    .filter((r) => !r.valid_until || new Date(r.valid_until) > new Date());
  // The clinic owner is shown on top in a card of their own; everyone else in the table below.
  const isOwner = (s: Row) => currentRoles(s).some((r) => r.roles.key === "owner");
  const owners = (staff ?? []).filter(isOwner);
  const team = (staff ?? []).filter((s) => !isOwner(s));

  return (
    <>
      <PageHeader
        title="Staff"
        description="One login per person. A person can hold several roles (e.g. Intern + Store Staff)."
        actions={me.can("staff.manage") && (
          <Button asChild><Link href="/admin/staff/new"><UserPlus /> Add staff</Link></Button>
        )}
      />
      {owners.map((o) => (
        <Link key={o.id} href={`/admin/staff/${o.id}`}
          className="relative mb-5 flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl bg-ink bg-hero-gradient p-5 text-white shadow-float shadow-brand/20 transition hover:brightness-110 md:p-6">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-lg font-bold ring-1 ring-white/25">{initials(o.full_name)}</span>
          <span className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase ring-1 ring-white/20">
              <Crown className="size-3.5" /> Owner
            </span>
            <span className="mt-1 block text-xl font-bold tracking-tight md:text-2xl">{o.full_name || o.email}</span>
            <span className="block text-sm text-white/70">{[o.title, currentRoles(o).map((r) => r.roles.name).join(" · ")].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="grid gap-1 text-sm text-white/80">
            <span className="inline-flex items-center gap-2"><Mail className="size-4" />{o.email}</span>
            {o.phone && <span className="inline-flex items-center gap-2"><Phone className="size-4" />{formatPhone(o.phone)}</span>}
          </span>
        </Link>
      ))}
      <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="hidden md:table-cell">Contact</TableHead>
              <TableHead className="hidden sm:table-cell">Since</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {team.map((s) => {
              const current = currentRoles(s);
              return (
                <TableRow key={s.id} className="relative">
                  <TableCell>
                    <Link href={`/admin/staff/${s.id}`} className="font-medium after:absolute after:inset-0">
                      {s.full_name || s.email}
                    </Link>
                    {s.title && <p className="text-xs text-muted-foreground">{s.title}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {current.length ? current.map((r) => (
                        <StatusPill key={r.roles.name} tone={r.valid_until ? "info" : "neutral"}>
                          {r.roles.name}{r.valid_until ? ` · until ${formatDate(r.valid_until)}` : ""}
                        </StatusPill>
                      )) : <span className="text-xs text-muted-foreground">No role</span>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {s.email}{s.phone ? <><br />{formatPhone(s.phone)}</> : null}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(s.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <StatusPill tone={s.is_active ? "success" : "warning"}>{s.is_active ? "Active" : "Inactive"}</StatusPill>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
