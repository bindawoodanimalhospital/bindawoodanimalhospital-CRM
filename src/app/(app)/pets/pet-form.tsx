"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, FormSection } from "@/components/app/form-field";
import { PetFields, type PetDefaults, type SpeciesOption } from "@/components/app/pet-fields";
import { useFormAction } from "@/hooks/use-form-action";
import type { FormState } from "@/lib/validation";

export function PetForm({
  action, species, defaults, status, submitLabel, showWeight = false,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  species: SpeciesOption[];
  defaults?: PetDefaults;
  /** Edit mode: current status (active / deceased / …). */
  status?: string;
  submitLabel: string;
  showWeight?: boolean;
}) {
  const { pending, onSubmit, errors } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormSection title="Patient">
        <PetFields species={species} defaults={defaults} errors={errors} />
        {showWeight && (
          <FormField label="Weight today (kg)" htmlFor="weight_kg" hint="Optional">
            <Input id="weight_kg" name="weight_kg" type="number" step="0.01" min="0" inputMode="decimal" />
          </FormField>
        )}
        {status && (
          <FormField label="Status">
            <Select name="status" defaultValue={status}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="deceased">Deceased</SelectItem>
                <SelectItem value="transferred">Transferred / rehomed</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        )}
      </FormSection>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => history.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} {submitLabel}</Button>
      </div>
    </form>
  );
}
