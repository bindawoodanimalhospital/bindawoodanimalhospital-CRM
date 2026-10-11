"use client";

import { useState, useTransition } from "react";
import { Building2, House, Loader2, MapPin, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/app/page-header";
import { SERVICE_LOCATION, type ServiceLocation } from "@/lib/clinic";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

/**
 * "Where is the service given?" — At hospital / Home visit, with the visit address.
 * The address starts from the client's saved address; staff can type a different one for this service.
 */
export function ServiceLocationFields({ location, address, savedAddress, onChange, compact }: {
  location: ServiceLocation; address: string; savedAddress?: string | null;
  onChange: (location: ServiceLocation, address: string) => void; compact?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Where is the service given?">
        {([["clinic", Building2], ["home_visit", House]] as const).map(([v, Icon]) => (
          <button key={v} type="button" role="radio" aria-checked={location === v}
            onClick={() => onChange(v, v === "home_visit" ? address || savedAddress || "" : address)}
            className={cn("flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition",
              location === v ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="size-4" /> {SERVICE_LOCATION[v].label}
          </button>
        ))}
      </div>
      {location === "home_visit" && (
        <div className="grid gap-1">
          <Textarea rows={compact ? 2 : 3} value={address} onChange={(e) => onChange(location, e.target.value)}
            placeholder="Visit address — house, block, street, area" aria-label="Visit address" />
          <p className="text-xs text-muted-foreground">
            {savedAddress ? "Filled from the client's saved address — change it if the visit is somewhere else." : "No address saved on the client's profile — type it here."}
          </p>
        </div>
      )}
    </div>
  );
}

/** Badge + "Change" dialog for an existing visit / bill. */
export function ServiceLocationControl({ location, address, savedAddress, canEdit, onSave, label = "Service location" }: {
  location: ServiceLocation; address: string | null; savedAddress?: string | null; canEdit: boolean;
  onSave: (location: ServiceLocation, address: string | null) => Promise<FormState>; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loc, setLoc] = useState<ServiceLocation>(location);
  const [addr, setAddr] = useState(address ?? "");
  const [pending, start] = useTransition();
  const invalid = loc === "home_visit" && !addr.trim();
  const save = () => start(async () => {
    const r = await onSave(loc, loc === "home_visit" ? addr.trim() : null);
    if (r.ok) { toast.success(r.message ?? "Saved."); setOpen(false); } else toast.error(r.message);
  });

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <StatusPill tone={SERVICE_LOCATION[location].tone}>
        {location === "home_visit" ? <House className="mr-1 size-3" /> : <Building2 className="mr-1 size-3" />}{SERVICE_LOCATION[location].label}
      </StatusPill>
      {location === "home_visit" && address && (
        <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground"><MapPin className="size-3.5 shrink-0" /><span className="truncate">{address}</span></span>
      )}
      {canEdit && (
        <Button variant="ghost" size="sm" onClick={() => { setLoc(location); setAddr(address ?? ""); setOpen(true); }}><Pencil /> Change</Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>Was the service given at the hospital, or did staff go to the client&apos;s home?</DialogDescription>
          </DialogHeader>
          <Label className="sr-only">{label}</Label>
          <ServiceLocationFields location={loc} address={addr} savedAddress={savedAddress} onChange={(l, a) => { setLoc(l); setAddr(a); }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending || invalid} onClick={save}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
