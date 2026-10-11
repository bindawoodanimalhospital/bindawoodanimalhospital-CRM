"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField, FormSection } from "@/components/app/form-field";
import { useFormAction } from "@/hooks/use-form-action";
import type { FormState } from "@/lib/validation";

export type ItemDefaults = Partial<{
  kind: "service" | "product"; name: string; category: string | null; brand: string | null; sku: string | null; barcode: string | null;
  unit: string; sale_price: number; price_is_editable: boolean; tax_rate: number; track_stock: boolean; reorder_level: number | null;
  is_retail: boolean; is_active: boolean; vaccine_id: string | null; medicine_id: string | null; notes: string | null;
}>;

const CATEGORIES = ["Consultation", "Diagnostics", "Surgery", "Ward", "Vaccines", "Medicines", "Consumables", "Food", "Treats", "Grooming", "Accessories", "Toys", "Other"];

export function ItemForm({ action, defaults = {}, hasStock, vaccines, submitLabel }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>; defaults?: ItemDefaults; hasStock: boolean;
  vaccines: { id: string; name: string }[]; submitLabel: string;
}) {
  const { pending, onSubmit, errors } = useFormAction(action);
  const [kind, setKind] = useState(defaults.kind ?? "product");
  const [track, setTrack] = useState(defaults.track_stock ?? false);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormSection title="Item">
        <FormField label="Type">
          <Select name="kind" value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="product">Product (medicine, food, supply…)</SelectItem><SelectItem value="service">Service (consultation, test, procedure…)</SelectItem></SelectContent>
          </Select>
        </FormField>
        <FormField label="Name" htmlFor="name" error={errors.name} required><Input id="name" name="name" defaultValue={defaults.name} placeholder="e.g. Royal Canin Mini Adult 2kg" /></FormField>
        <FormField label="Category"><Input name="category" list="cat-list" defaultValue={defaults.category ?? ""} />
          <datalist id="cat-list">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></FormField>
        <FormField label="Brand / company"><Input name="brand" defaultValue={defaults.brand ?? ""} /></FormField>
        <FormField label="Price (Rs.)" error={errors.sale_price} required><Input name="sale_price" inputMode="decimal" defaultValue={defaults.sale_price ?? 0} /></FormField>
        <FormField label="Sold per" hint="tablet, strip, bottle, bag, dose, pcs"><Input name="unit" defaultValue={defaults.unit ?? "pcs"} /></FormField>
        <Label className="font-normal sm:col-span-2"><Checkbox name="price_is_editable" defaultChecked={defaults.price_is_editable} /> Price is decided at billing (e.g. “Other procedure”)</Label>
        <FormField label="Tax %" hint="Leave 0 unless the clinic charges sales tax"><Input name="tax_rate" inputMode="decimal" defaultValue={defaults.tax_rate ?? 0} /></FormField>
        {kind === "service" ? <input type="hidden" name="is_retail" value="" /> : (
          <Label className="font-normal"><Checkbox name="is_retail" defaultChecked={defaults.is_retail} /> Sold in the pet store (shows in POS)</Label>
        )}
      </FormSection>

      {kind === "product" && (
        <FormSection title="Stock" description="Tracked items are deducted automatically when billed. Expired batches are never sold.">
          <Label className="font-normal sm:col-span-2">
            <Checkbox name="track_stock" checked={track} onCheckedChange={(v) => setTrack(v === true)} disabled={!hasStock && !defaults.track_stock} />
            Track stock for this item
          </Label>
          {!hasStock && !defaults.track_stock && (
            <p className="text-sm text-muted-foreground sm:col-span-2">Enter the opening stock count (on the item page) first — then switch tracking on.</p>
          )}
          <FormField label="Reorder when at or below"><Input name="reorder_level" inputMode="decimal" defaultValue={defaults.reorder_level ?? ""} /></FormField>
          <FormField label="SKU / code"><Input name="sku" defaultValue={defaults.sku ?? ""} /></FormField>
          <FormField label="Barcode" hint="Scan it into this box"><Input name="barcode" defaultValue={defaults.barcode ?? ""} /></FormField>
          <FormField label="Is this a vaccine?">
            <Select name="vaccine_id" defaultValue={defaults.vaccine_id ?? "none"}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">No</SelectItem>{vaccines.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
        </FormSection>
      )}

      <FormSection title="Notes"><Textarea name="notes" rows={2} defaultValue={defaults.notes ?? ""} className="sm:col-span-2" /></FormSection>
      {defaults.name && (
        <Label className="font-normal">
          <input type="hidden" name="is_active_present" value="1" />
          <Checkbox name="is_active" defaultChecked={defaults.is_active !== false} value="on" /> Active (untick to hide from billing & POS)
        </Label>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => history.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} {submitLabel}</Button>
      </div>
    </form>
  );
}
