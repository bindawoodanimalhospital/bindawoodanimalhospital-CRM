"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Loader2, Minus, Package, Plus, Printer, ScanBarcode, Search, ShoppingBag, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPKR, addDaysPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchCustomers, type CustomerOption } from "../customers/actions";
import { findByCode, posCheckout, searchRetail, type RetailItem } from "./actions";

type CartLine = { item: RetailItem; qty: number; discount: number };
type Method = { key: string; label: string; needs_reference: boolean };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function Register({ initial, methods, canDiscount }: { initial: RetailItem[]; methods: Method[]; canDiscount: boolean }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState(initial);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState("");
  const [reference, setReference] = useState("");
  const [billDiscount, setBillDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scan = useRef<HTMLInputElement>(null);
  const key = useRef(newKey());

  useEffect(() => {
    const t = setTimeout(async () => setItems(await searchRetail(q)), 200);
    return () => clearTimeout(t);
  }, [q]);

  const add = (item: RetailItem) => {
    const inCart = cart.find((c) => c.item.id === item.id)?.qty ?? 0;
    if (item.stock != null && inCart + 1 > item.stock) { toast.error(`Only ${item.stock} ${item.unit} of ${item.name} in stock.`); return; }
    setCart((c) => c.some((x) => x.item.id === item.id) ? c.map((x) => x.item.id === item.id ? { ...x, qty: x.qty + 1 } : x) : [...c, { item, qty: 1, discount: 0 }]);
  };
  const setQty = (id: string, qty: number) => setCart((c) => c.flatMap((x) => {
    if (x.item.id !== id) return [x];
    if (qty <= 0) return [];
    if (x.item.stock != null && qty > x.item.stock) { toast.error(`Only ${x.item.stock} in stock.`); return [x]; }
    return [{ ...x, qty }];
  }));

  const onScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const code = e.currentTarget.value.trim();
    if (!code) return;
    const hit = await findByCode(code);
    if (hit) { add(hit); e.currentTarget.value = ""; } else { setQ(code); e.currentTarget.value = ""; }
  };

  const subtotal = cart.reduce((s, l) => s + l.item.sale_price * l.qty - l.discount, 0);
  const total = Math.max(0, subtotal - (Number(billDiscount) || 0));
  const paid = tendered === "" ? total : Number(tendered) || 0;
  const change = method === "cash" ? Math.max(0, paid - total) : 0;
  const short = total - Math.min(paid, total);
  const m = methods.find((x) => x.key === method);

  const pay = () => start(async () => {
    const r = await posCheckout({
      key: key.current, customer_id: customer?.id ?? null, pet_id: null,
      lines: cart.map((l) => ({ item_id: l.item.id, quantity: l.qty, discount_amount: l.discount })),
      payments: [{ method, amount: Math.min(paid, total), reference }],
      invoice_discount: Number(billDiscount) || 0, discount_reason: discountReason,
      pay_later: short > 0 && customer ? { promised_date: addDaysPK(7), reason: "Store credit — balance to pay" } : null,
    });
    if (r.ok && r.invoiceId) {
      setDone(r.invoiceId); key.current = newKey();
      setItems(await searchRetail(q));
    } else toast.error(r.message);
  });

  const reset = () => {
    setCart([]); setCustomer(null); setTendered(""); setReference(""); setBillDiscount(""); setDiscountReason(""); setMethod("cash"); setDone(null);
    setTimeout(() => scan.current?.focus(), 50);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
      <section className="grid min-w-0 content-start gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="relative">
            <ScanBarcode className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-brand" />
            <Input ref={scan} autoFocus onKeyDown={onScan} className="h-12 pl-10 text-base" placeholder="Scan barcode (or type SKU + Enter)" />
          </div>
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-9 text-base" placeholder="Search products — food, shampoo, collar…" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((i) => {
            const out = i.stock != null && i.stock <= 0;
            return (
              <button key={i.id} type="button" disabled={out} onClick={() => add(i)}
                className={cn("flex min-h-28 flex-col items-start gap-1 rounded-2xl bg-card p-3 text-left shadow-card ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-brand-muted",
                  out && "cursor-not-allowed opacity-50 hover:translate-y-0")}>
                <Package className="size-5 text-brand" />
                <span className="line-clamp-2 text-sm font-semibold">{i.name}</span>
                <span className="text-xs text-muted-foreground">{[i.brand, i.category].filter(Boolean).join(" · ")}</span>
                <span className="mt-auto flex w-full items-end justify-between">
                  <span className="font-bold tabular">{formatPKR(i.sale_price)}</span>
                  {i.stock != null && <span className={cn("text-xs", i.stock <= 0 ? "text-danger" : i.stock < 5 ? "text-warning" : "text-muted-foreground")}>{i.stock <= 0 ? "Out of stock" : `${i.stock} left`}</span>}
                </span>
              </button>
            );
          })}
          {items.length === 0 && <p className="col-span-full rounded-2xl bg-surface p-8 text-center text-muted-foreground">No store products found. Add them in Inventory with “Sold in pet store” ticked.</p>}
        </div>
      </section>

      <aside className="grid content-start gap-4 lg:sticky lg:top-20">
        <section className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
          <div className="mb-3 flex items-center gap-2"><ShoppingBag className="size-5 text-brand" /><h2 className="font-semibold">Cart</h2>
            {cart.length > 0 && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setCart([])}>Clear</Button>}</div>
          {cart.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Scan or tap products to add them.</p> : (
            <ul className="grid gap-2">
              {cart.map((l) => (
                <li key={l.item.id} className="rounded-xl bg-surface p-2.5 ring-1 ring-border">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-sm font-medium">{l.item.name}</span>
                    <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.item.id, 0)} aria-label="Remove"><Trash2 /></Button>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Button variant="outline" size="icon-sm" onClick={() => setQty(l.item.id, l.qty - 1)} aria-label="Less"><Minus /></Button>
                    <span className="w-8 text-center font-semibold tabular">{l.qty}</span>
                    <Button variant="outline" size="icon-sm" onClick={() => setQty(l.item.id, l.qty + 1)} aria-label="More"><Plus /></Button>
                    {canDiscount && <Input className="h-8 w-20 text-xs" inputMode="decimal" placeholder="Disc." value={l.discount || ""}
                      onChange={(e) => setCart((c) => c.map((x) => x.item.id === l.item.id ? { ...x, discount: Math.min(Number(e.target.value) || 0, x.item.sale_price * x.qty) } : x))} />}
                    <span className="ml-auto font-bold tabular">{formatPKR(l.item.sale_price * l.qty - l.discount)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
          <CustomerPicker value={customer} onChange={setCustomer} />
          {canDiscount && cart.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Input inputMode="decimal" placeholder="Bill discount" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} />
              <Input placeholder="Reason" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
            </div>
          )}
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="font-semibold">Total</span><span className="text-3xl font-bold tabular">{formatPKR(total)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {methods.slice(0, 6).map((x) => (
              <button key={x.key} type="button" onClick={() => setMethod(x.key)}
                className={cn("h-10 rounded-xl text-sm font-semibold ring-1", method === x.key ? "bg-ink text-white ring-ink" : "bg-card ring-border")}>{x.label.split(" ")[0]}</button>
            ))}
          </div>
          {method === "cash" ? (
            <Input className="h-12 text-right text-lg font-semibold tabular" inputMode="decimal" placeholder={`Cash received (${formatPKR(total)})`}
              value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))} />
          ) : m?.needs_reference && <Input placeholder={`${m.label} transaction ID`} value={reference} onChange={(e) => setReference(e.target.value)} />}
          {change > 0 && <p className="rounded-xl bg-info-soft px-3 py-2 text-center text-lg font-bold text-info">Change: {formatPKR(change)}</p>}
          {short > 0 && <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{customer ? `${formatPKR(short)} will be added to ${customer.title}'s account.` : "Walk-in sales must be paid in full — or choose the customer."}</p>}
          {discountReason.trim() === "" && Number(billDiscount) > 0 && <p className="text-xs text-danger">Give a reason for the discount.</p>}
          <Button size="lg" className="h-14 text-lg" onClick={pay}
            disabled={pending || cart.length === 0 || (short > 0 && !customer) || (m?.needs_reference && !reference.trim()) || (Number(billDiscount) > 0 && !discountReason.trim())}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} Pay {formatPKR(Math.min(paid, total))}
          </Button>
        </section>
      </aside>

      <Dialog open={!!done} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="rounded-2xl text-center">
          <DialogHeader><DialogTitle className="text-2xl">Sale complete</DialogTitle><DialogDescription>Stock has been updated.</DialogDescription></DialogHeader>
          {change > 0 && <p className="text-xl font-bold text-info">Give change: {formatPKR(change)}</p>}
          <DialogFooter className="sm:justify-center">
            <Button asChild variant="outline"><Link href={`/print/invoice/${done}?receipt=1`} target="_blank"><Printer /> Print receipt</Link></Button>
            <Button onClick={reset}><Plus /> New sale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomerPicker({ value, onChange }: { value: CustomerOption | null; onChange: (c: CustomerOption | null) => void }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<CustomerOption[]>([]);
  useEffect(() => {
    if (value || q.trim().length < 2) return;
    const t = setTimeout(async () => setOpts(await searchCustomers(q)), 250);
    return () => clearTimeout(t);
  }, [q, value]);
  if (value) return (
    <div className="flex items-center gap-2 rounded-xl bg-brand-wash px-3 py-2 ring-1 ring-brand-muted">
      <User className="size-4 text-brand" /><span className="flex-1 truncate text-sm font-semibold">{value.title}</span>
      <Button variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label="Remove customer"><X /></Button>
    </div>
  );
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer (optional) — name or phone" />
      {q.trim().length >= 2 && opts.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-xl bg-popover p-1 shadow-float ring-1 ring-border">
          {opts.map((o) => <li key={o.id}><button type="button" onClick={() => { onChange(o); setQ(""); setOpts([]); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"><b>{o.title}</b> <span className="text-muted-foreground">{o.subtitle}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

