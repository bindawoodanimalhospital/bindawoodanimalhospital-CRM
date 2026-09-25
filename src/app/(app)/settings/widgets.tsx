"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/app/form-field";
import { useFormAction } from "@/hooks/use-form-action";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { addBreed, addSpecies, saveClinicProfile, setBreedActive } from "./actions";

export function ClinicProfileForm({ profile }: { profile: Record<string, string> }) {
  const { pending, onSubmit, errors } = useFormAction(saveClinicProfile);
  const f = (k: string, label: string, props: React.ComponentProps<typeof Input> = {}, cls = "") => (
    <FormField label={label} htmlFor={k} error={errors[k]} className={cls}>
      <Input id={k} name={k} defaultValue={profile[k] ?? ""} {...props} />
    </FormField>
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      {f("name", "Clinic name")}
      {f("tagline", "Tagline")}
      {f("address", "Address", {}, "sm:col-span-2")}
      {f("city", "City")}
      {f("phone", "Phone", { inputMode: "tel", defaultValue: formatPhone(profile.phone) || profile.phone })}
      {f("whatsapp", "WhatsApp", { inputMode: "tel", defaultValue: formatPhone(profile.whatsapp) || profile.whatsapp })}
      {f("email", "Email", { type: "email" })}
      {f("website", "Website / Instagram")}
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save</Button>
      </div>
    </form>
  );
}

type Species = { id: string; name: string; breeds: { id: string; name: string; is_active: boolean }[] };

export function SpeciesManager({ species }: { species: Species[] }) {
  const [selected, setSelected] = useState(species[0]?.id);
  const [newSpecies, setNewSpecies] = useState("");
  const [newBreed, setNewBreed] = useState("");
  const [pending, start] = useTransition();
  const current = species.find((s) => s.id === selected);

  const run = (fn: () => Promise<{ ok?: boolean; message?: string }>, reset?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) { if (res.message) toast.success(res.message); reset?.(); } else toast.error(res.message);
    });

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <div className="grid content-start gap-2">
        <ul className="grid gap-0.5">
          {species.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setSelected(s.id)}
                className={cn("flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted",
                  s.id === selected && "bg-muted font-medium")}>
                {s.name}
                <span className="text-xs text-muted-foreground">{s.breeds.filter((b) => b.is_active).length}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-1">
          <Input value={newSpecies} onChange={(e) => setNewSpecies(e.target.value)} placeholder="New species" />
          <Button size="icon" variant="outline" disabled={pending || !newSpecies.trim()}
            onClick={() => run(() => addSpecies(newSpecies), () => setNewSpecies(""))}><Plus /></Button>
        </div>
      </div>
      {current && (
        <div>
          <p className="mb-3 text-sm font-medium">{current.name} breeds</p>
          <div className="flex flex-wrap gap-1.5">
            {current.breeds.map((b) => (
              <span key={b.id} className={cn("inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs",
                !b.is_active && "text-muted-foreground line-through")}>
                {b.name}
                <button type="button" className="rounded-full p-0.5 hover:bg-muted" disabled={pending}
                  title={b.is_active ? "Hide from lists" : "Restore"}
                  onClick={() => run(() => setBreedActive(b.id, !b.is_active))}>
                  {b.is_active ? <X className="size-3" /> : <Plus className="size-3" />}
                </button>
              </span>
            ))}
          </div>
          <div className="mt-4 flex max-w-sm gap-1">
            <Input value={newBreed} onChange={(e) => setNewBreed(e.target.value)} placeholder={`Add ${current.name.toLowerCase()} breed`} />
            <Button size="icon" variant="outline" disabled={pending || !newBreed.trim()}
              onClick={() => run(() => addBreed(current.id, newBreed), () => setNewBreed(""))}>
              {pending ? <Loader2 className="animate-spin" /> : <Plus />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
