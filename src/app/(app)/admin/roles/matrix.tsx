"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { cn } from "@/lib/utils";
import { createRole, deleteRole, setRolePermission } from "./actions";

type Role = { id: string; key: string; name: string; is_system: boolean; members: number };
type Perm = { key: string; module: string; label: string; is_sensitive: boolean };

export function PermissionMatrix({ roles, permissions, grants, editable }: {
  roles: Role[];
  permissions: Perm[];
  grants: string[]; // "roleId:permKey"
  editable: boolean;
}) {
  const [optimistic, toggle] = useOptimistic(new Set(grants), (state, { k, on }: { k: string; on: boolean }) => {
    const next = new Set(state);
    if (on) next.add(k); else next.delete(k);
    return next;
  });
  const [, start] = useTransition();

  const modules = [...new Set(permissions.map((p) => p.module))];

  const onToggle = (role: Role, perm: string, on: boolean) =>
    start(async () => {
      toggle({ k: `${role.id}:${perm}`, on });
      const res = await setRolePermission(role.id, perm, on);
      if (!res.ok) toast.error(res.message);
    });

  return (
    <div className="overflow-auto rounded-2xl bg-card shadow-card ring-1 ring-border">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b">
            <th className="w-72 px-4 py-3 text-left font-medium">Permission</th>
            {roles.map((r) => (
              <th key={r.id} className="px-2 py-3 text-center align-bottom text-xs font-medium">
                <div className="flex flex-col items-center gap-1">
                  <span>{r.name}</span>
                  <span className="font-normal text-muted-foreground">{r.members} staff</span>
                  {editable && !r.is_system && <DeleteRole role={r} />}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => (
            <ModuleRows key={m} module={m} permissions={permissions.filter((p) => p.module === m)} roles={roles}
              isOn={(r, p) => r.key === "owner" || optimistic.has(`${r.id}:${p}`)} editable={editable} onToggle={onToggle} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleRows({ module, permissions, roles, isOn, editable, onToggle }: {
  module: string; permissions: Perm[]; roles: Role[]; editable: boolean;
  isOn: (r: Role, p: string) => boolean; onToggle: (r: Role, p: string, on: boolean) => void;
}) {
  return (
    <>
      <tr className="bg-muted/50">
        <td colSpan={roles.length + 1} className="px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {module}
        </td>
      </tr>
      {permissions.map((p) => (
        <tr key={p.key} className="border-b last:border-0 hover:bg-muted/30">
          <td className="px-4 py-2">
            <span className={cn(p.is_sensitive && "font-medium")}>{p.label}</span>
            {p.is_sensitive && <Lock className="ml-1.5 inline size-3 text-warning" aria-label="Sensitive" />}
          </td>
          {roles.map((r) => (
            <td key={r.id} className="px-2 py-2 text-center">
              <Checkbox checked={isOn(r, p.key)} disabled={!editable || r.key === "owner"}
                onCheckedChange={(v) => onToggle(r, p.key, v === true)} aria-label={`${r.name}: ${p.label}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function DeleteRole({ role }: { role: Role }) {
  const [pending, start] = useTransition();
  return (
    <Button size="icon-xs" variant="ghost" title="Delete role" disabled={pending}
      onClick={() => {
        if (!confirm(`Delete the “${role.name}” role?`)) return;
        start(async () => {
          const res = await deleteRole(role.id);
          if (res.ok) toast.success(res.message); else toast.error(res.message);
        });
      }}>
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}

export function NewRoleDialog({ roles }: { roles: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> Custom role</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom role</DialogTitle>
          <DialogDescription>Start from an existing role and adjust the ticks in the matrix.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Groomer" /></FormField>
          <FormField label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
          <FormField label="Copy permissions from">
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Start empty" /></SelectTrigger>
              <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
        </div>
        <DialogFooter>
          <Button disabled={name.trim().length < 2 || pending} onClick={() => start(async () => {
            const res = await createRole(name, description, copyFrom || null);
            if (res.ok) { toast.success(res.message); setOpen(false); setName(""); setDescription(""); setCopyFrom(""); }
            else toast.error(res.message);
          })}>
            {pending && <Loader2 className="animate-spin" />} Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
