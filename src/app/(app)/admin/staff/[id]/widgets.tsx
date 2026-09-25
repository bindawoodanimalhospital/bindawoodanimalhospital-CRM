"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import type { FormState } from "@/lib/validation";
import { grantRole, resetPassword, revokeRole, setStaffActive } from "../actions";

function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(res.message); after?.(); } else toast.error(res.message);
    });
  return { pending, run };
}

export function GrantRoleForm({ staffId, roles }: { staffId: string; roles: { id: string; name: string }[] }) {
  const [roleId, setRoleId] = useState("");
  const [until, setUntil] = useState("");
  const { pending, run } = useAction();
  if (!roles.length) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 border-t pt-4">
      <FormField label="Add role" className="min-w-44 flex-1">
        <Select value={roleId} onValueChange={setRoleId}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Choose role" /></SelectTrigger>
          <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      <FormField label="Until (optional)" hint="For temporary shift cover">
        <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
      </FormField>
      <Button disabled={!roleId || pending} className="mb-5"
        onClick={() => run(() => grantRole(staffId, roleId, until || null), () => { setRoleId(""); setUntil(""); })}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} Grant
      </Button>
    </div>
  );
}

export function RevokeRoleButton({ staffId, roleId, roleName }: { staffId: string; roleId: string; roleName: string }) {
  const { pending, run } = useAction();
  return (
    <Button size="icon-xs" variant="ghost" title={`Remove ${roleName}`} disabled={pending}
      onClick={() => run(() => revokeRole(staffId, roleId))}>
      {pending ? <Loader2 className="animate-spin" /> : <X />}
    </Button>
  );
}

export function ActiveToggle({ staffId, active, name }: { staffId: string; active: boolean; name: string }) {
  const { pending, run } = useAction();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={active ? "destructive" : "default"} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} {active ? "Deactivate" : "Activate"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{active ? `Deactivate ${name}?` : `Activate ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {active
              ? "They will be signed out everywhere and lose all access immediately. Their history stays intact."
              : "They will be able to sign in with the access their roles give them."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => run(() => setStaffActive(staffId, !active))}>
            {active ? "Deactivate" : "Activate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ResetPasswordDialog({ staffId }: { staffId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><KeyRound /> Reset password</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set a new password</DialogTitle>
          <DialogDescription>Share it with the staff member in person or by phone — not in a group chat.</DialogDescription>
        </DialogHeader>
        <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
        <DialogFooter>
          <Button disabled={password.length < 8 || pending}
            onClick={() => run(() => resetPassword(staffId, password), () => { setOpen(false); setPassword(""); })}>
            {pending && <Loader2 className="animate-spin" />} Update password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
