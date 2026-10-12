"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, Loader2, Plus, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/app/form-field";
import { formatPKR } from "@/lib/format";
import { parseSize } from "@/lib/sizes";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";
import { addSize, createSizedProduct, groupSizes, removeFromFamily, setAvailable } from "./size-actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (fn: () => Promise<FormState>, after?: () => void) => start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(r.message); after?.(); router.refresh(); } else toast.error(r.message);
    }),
  };
}

/** "Available now" switch — untick when a size is out or isn't stocked right now (hidden from the pet store). */
export function AvailabilityToggle({ id, available, label = true }: { id: string; available: boolean; label?: boolean }) {
  const { pending, run } = useRun();
  const [on, setOn] = useState(available);
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium">
      <Switch checked={on} disabled={pending} onCheckedChange={(v) => { setOn(v); run(() => setAvailable(id, v)); }} aria-label="Available now" />
      {label && <span className={cn(on ? "text-success" : "text-muted-foreground")}>{on ? "Available" : "Not available"}</span>}
    </label>
  );
}

type Sibling = { id: string; name: string; size_label: string | null; sale_price: number; is_available: boolean; stock: number | null };

/** On an item page: the other sizes of the same product, add a size, or start a size group. */
export function SizesPanel({ item, family, siblings }: {
  item: { id: string; name: string; size_label: string | null };
  family: { id: string; name: string } | null;
  siblings: Sibling[];
}) {
  const { pending, run } = useRun();
  if (!family) return <StartGroup item={item} />;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">Part of <b className="text-foreground">{family.name}</b>. Each size has its own price, barcode and stock.</p>
      <ul className="grid gap-1.5">
        {siblings.map((s) => (
          <li key={s.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1",
            s.id === item.id ? "bg-brand-wash ring-brand-muted" : "bg-surface ring-border")}>
            <Link href={`/inventory/${s.id}`} className="font-semibold hover:underline">{s.size_label ?? s.name}</Link>
            <span className="tabular text-muted-foreground">{formatPKR(s.sale_price)}</span>
            {s.stock != null && <span className={cn("text-xs", s.stock <= 0 ? "text-danger" : "text-muted-foreground")}>{s.stock <= 0 ? "out of stock" : `${s.stock} in stock`}</span>}
            <span className="ml-auto"><AvailabilityToggle id={s.id} available={s.is_available} /></span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <AddSizeDialog familyId={family.id} familyName={family.name} />
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => removeFromFamily(item.id))}><Unlink /> Remove this size from the group</Button>
      </div>
    </div>
  );
}

function StartGroup({ item }: { item: { id: string; name: string; size_label: string | null } }) {
  const parsed = parseSize(item.name);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(parsed?.base ?? item.name);
  const [label, setLabel] = useState(item.size_label ?? parsed?.label ?? "");
  const { pending, run } = useRun();
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-muted-foreground">Does this product come in other weights or sizes? Group them so the pet store shows one product with a button per size.</p>
      <div className="flex flex-wrap gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button variant="outline" size="sm"><Layers /> Make this a product with sizes</Button></DialogTrigger>
          <DialogContent className="rounded-2xl">
            <DialogHeader><DialogTitle>Product with sizes</DialogTitle>
              <DialogDescription>Give the product its name without the size, and say which size this item is. Add the other sizes next.</DialogDescription></DialogHeader>
            <FormField label="Product name (without size)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Petline Kitten Junior" /></FormField>
            <FormField label="This item's size"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 1.5 kg" /></FormField>
            <DialogFooter><Button disabled={pending || name.trim().length < 2 || !label.trim()}
              onClick={() => run(() => groupSizes(name.trim(), [{ id: item.id, size_label: label.trim() }]), () => setOpen(false))}>
              {pending && <Loader2 className="animate-spin" />} Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Button asChild variant="ghost" size="sm"><Link href="/inventory/sizes">See suggested size groups</Link></Button>
      </div>
    </div>
  );
}

export function AddSizeDialog({ familyId, familyName }: { familyId: string; familyName: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ size_label: "", price: "", barcode: "" });
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Plus /> Add a size</Button></DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader><DialogTitle>Add a size of {familyName}</DialogTitle>
          <DialogDescription>Category, brand and pet-store settings are copied from the other sizes.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Size" hint="e.g. 4 kg, 400 g, 10 L"><Input autoFocus value={f.size_label} onChange={(e) => setF({ ...f, size_label: e.target.value })} /></FormField>
          <FormField label="Price (Rs.)"><Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^\d.]/g, "") })} /></FormField>
          <FormField label="Barcode" hint="Optional — scan it here" className="sm:col-span-2"><Input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></FormField>
        </div>
        <DialogFooter><Button disabled={pending || !f.size_label.trim() || f.price === ""}
          onClick={() => run(() => addSize(familyId, { size_label: f.size_label, sale_price: Number(f.price), barcode: f.barcode }), () => { setOpen(false); setF({ size_label: "", price: "", barcode: "" }); })}>
          {pending && <Loader2 className="animate-spin" />} Add size</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** New product that comes in several sizes: one name, a row per size. */
export function SizedProductForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: "", category: "", brand: "", unit: "bag", is_retail: true });
  const [sizes, setSizes] = useState([{ size_label: "", price: "", barcode: "", stock: "" }, { size_label: "", price: "", barcode: "", stock: "" }]);
  const set = (i: number, k: "size_label" | "price" | "barcode" | "stock", v: string) => setSizes((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const filled = sizes.filter((s) => s.size_label.trim());
  const save = () => start(async () => {
    const r = await createSizedProduct({ ...f, sizes: filled.map((s) => ({ size_label: s.size_label, sale_price: Number(s.price), barcode: s.barcode, stock: Number(s.stock) || 0 })) });
    if (r.ok && r.id) { toast.success(r.message); router.push(`/inventory/${r.id}`); } else toast.error(r.message);
  });
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border sm:grid-cols-2">
        <FormField label="Product name (without the size)" className="sm:col-span-2" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Petline Kitten Junior" autoFocus />
        </FormField>
        <FormField label="Category"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. Cat Food" /></FormField>
        <FormField label="Brand / company"><Input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></FormField>
        <FormField label="Sold per" hint="bag, can, bottle, pcs"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></FormField>
        <Label className="self-end font-normal"><Checkbox checked={f.is_retail} onCheckedChange={(v) => setF({ ...f, is_retail: v === true })} /> Sold in the pet store</Label>
      </div>
      <div className="grid gap-3 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border">
        <div>
          <h3 className="font-semibold">Sizes</h3>
          <p className="text-sm text-muted-foreground">One row per size with its own price, and how many you have now (optional). Add only the sizes you sell — you can add more later, and switch a size off when it isn&apos;t in the shop.</p>
        </div>
        {sizes.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[7rem_7rem_6.5rem_1fr_auto]">
            <Input value={s.size_label} onChange={(e) => set(i, "size_label", e.target.value)} placeholder="Size, e.g. 400 g" aria-label="Size" />
            <Input value={s.price} inputMode="decimal" onChange={(e) => set(i, "price", e.target.value.replace(/[^\d.]/g, ""))} placeholder="Price (Rs.)" aria-label="Price" />
            <Input value={s.stock} inputMode="decimal" onChange={(e) => set(i, "stock", e.target.value.replace(/[^\d.]/g, ""))} placeholder="In stock now" aria-label="In stock now" className="col-span-1 row-start-2 sm:row-start-auto" />
            <Input value={s.barcode} onChange={(e) => set(i, "barcode", e.target.value)} placeholder="Barcode (optional)" aria-label="Barcode" className="col-span-1 row-start-2 sm:col-span-1 sm:row-start-auto" />
            <Button variant="ghost" size="icon" aria-label="Remove size" disabled={sizes.length <= 1} onClick={() => setSizes((x) => x.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setSizes((x) => [...x, { size_label: "", price: "", barcode: "", stock: "" }])}><Plus /> Another size</Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => history.back()}>Cancel</Button>
        <Button disabled={pending || f.name.trim().length < 2 || filled.length === 0 || filled.some((s) => s.price === "")} onClick={save}>
          {pending && <Loader2 className="animate-spin" />} Save product with {filled.length || ""} size{filled.length === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}

/** A suggested size group on /inventory/sizes: review the name and sizes, then combine. */
export function SuggestionCard({ suggestion }: { suggestion: { name: string; items: { id: string; name: string; sale_price: number; size_label: string }[] } }) {
  const [name, setName] = useState(suggestion.name);
  const [rows, setRows] = useState(suggestion.items.map((i) => ({ ...i, on: true })));
  const [done, setDone] = useState(false);
  const { pending, run } = useRun();
  const chosen = rows.filter((r) => r.on && r.size_label.trim());
  if (done) return null;
  return (
    <div className="grid gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
      <FormField label="Product name (without size)"><Input value={name} onChange={(e) => setName(e.target.value)} /></FormField>
      <ul className="grid gap-1.5">
        {rows.map((r, i) => (
          <li key={r.id} className="grid grid-cols-[auto_1fr_6.5rem_auto] items-center gap-2 text-sm">
            <Checkbox checked={r.on} onCheckedChange={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, on: v === true } : y)))} aria-label={`Include ${r.name}`} />
            <span className="min-w-0 truncate" title={r.name}>{r.name}</span>
            <Input className="h-8" value={r.size_label} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, size_label: e.target.value } : y)))} aria-label="Size" />
            <span className="tabular text-muted-foreground">{formatPKR(r.sale_price)}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button size="sm" disabled={pending || chosen.length < 2 || name.trim().length < 2}
          onClick={() => run(() => groupSizes(name.trim(), chosen.map((r) => ({ id: r.id, size_label: r.size_label.trim() }))), () => setDone(true))}>
          {pending ? <Loader2 className="animate-spin" /> : <Layers />} Combine {chosen.length} sizes
        </Button>
      </div>
    </div>
  );
}
