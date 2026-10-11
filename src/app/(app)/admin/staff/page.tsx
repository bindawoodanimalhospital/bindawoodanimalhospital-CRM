import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatusPill } from "@/components/app/page-header";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPhone } from "@/lib/phone";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const me = await requireStaff("staff.view");
  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("staff")
    .select("id, full_name, email, phone, title, is_active, is_doctor, created_at, staff_roles(valid_until, roles(name))")
    .order("is_active", { ascending: false })
    .order("full_name");

  return (
    <>
      <PageHeader
        title="Staff"
        description="One login per person. A person can hold several roles (e.g. Intern + Store Staff)."
        actions={me.can("staff.manage") && (
          <Button asChild><Link href="/admin/staff/new"><UserPlus /> Add staff</Link></Button>
        )}
      />
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
            {(staff ?? []).map((s) => {
              const roles = (s.staff_roles ?? []) as unknown as { valid_until: string | null; roles: { name: string } }[];
              const current = roles.filter((r) => !r.valid_until || new Date(r.valid_until) > new Date());
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
