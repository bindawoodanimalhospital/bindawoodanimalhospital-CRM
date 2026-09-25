import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, PageHeader, StatusPill } from "@/components/app/page-header";
import { NoticeToast } from "@/components/app/notice-toast";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { updateStaffProfile } from "../actions";
import { StaffProfileForm } from "../staff-form";
import { ActiveToggle, GrantRoleForm, ResetPasswordDialog, RevokeRoleButton } from "./widgets";

export const metadata: Metadata = { title: "Staff member" };

export default async function StaffMemberPage({ params }: PageProps<"/admin/staff/[id]">) {
  const me = await requireStaff("staff.view");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: s }, { data: allRoles }] = await Promise.all([
    supabase.from("staff")
      .select("*, staff_roles(role_id, valid_from, valid_until, roles(id, name, description))")
      .eq("id", id).maybeSingle(),
    supabase.from("roles").select("id, name").order("created_at"),
  ]);
  if (!s) notFound();

  const manage = me.can("staff.manage");
  type Grant = { role_id: string; valid_from: string; valid_until: string | null; roles: { id: string; name: string; description: string | null } };
  const grants = (s.staff_roles ?? []) as Grant[];
  const now = new Date();
  // Expired temporary roles can be granted again.
  const held = new Set(grants.filter((g) => !g.valid_until || new Date(g.valid_until) > now).map((g) => g.role_id));

  return (
    <>
      <Suspense><NoticeToast /></Suspense>
      <PageHeader
        back={{ href: "/admin/staff", label: "Staff" }}
        title={<span className="flex items-center gap-3">{s.full_name || s.email}
          <StatusPill tone={s.is_active ? "success" : "warning"}>{s.is_active ? "Active" : "Inactive"}</StatusPill></span>}
        description={[s.title, s.email].filter(Boolean).join(" · ")}
        actions={manage && (
          <>
            <ResetPasswordDialog staffId={s.id} />
            {s.id !== me.id && <ActiveToggle staffId={s.id} active={s.is_active} name={s.full_name || s.email} />}
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent>
            {manage ? (
              <StaffProfileForm action={updateStaffProfile.bind(null, s.id)} defaults={s} />
            ) : (
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Mobile">{formatPhone(s.phone)}</Field>
                <Field label="PVMC no.">{s.pvmc_number}</Field>
                <Field label="Doctor">{s.is_doctor ? "Yes" : "No"}</Field>
                <Field label="Joined">{formatDate(s.created_at)}</Field>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Roles</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <ul className="grid gap-2">
              {grants.length === 0 && <li className="text-sm text-muted-foreground">No roles — this person can&apos;t see anything.</li>}
              {grants.map((g) => {
                const expired = g.valid_until && new Date(g.valid_until) <= now;
                return (
                  <li key={g.role_id} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${expired ? "text-muted-foreground line-through" : ""}`}>{g.roles.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.valid_until ? `${expired ? "Ended" : "Until"} ${formatDateTime(g.valid_until)}` : `Since ${formatDate(g.valid_from)}`}
                      </p>
                    </div>
                    {manage && <RevokeRoleButton staffId={s.id} roleId={g.role_id} roleName={g.roles.name} />}
                  </li>
                );
              })}
            </ul>
            {manage && <GrantRoleForm staffId={s.id} roles={(allRoles ?? []).filter((r) => !held.has(r.id))} />}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
