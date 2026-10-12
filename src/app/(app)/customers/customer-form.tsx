"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, FormSection } from "@/components/app/form-field";
import { PetFields, type SpeciesOption } from "@/components/app/pet-fields";
import { useFormAction } from "@/hooks/use-form-action";
import { formatPhone } from "@/lib/phone";
import type { FormState } from "@/lib/validation";
import { findDuplicates, type DuplicateHit } from "./actions";

export type CustomerDefaults = Partial<{
  id: string; full_name: string; full_name_ur: string | null; phone: string | null; whatsapp: string | null;
  alt_phone: string | null; email: string | null; house_no: string | null; block: string | null; address: string | null; area: string | null; city: string;
  preferred_channel: string; preferred_language: string; marketing_opt_in: boolean; referral_source: string | null; notes: string | null;
}>;

export function CustomerForm({
  action, defaults = {}, species, referralSources, submitLabel, canContact,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  defaults?: CustomerDefaults;
  /** When provided, shows the optional "first pet" section (new customer only). */
  species?: SpeciesOption[];
  referralSources: string[];
  submitLabel: string;
  /** Only staff with customers.contact (Owner by default) see and enter phone numbers and email. */
  canContact: boolean;
}) {
  const { pending, onSubmit, errors } = useFormAction(action);
  const [phone, setPhone] = useState(formatPhone(defaults.phone) || "");
  const [name, setName] = useState(defaults.full_name ?? "");
  const [waSame, setWaSame] = useState(!defaults.whatsapp || defaults.whatsapp === defaults.phone);
  const [dupes, setDupes] = useState<DuplicateHit[]>([]);

  // Debounced duplicate check as reception types.
  useEffect(() => {
    const t = setTimeout(async () => setDupes(await findDuplicates(canContact ? phone : "", name, defaults.id)), 400);
    return () => clearTimeout(t);
  }, [phone, name, defaults.id, canContact]);

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      {dupes.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning-soft p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" /> Possible existing customer — avoid creating a duplicate
          </p>
          <ul className="mt-2 grid gap-1">
            {dupes.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 text-sm">
                <Link href={`/customers/${d.id}`} className="font-medium underline underline-offset-2">{d.full_name}</Link>
                <span className="text-muted-foreground">{[formatPhone(d.phone), d.area].filter(Boolean).join(" · ")}</span>
                <span className="font-mono text-xs text-muted-foreground">{d.code}</span>
                <span className="text-xs text-warning">({d.reason})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FormSection title="Owner">
        <FormField label="Full name" htmlFor="full_name" error={errors.full_name} required>
          <Input id="full_name" name="full_name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Name in Urdu" htmlFor="full_name_ur" hint="Optional">
          <Input id="full_name_ur" name="full_name_ur" dir="rtl" lang="ur" defaultValue={defaults.full_name_ur ?? ""} />
        </FormField>
        {canContact ? (
          <>
          <FormField label="Mobile number" htmlFor="phone" error={errors.phone} hint="Optional · e.g. 0300 1234567">
            <Input id="phone" name="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FormField>
          <FormField label="WhatsApp" htmlFor="whatsapp" error={errors.whatsapp}>
            <div className="grid gap-2">
              <Label className="font-normal">
                <Checkbox name="whatsapp_same" checked={waSame} onCheckedChange={(v) => setWaSame(v === true)} />
                Same as mobile
              </Label>
              {!waSame && (
                <Input id="whatsapp" name="whatsapp" inputMode="tel" defaultValue={formatPhone(defaults.whatsapp)} />
              )}
            </div>
          </FormField>
          <FormField label="Alternate phone" htmlFor="alt_phone" error={errors.alt_phone}>
            <Input id="alt_phone" name="alt_phone" inputMode="tel" defaultValue={formatPhone(defaults.alt_phone)} />
          </FormField>
          <FormField label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" name="email" type="email" defaultValue={defaults.email ?? ""} />
          </FormField>
          </>
        ) : (
          <p className="flex items-start gap-2 rounded-xl bg-muted/70 p-3 text-sm text-muted-foreground sm:col-span-2">
            <Lock className="mt-0.5 size-4 shrink-0" />
            Phone numbers and email are private — only the clinic owner can add or see them.
          </p>
        )}
        <FormField label="Preferred contact">
          <Select name="preferred_channel" defaultValue={defaults.preferred_channel ?? "whatsapp"}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="call">Phone call</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="email">Email</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Message language" hint="Reminders are sent in this language">
          <Select name="preferred_language" defaultValue={defaults.preferred_language ?? "ur"}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="ur">اردو (Urdu)</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
          </Select>
        </FormField>
        <FormField label="How did they find us?">
          <Select name="referral_source" defaultValue={defaults.referral_source ?? undefined}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>
              {referralSources.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Notes" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" rows={2} defaultValue={defaults.notes ?? ""} />
        </FormField>
        <Label className="font-normal sm:col-span-2">
          <Checkbox name="marketing_opt_in" defaultChecked={defaults.marketing_opt_in ?? false} />
          OK to receive offers & campaign messages (reminders are sent regardless)
        </Label>
      </FormSection>

      <FormSection title="Address" description="Saved once — used for home deliveries and home visits, so nobody re-types it.">
        <FormField label="House number" htmlFor="house_no" hint="e.g. 123 or Flat 4B">
          <Input id="house_no" name="house_no" defaultValue={defaults.house_no ?? ""} />
        </FormField>
        <FormField label="Block" htmlFor="block" hint="e.g. Block C, Sector 2">
          <Input id="block" name="block" defaultValue={defaults.block ?? ""} />
        </FormField>
        <FormField label="Full address" htmlFor="address" className="sm:col-span-2" hint="Street, landmarks, any other directions">
          <Textarea id="address" name="address" rows={2} defaultValue={defaults.address ?? ""} />
        </FormField>
        <FormField label="Area / society" htmlFor="area" hint="e.g. DHA Phase 5, Johar Town">
          <Input id="area" name="area" defaultValue={defaults.area ?? ""} />
        </FormField>
        <FormField label="City" htmlFor="city">
          <Input id="city" name="city" defaultValue={defaults.city ?? "Lahore"} />
        </FormField>
      </FormSection>

      {species && (
        <FormSection title="First pet" description="Optional — fill in to register the pet in the same step.">
          <PetFields species={species} prefix="pet." errors={errors} compact />
        </FormSection>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => history.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} {submitLabel}
        </Button>
      </div>
    </form>
  );
}
