"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/app/form-field";

export type SpeciesOption = { id: string; name: string; breeds: { id: string; name: string }[] };

export type PetDefaults = Partial<{
  name: string; species_id: string; breed_id: string | null; breed_text: string | null; sex: string;
  is_neutered: boolean | null; date_of_birth: string | null; dob_is_estimate: boolean; color: string | null;
  markings: string | null; microchip_no: string | null; tag_no: string | null; special_handling: string | null;
  notes: string | null;
}>;

/**
 * Pet identity fields. `prefix` namespaces input names so the fields can be embedded in the
 * new-customer form ("pet.name") or used standalone ("name").
 */
export function PetFields({
  species, defaults = {}, errors = {}, prefix = "", compact = false,
}: {
  species: SpeciesOption[];
  defaults?: PetDefaults;
  errors?: Record<string, string>;
  prefix?: string;
  compact?: boolean;
}) {
  const n = (k: string) => `${prefix}${k}`;
  const e = (k: string) => errors[`${prefix}${k}`];
  const [speciesId, setSpeciesId] = useState(defaults.species_id ?? species[0]?.id ?? "");
  const [ageMode, setAgeMode] = useState<"age" | "dob">(defaults.date_of_birth && !defaults.dob_is_estimate ? "dob" : "age");
  const breeds = species.find((s) => s.id === speciesId)?.breeds ?? [];
  // Editing an estimated age: keep the stored date unless the user changes the age fields.
  const [ageTouched, setAgeTouched] = useState(false);
  const est = defaults.dob_is_estimate && defaults.date_of_birth ? monthsSince(defaults.date_of_birth) : null;

  return (
    <>
      <FormField label="Pet name" htmlFor={n("name")} error={e("name")} required={!prefix}>
        <Input id={n("name")} name={n("name")} defaultValue={defaults.name} placeholder="e.g. Tiger" />
      </FormField>

      <FormField label="Species" error={e("species_id")} required>
        <Select name={n("species_id")} value={speciesId} onValueChange={setSpeciesId}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent>
            {species.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </FormField>

      <FormField label="Breed" error={e("breed_id")}>
        <Select key={speciesId} name={n("breed_id")} defaultValue={defaults.species_id === speciesId ? defaults.breed_id ?? undefined : undefined}>
          <SelectTrigger className="w-full"><SelectValue placeholder={breeds.length ? "Choose breed" : "—"} /></SelectTrigger>
          <SelectContent>
            {breeds.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </FormField>

      <FormField label="Breed (if not listed / cross)" htmlFor={n("breed_text")}>
        <Input id={n("breed_text")} name={n("breed_text")} defaultValue={defaults.breed_text ?? ""} placeholder="e.g. Husky × GSD" />
      </FormField>

      <FormField label="Sex">
        <Select name={n("sex")} defaultValue={defaults.sex ?? "unknown"}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <FormField label="Neutered / spayed">
        <Select name={n("is_neutered")}
          defaultValue={defaults.is_neutered == null ? "unknown" : defaults.is_neutered ? "yes" : "no"}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <FormField label={ageMode === "age" ? "Approximate age" : "Date of birth"} className="sm:col-span-2"
        hint={ageMode === "age" ? "Owners often know only the age — we'll estimate the birth date." : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {ageMode === "age" ? (
            <>
              <Input name={n("age_years")} type="number" min={0} max={60} placeholder="Years" className="w-24"
                defaultValue={est != null ? Math.floor(est / 12) || "" : undefined} onChange={() => setAgeTouched(true)} />
              <Input name={n("age_months")} type="number" min={0} max={11} placeholder="Months" className="w-24"
                defaultValue={est != null ? est % 12 || "" : undefined} onChange={() => setAgeTouched(true)} />
              {est != null && !ageTouched && (
                <>
                  <input type="hidden" name={n("date_of_birth")} value={defaults.date_of_birth ?? ""} />
                  <input type="hidden" name={n("dob_is_estimate")} value="true" />
                </>
              )}
            </>
          ) : (
            <Input name={n("date_of_birth")} type="date" className="w-44" defaultValue={defaults.date_of_birth ?? ""}
              max={new Date().toISOString().slice(0, 10)} />
          )}
          <button type="button" className="text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setAgeMode(ageMode === "age" ? "dob" : "age")}>
            {ageMode === "age" ? "Know the exact date?" : "Enter age instead"}
          </button>
        </div>
      </FormField>

      {!compact && (
        <>
          <FormField label="Colour" htmlFor={n("color")}>
            <Input id={n("color")} name={n("color")} defaultValue={defaults.color ?? ""} />
          </FormField>
          <FormField label="Identifying marks" htmlFor={n("markings")}>
            <Input id={n("markings")} name={n("markings")} defaultValue={defaults.markings ?? ""} />
          </FormField>
          <FormField label="Microchip no." htmlFor={n("microchip_no")} error={e("microchip_no")}>
            <Input id={n("microchip_no")} name={n("microchip_no")} defaultValue={defaults.microchip_no ?? ""} />
          </FormField>
          <FormField label="Tag / collar no." htmlFor={n("tag_no")}>
            <Input id={n("tag_no")} name={n("tag_no")} defaultValue={defaults.tag_no ?? ""} />
          </FormField>
          <FormField label="Special handling" htmlFor={n("special_handling")} className="sm:col-span-2"
            hint="Shown as a banner everywhere — e.g. “Aggressive, muzzle before exam”.">
            <Input id={n("special_handling")} name={n("special_handling")} defaultValue={defaults.special_handling ?? ""} />
          </FormField>
          <FormField label="Notes" htmlFor={n("notes")} className="sm:col-span-2">
            <Textarea id={n("notes")} name={n("notes")} defaultValue={defaults.notes ?? ""} rows={2} />
          </FormField>
        </>
      )}
    </>
  );
}

function monthsSince(date: string) {
  const d = new Date(date);
  const now = new Date();
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth());
}
