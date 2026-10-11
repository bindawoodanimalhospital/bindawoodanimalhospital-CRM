"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
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
  id: string; full_name: string; full_name_ur: string | null; phone: string; whatsapp: string | null;
  alt_phone: string | null; email: string | null; address: string | null; area: string | null; city: string;
  preferred_channel: string; preferred_language: string; marketing_opt_in: boolean; referral_source: string | null; notes: string | null;
}>;

export function CustomerForm({
  action, defaults = {}, species, referralSources, submitLabel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  defaults?: CustomerDefaults;
  /** When provided, shows the optional "first pet" section (new customer only). */
  species?: SpeciesOption[];
  referralSources: string[];
  submitLabel: string;
}) {
  const { pending, onSubmit, errors } = useFormAction(action);
  const [phone, setPhone] = useState(formatPhone(defaults.phone) || "");
  const [name, setName] = useState(defaults.full_name ?? "");
  const [waSame, setWaSame] = useState(!defaults.whatsapp || defaults.whatsapp === defaults.phone);
  const [dupes, setDupes] = useState<DuplicateHit[]>([]);

  // Debounced duplicate check as reception types.
  useEffect(() => {
    const t = setTimeout(async () => setDupes(await findDuplicates(phone, name, defaults.id)), 400);
    return () => clearTimeout(t);
  }, [phone, name, defaults.id]);

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
                <span className="text-muted-foreground">{formatPhone(d.phone)}{d.area ? ` · ${d.area}` : ""}</span>
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
        <FormField label="Mobile number" htmlFor="phone" error={errors.phone} required hint="e.g. 0300 1234567">
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
        <FormField label="Area / society" htmlFor="area" hint="e.g. DHA Phase 5, Johar Town">
          <Input id="area" name="area" defaultValue={defaults.area ?? ""} />
        </FormField>
        <FormField label="City" htmlFor="city">
          <Input id="city" name="city" defaultValue={defaults.city ?? "Lahore"} />
        </FormField>
        <FormField label="Address" htmlFor="address" className="sm:col-span-2">
          <Input id="address" name="address" defaultValue={defaults.address ?? ""} />
        </FormField>
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
