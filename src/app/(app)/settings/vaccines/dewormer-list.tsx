"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bug, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { StatusPill } from "@/components/app/page-header";
import { TRACKS, WORM_COVERS, trackLabel } from "@/lib/treatments";
import { cn } from "@/lib/utils";
import { saveDewormer } from "./actions";

export type Dewormer = {
  id: string; name: string; species_ids: string[]; tracks: string[]; covers: string[]; dose_text: string | null;
  adult_interval_days: number; catalog_item_id: string | null; notes: string | null; is_active: boolean;
};
type Species = { id: string; name: string };
type Item = { id: string; name: string };

/**
 * The clinic's dewormers and flea / tick products. Each has a type (internal worms, fleas & ticks, or both —
 * they keep separate reminders), what it covers, the usual dose, the adult interval, and the price-list item
 * it is billed as (so a bill knows which product it was).
 */
export function DewormerList({ dewormers, species, items, canEdit }: { dewormers: Dewormer[]; species: Species[]; items: Item[]; canEdit: boolean }) {
  const name = new Map(species.map((s) => [s.id, s.name]));
  const item = new Map(items.map((i) => [i.id, i.name]));
  return (
    <section className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Bug className="size-5 text-brand" /> Dewormers &amp; flea / tick products</h2>
        {canEdit && <span className="ml-auto"><DewormerDialog species={species} items={items} /></span>}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Doctors choose from this list when recording a deworming. <b>Internal worms</b> and <b>fleas &amp; ticks</b> have separate reminders;
        a product that does both resets both. Link each to its price-list item so a bill shows which product was billed.
      </p>
      <ul className="grid grid-cols-1 gap-2">
        {dewormers.map((d) => (
          <li key={d.id} className={cn("flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl bg-surface px-3 py-2 text-sm ring-1 ring-border", !d.is_active && "opacity-60")}>
            <span className="min-w-0 flex-1">
              <b>{d.name}</b>
              <span className="block text-xs text-muted-foreground">
                {[d.tracks.map(trackLabel).join(" + "), d.covers.join(", "), d.dose_text, `adults every ${d.adult_interval_days} days`,
                  d.species_ids.length ? d.species_ids.map((id) => name.get(id)).join("/") : "any animal",
                  d.catalog_item_id ? `billed as “${item.get(d.catalog_item_id) ?? "?"}”` : "not linked to a price-list item"].filter(Boolean).join(" · ")}
              </span>
            </span>
            {!d.is_active && <StatusPill>Not in use</StatusPill>}
            {canEdit && <DewormerDialog species={species} items={items} dewormer={d} />}
          </li>
        ))}
        {!dewormers.length && <li className="text-sm text-muted-foreground">No dewormers yet.</li>}
      </ul>
    </section>
  );
}

function DewormerDialog({ species, items, dewormer }: { species: Species[]; items: Item[]; dewormer?: Dewormer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const blank = { name: "", species_ids: [] as string[], tracks: ["internal"], covers: [] as string[], dose_text: "", adult_interval_days: 90,
    catalog_item_id: "none", notes: "", is_active: true };
  const [f, setF] = useState(dewormer ? { ...dewormer, dose_text: dewormer.dose_text ?? "", notes: dewormer.notes ?? "", catalog_item_id: dewormer.catalog_item_id ?? "none" } : blank);
  const flip = (k: "species_ids" | "tracks" | "covers", v: string) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const save = () => start(async () => {
    const r = await saveDewormer(dewormer?.id ?? null, { ...f, tracks: f.tracks as ("internal" | "external")[] });
    if (r.ok) { toast.success(r.message); setOpen(false); if (!dewormer) setF(blank); router.refresh(); } else toast.error(r.message);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {dewormer ? <Button variant="ghost" size="icon-sm" aria-label={`Edit ${dewormer.name}`}><Pencil /></Button> : <Button size="sm"><Plus /> Add a dewormer</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{dewormer ? `Edit ${dewormer.name}` : "Add a dewormer or flea / tick product"}</DialogTitle>
          <DialogDescription>Use the name on the box, e.g. “Drontal Plus”, “Caniverm”, “Bravecto”.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" className="sm:col-span-2" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Type (which reminder it resets)</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {TRACKS.map((t) => <Label key={t.code} className="font-normal"><Checkbox checked={f.tracks.includes(t.code)} onCheckedChange={() => flip("tracks", t.code)} /> {t.label}</Label>)}
            </div>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Covers</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {WORM_COVERS.map((c) => <Label key={c} className="font-normal capitalize"><Checkbox checked={f.covers.includes(c)} onCheckedChange={() => flip("covers", c)} /> {c}</Label>)}
            </div>
          </div>
          <FormField label="Dose" hint="Shown to the doctor when recording"><Input value={f.dose_text} onChange={(e) => setF({ ...f, dose_text: e.target.value })} placeholder="e.g. 1 tablet per 10 kg" /></FormField>
          <FormField label="Adults: repeat every (days)" hint="Puppies/kittens follow age (2 weeks → monthly)">
            <Input inputMode="numeric" value={String(f.adult_interval_days)} onChange={(e) => setF({ ...f, adult_interval_days: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </FormField>
          <FormField label="Billed as (price-list item)" className="sm:col-span-2">
            <select value={f.catalog_item_id} onChange={(e) => setF({ ...f, catalog_item_id: e.target.value })} className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm">
              <option value="none">— not linked —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </FormField>
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">For which animals <span className="font-normal text-muted-foreground">(none ticked = any)</span></span>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {species.map((s) => <Label key={s.id} className="font-normal"><Checkbox checked={f.species_ids.includes(s.id)} onCheckedChange={() => flip("species_ids", s.id)} /> {s.name}</Label>)}
            </div>
          </div>
          <FormField label="Notes" className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
          {dewormer && <Label className="font-normal sm:col-span-2"><Checkbox checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v === true })} /> In use (untick to hide it from doctors)</Label>}
        </div>
        <DialogFooter>
          <Button disabled={pending || f.name.trim().length < 2 || !f.tracks.length || f.adult_interval_days < 7} onClick={save}>
            {pending && <Loader2 className="animate-spin" />} {dewormer ? "Save" : "Add dewormer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
