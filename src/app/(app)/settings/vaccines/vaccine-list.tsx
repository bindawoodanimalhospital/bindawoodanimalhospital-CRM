"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Syringe } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { cn } from "@/lib/utils";
import { saveVaccine } from "./actions";

export type Vaccine = {
  id: string; name: string; protects_against: string | null; species_ids: string[]; default_manufacturer: string | null;
  default_route: string | null; default_dose: string | null; is_active: boolean;
};
type Species = { id: string; name: string };

/** The clinic's vaccine list — the owner or a senior doctor can add a new vaccine or change one. */
export function VaccineList({ vaccines, species, canEdit }: { vaccines: Vaccine[]; species: Species[]; canEdit: boolean }) {
  const name = new Map(species.map((s) => [s.id, s.name]));
  return (
    <section className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Syringe className="size-5 text-brand" />
        <h2 className="text-lg font-semibold">Vaccines ({vaccines.filter((v) => v.is_active).length})</h2>
        {canEdit && <span className="ml-auto"><VaccineDialog species={species} /></span>}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">These are the vaccines doctors can record. Add a new brand when the clinic starts using it — then add it to a schedule below if it needs more doses.</p>
      <ul className="grid gap-2 md:grid-cols-2">
        {vaccines.map((v) => (
          <li key={v.id} className={cn("flex items-start gap-3 rounded-xl bg-surface p-3 ring-1 ring-border", !v.is_active && "opacity-60")}>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 font-semibold">{v.name}{!v.is_active && <StatusPill>Not in use</StatusPill>}</span>
              <span className="block text-sm text-muted-foreground">{v.protects_against}</span>
              <span className="block text-xs text-muted-foreground">
                {[v.species_ids.map((id) => name.get(id)).filter(Boolean).join(", "), v.default_manufacturer, v.default_route, v.default_dose].filter(Boolean).join(" · ")}
              </span>
            </span>
            {canEdit && <VaccineDialog species={species} vaccine={v} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function VaccineDialog({ species, vaccine }: { species: Species[]; vaccine?: Vaccine }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const blank = { name: "", protects_against: "", species_ids: [] as string[], default_manufacturer: "", default_route: "SC", default_dose: "1 ml", is_active: true };
  const [f, setF] = useState(vaccine ? {
    ...vaccine, protects_against: vaccine.protects_against ?? "", default_manufacturer: vaccine.default_manufacturer ?? "",
    default_route: vaccine.default_route ?? "", default_dose: vaccine.default_dose ?? "",
  } : blank);
  const toggle = (id: string) => setF((x) => ({ ...x, species_ids: x.species_ids.includes(id) ? x.species_ids.filter((s) => s !== id) : [...x.species_ids, id] }));
  const save = () => start(async () => {
    const r = await saveVaccine(vaccine?.id ?? null, f);
    if (r.ok) { toast.success(r.message); setOpen(false); if (!vaccine) setF(blank); router.refresh(); } else toast.error(r.message);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {vaccine ? <Button variant="ghost" size="icon-sm" aria-label={`Edit ${vaccine.name}`}><Pencil /></Button> : <Button size="sm"><Plus /> Add a vaccine</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{vaccine ? `Edit ${vaccine.name}` : "Add a vaccine"}</DialogTitle>
          <DialogDescription>Use the name on the box, e.g. “Nobivac DHPPi” or “PCH (Biofel PCH)”.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" className="sm:col-span-2" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <FormField label="Protects against" className="sm:col-span-2" required>
            <Input value={f.protects_against} onChange={(e) => setF({ ...f, protects_against: e.target.value })} placeholder="e.g. Distemper, parvovirus, rabies" />
          </FormField>
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">For which animals</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {species.map((s) => (
                <Label key={s.id} className="font-normal"><Checkbox checked={f.species_ids.includes(s.id)} onCheckedChange={() => toggle(s.id)} /> {s.name}</Label>
              ))}
            </div>
          </div>
          <FormField label="Company"><Input value={f.default_manufacturer} onChange={(e) => setF({ ...f, default_manufacturer: e.target.value })} placeholder="e.g. Bioveta, MSD" /></FormField>
          <FormField label="Usual dose"><Input value={f.default_dose} onChange={(e) => setF({ ...f, default_dose: e.target.value })} placeholder="1 ml" /></FormField>
          <FormField label="Usual route" className="sm:col-span-2"><Input value={f.default_route} onChange={(e) => setF({ ...f, default_route: e.target.value })} placeholder="SC, IM, intranasal…" /></FormField>
          {vaccine && (
            <Label className="font-normal sm:col-span-2"><Checkbox checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v === true })} /> In use (untick to hide it from doctors)</Label>
          )}
        </div>
        <DialogFooter>
          <Button disabled={pending || f.name.trim().length < 2 || f.protects_against.trim().length < 2 || !f.species_ids.length} onClick={save}>
            {pending && <Loader2 className="animate-spin" />} {vaccine ? "Save" : "Add vaccine"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
