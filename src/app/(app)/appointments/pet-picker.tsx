"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, LogIn, PawPrint, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { checkInAppointment, getCustomerPets, quickAddPet, speciesChoices } from "./actions";

type Species = { id: string; name: string };

/**
 * "New pet / stray animal" in one line: optional name + Dog / Cat / other. Used when booking and at check-in,
 * so an appointment never gets stuck because the pet isn't registered.
 */
export function QuickPetForm({ customerId, onCreated, compact }: {
  customerId: string; onCreated: (pet: { id: string; name: string }) => void; compact?: boolean;
}) {
  const [species, setSpecies] = useState<Species[]>([]);
  const [speciesId, setSpeciesId] = useState("");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => { speciesChoices().then((s) => { setSpecies(s); setSpeciesId((cur) => cur || s[0]?.id || ""); }); }, []);
  const main = species.slice(0, 2);            // Dog, Cat
  const rest = species.slice(2);
  const add = () => start(async () => {
    const r = await quickAddPet(customerId, name, speciesId);
    if (r.ok && r.petId) { toast.success(r.message); setName(""); onCreated({ id: r.petId, name: r.petName ?? name }); } else toast.error(r.message);
  });
  return (
    <div className={cn("grid gap-2 rounded-xl bg-surface p-3 ring-1 ring-border", compact && "p-2.5")}>
      <p className="flex items-center gap-1.5 text-sm font-semibold"><PawPrint className="size-4 text-brand" /> New pet or stray animal</p>
      <div className="flex flex-wrap gap-1.5">
        {main.map((s) => (
          <button key={s.id} type="button" onClick={() => setSpeciesId(s.id)}
            className={cn("h-9 rounded-lg px-3 text-sm font-semibold ring-1", speciesId === s.id ? "bg-ink text-white ring-ink" : "bg-card ring-border")}>{s.name}</button>
        ))}
        {rest.length > 0 && (
          <select value={main.some((m) => m.id === speciesId) ? "" : speciesId} onChange={(e) => e.target.value && setSpeciesId(e.target.value)}
            className={cn("h-9 rounded-lg bg-card px-2 text-sm ring-1 ring-border", !main.some((m) => m.id === speciesId) && "font-semibold")}>
            <option value="">Other…</option>
            {rest.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional — e.g. stray, no name)" />
        <Button type="button" disabled={pending || !speciesId} onClick={add}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Add</Button>
      </div>
      <p className="text-xs text-muted-foreground">Left empty it&apos;s saved as “Stray dog / Stray cat”. Breed, age and other details can be added later on the pet&apos;s page.</p>
    </div>
  );
}

/**
 * "Arrived — check in" for an appointment. With a pet already chosen it checks in straight away; without one it
 * asks which pet came — one of the owner's pets, or a new / stray animal registered on the spot.
 */
export function CheckInButton({ appointmentId, customerId, petId, onDone }: {
  appointmentId: string; customerId: string; petId: string | null; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pets, setPets] = useState<{ id: string; name: string; species: string | null }[] | null>(null);
  const [pending, start] = useTransition();
  const go = (pid?: string) => start(async () => {
    const r = await checkInAppointment(appointmentId, pid);
    if (r.ok) { toast.success(r.message); setOpen(false); onDone(); } else toast.error(r.message);
  });
  const click = () => {
    if (petId) return go();
    setOpen(true);
    getCustomerPets(customerId).then(setPets);
  };
  return (
    <>
      <Button disabled={pending} onClick={click}>{pending ? <Loader2 className="animate-spin" /> : <LogIn />} Arrived — check in</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Which pet has come?</DialogTitle>
            <DialogDescription>Pick the pet, or add it now — including a stray someone brought in.</DialogDescription>
          </DialogHeader>
          {pets === null ? <Loader2 className="mx-auto animate-spin text-muted-foreground" /> : pets.length > 0 && (
            <div className="grid gap-2">
              {pets.map((p) => (
                <Button key={p.id} variant="outline" className="justify-start" disabled={pending} onClick={() => go(p.id)}>
                  <PawPrint /> {p.name}{p.species ? <span className="text-muted-foreground">({p.species})</span> : null}
                </Button>
              ))}
            </div>
          )}
          <QuickPetForm customerId={customerId} onCreated={(p) => go(p.id)} />
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
