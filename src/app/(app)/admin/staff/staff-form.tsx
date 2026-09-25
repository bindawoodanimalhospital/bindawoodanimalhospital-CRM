"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FormField, FormSection } from "@/components/app/form-field";
import { useFormAction } from "@/hooks/use-form-action";
import { formatPhone } from "@/lib/phone";
import type { FormState } from "@/lib/validation";

type Role = { id: string; name: string; description: string | null };

export function StaffProfileFields({ errors, defaults = {} }: {
  errors: Record<string, string>;
  defaults?: Partial<{ full_name: string; title: string | null; phone: string | null; pvmc_number: string | null; is_doctor: boolean }>;
}) {
  return (
    <>
      <FormField label="Full name" htmlFor="full_name" error={errors.full_name} required>
        <Input id="full_name" name="full_name" defaultValue={defaults.full_name} />
      </FormField>
      <FormField label="Job title" htmlFor="title" hint="e.g. Veterinary Surgeon, Receptionist">
        <Input id="title" name="title" defaultValue={defaults.title ?? ""} />
      </FormField>
      <FormField label="Mobile" htmlFor="phone">
        <Input id="phone" name="phone" inputMode="tel" defaultValue={formatPhone(defaults.phone)} />
      </FormField>
      <FormField label="PVMC registration no." htmlFor="pvmc_number" hint="Printed on prescriptions (doctors)">
        <Input id="pvmc_number" name="pvmc_number" defaultValue={defaults.pvmc_number ?? ""} />
      </FormField>
      <Label className="font-normal sm:col-span-2">
        <Checkbox name="is_doctor" defaultChecked={defaults.is_doctor} />
        Is a doctor (appears in doctor pickers & calendars)
      </Label>
    </>
  );
}

export function NewStaffForm({ action, roles }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  roles: Role[];
}) {
  const { pending, onSubmit, errors } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormSection title="Login" description="Staff sign in with this email and password. Share the password privately; they can't reset it themselves yet.">
        <FormField label="Email" htmlFor="email" error={errors.email} required>
          <Input id="email" name="email" type="email" autoComplete="off" />
        </FormField>
        <FormField label="Temporary password" htmlFor="password" error={errors.password} required hint="At least 8 characters">
          <Input id="password" name="password" type="text" autoComplete="new-password" />
        </FormField>
      </FormSection>
      <FormSection title="Profile">
        <StaffProfileFields errors={errors} />
      </FormSection>
      <FormSection title="Roles" description="Pick every role this person covers. Temporary cover roles can be added later with an end date.">
        {roles.map((r) => (
          <Label key={r.id} className="items-start font-normal">
            <Checkbox name="role" value={r.id} className="mt-0.5" />
            <span>
              <span className="font-medium">{r.name}</span>
              {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
            </span>
          </Label>
        ))}
        {errors.role && <p className="text-xs text-danger sm:col-span-2">{errors.role}</p>}
      </FormSection>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => history.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Create account</Button>
      </div>
    </form>
  );
}

export function StaffProfileForm({ action, defaults }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  defaults: Parameters<typeof StaffProfileFields>[0]["defaults"];
}) {
  const { pending, onSubmit, errors } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2"><StaffProfileFields errors={errors} defaults={defaults} /></div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save profile</Button>
      </div>
    </form>
  );
}
