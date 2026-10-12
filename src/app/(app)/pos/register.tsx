"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Loader2, MapPin, Minus, Package, Plus, Printer, ScanBarcode, Search, ShoppingBag, Store, Trash2, Truck, User, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatPKR, addDaysPK, todayPK } from "@/lib/format";
import { cn } from "@/lib/utils";
import { customerAddress, searchCustomers, type CustomerOption } from "../customers/actions";
import { findByCode, posCheckout, searchRetail, type RetailItem } from "./actions";

type CartLine = { item: RetailItem; qty: number; discount: number; price: number };
type Method = { key: string; label: string; needs_reference: boolean };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function Register({ initial, popular = [], methods, canDiscount, defaultDeliveryCharge }: {
  initial: RetailItem[]; popular?: RetailItem[]; methods: Method[]; canDiscount: boolean; defaultDeliveryCharge: number;
}) {
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
  // In-store sales finish without a pop-up: the cart clears and this bar shows change + receipt.
  const [lastSale, setLastSale] = useState<{ id: string; total: number; change: number } | null>(null);
  // Home delivery (spec §2–§3): address from the client profile, editable for this order; charge editable by distance.
  const [delivery, setDelivery] = useState(false);
  const [address, setAddress] = useState("");
  const [charge, setCharge] = useState(String(defaultDeliveryCharge));
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [cod, setCod] = useState(false);
  const [pending, start] = useTransition();
  const scan = useRef<HTMLInputElement>(null);
  const key = useRef(newKey());

  useEffect(() => {
    const t = setTimeout(async () => setItems(await searchRetail(q)), 200);
    return () => clearTimeout(t);
  }, [q]);

  const chooseCustomer = async (c: CustomerOption | null) => {
    setCustomer(c);
    setAddress(c ? await customerAddress(c.id) : "");
  };

  const add = (item: RetailItem) => {
    if (!item.is_available) { toast.error(`${item.name} is marked “not available” — switch it on in Inventory if it's back in the shop.`); return; }
    const inCart = cart.find((c) => c.item.id === item.id)?.qty ?? 0;
    if (item.stock != null && inCart + 1 > item.stock) { toast.error(`Only ${item.stock} ${item.unit} of ${item.name} in stock.`); return; }
    setCart((c) => c.some((x) => x.item.id === item.id) ? c.map((x) => x.item.id === item.id ? { ...x, qty: x.qty + 1 } : x) : [...c, { item, qty: 1, discount: 0, price: item.sale_price }]);
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
    if (hit) { addAndClear(hit); e.currentTarget.value = ""; } else { setQ(code); e.currentTarget.value = ""; }
  };

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty - l.discount, 0);
  const deliveryCharge = delivery ? Math.max(0, Number(charge) || 0) : 0;
  const total = Math.max(0, subtotal + deliveryCharge - (Number(billDiscount) || 0));
  const payNow = !(delivery && cod);
  const paid = !payNow ? 0 : tendered === "" ? total : Number(tendered) || 0;
  const change = method === "cash" ? Math.max(0, paid - total) : 0;
  const short = total - Math.min(paid, total);
  const m = methods.find((x) => x.key === method);
  const deliveryProblem = !delivery ? null
    : !customer ? "Choose the customer for a home delivery."
    : !address.trim() ? "Enter the delivery address."
    : charge.trim() === "" || Number(charge) < 0 ? "Enter the delivery charge."
    : deliveryCharge === 0 && !canDiscount ? "Only staff who can give discounts can waive the delivery charge."
    : null;

  const pay = () => start(async () => {
    const saleTotal = total, saleChange = change, wasDelivery = delivery;
    const r = await posCheckout({
      key: key.current, customer_id: customer?.id ?? null, pet_id: null,
      lines: cart.map((l) => ({ item_id: l.item.id, quantity: l.qty, discount_amount: l.discount, unit_price: l.item.price_is_editable ? l.price : undefined })),
      payments: payNow ? [{ method, amount: Math.min(paid, total), reference }] : [],
      invoice_discount: Number(billDiscount) || 0, discount_reason: discountReason,
      pay_later: !payNow ? { promised_date: todayPK(), reason: "Cash on delivery" }
        : short > 0 && customer ? { promised_date: addDaysPK(7), reason: "Store credit — balance to pay" } : null,
      delivery: delivery ? { address: address.trim(), charge: deliveryCharge, notes: deliveryNotes.trim() || undefined } : null,
    });
    if (r.ok && r.invoiceId) {
      key.current = newKey();
      if (wasDelivery) setDone(r.invoiceId);
      else { setLastSale({ id: r.invoiceId, total: saleTotal, change: saleChange }); clearSale(); }
      setItems(await searchRetail(q));
    } else toast.error(r.message);
  });

  const clearSale = () => {
    setCart([]); setCustomer(null); setTendered(""); setReference(""); setBillDiscount(""); setDiscountReason(""); setMethod("cash"); setDone(null);
    setDelivery(false); setAddress(""); setCharge(String(defaultDeliveryCharge)); setDeliveryNotes(""); setCod(false);
    setTimeout(() => scan.current?.focus(), 50);
  };
  const reset = () => { clearSale(); setLastSale(null); };
  const addAndClear = (i: RetailItem) => { setLastSale(null); add(i); };
  const canPay = !(pending || cart.length === 0 || cart.some((l) => !(l.price > 0)) || !!deliveryProblem || (payNow && short > 0 && !customer)
    || (payNow && m?.needs_reference && !reference.trim()) || (Number(billDiscount) > 0 && !discountReason.trim()));

  return (
    <div className={cn("grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]", cart.length > 0 && "pb-24 lg:pb-0")}>
      <section className="grid min-w-0 content-start gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="relative">
            <ScanBarcode className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-brand" />
            <Input ref={scan} autoFocus onKeyDown={onScan} className="h-12 pl-10 text-base" placeholder="Scan barcode (or type SKU + Enter)" />
          </div>
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-12 pl-9 text-base" placeholder="Search products — food, shampoo, collar…"
              onKeyDown={(e) => { if (e.key === "Enter" && items.length === 1) { addAndClear(items[0]); setQ(""); } }} />
          </div>
        </div>
        {!q && popular.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Zap className="size-3.5 text-brand" /> Quick picks — best sellers this month</p>
            <div className="flex flex-wrap gap-2">
              {popular.map((i) => {
                const why = blocked(i);
                return (
                  <button key={i.id} type="button" disabled={!!why} onClick={() => addAndClear(i)}
                    className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-sm shadow-card ring-1 ring-border transition hover:ring-brand-muted disabled:opacity-50">
                    <span className="font-medium">{i.name}</span><span className="font-semibold text-brand tabular">{formatPKR(i.sale_price)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {productCards(items).map((card) => card.sizes.length === 1 && !card.family ? (
            <SingleCard key={card.key} item={card.sizes[0]} onAdd={addAndClear} />
          ) : (
            <SizesCard key={card.key} card={card} onAdd={addAndClear} />
          ))}
          {items.length === 0 && <p className="col-span-full rounded-2xl bg-surface p-8 text-center text-muted-foreground">No store products found. Add them in Inventory with “Sold in pet store” ticked.</p>}
        </div>
      </section>

      <aside id="checkout" className="grid scroll-mt-20 content-start gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100svh-6rem)] lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:pb-2 [scrollbar-width:thin]">
        {lastSale && (
          <section className="flex flex-wrap items-center gap-2 rounded-2xl bg-success-soft p-3 text-success ring-1 ring-success/30" role="status">
            <Check className="size-5" />
            <span className="font-semibold">Sale complete · {formatPKR(lastSale.total)}</span>
            {lastSale.change > 0 && <span className="w-full text-lg font-bold">Give change: {formatPKR(lastSale.change)}</span>}
            <Button asChild size="sm" variant="outline" className="ml-auto bg-card"><Link href={`/print/invoice/${lastSale.id}?receipt=1`} target="_blank"><Printer /> Receipt</Link></Button>
            <Button size="sm" variant="ghost" onClick={() => setLastSale(null)} aria-label="Dismiss"><X /></Button>
          </section>
        )}
        <section className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
          <div className="mb-3 flex items-center gap-2"><ShoppingBag className="size-5 text-brand" /><h2 className="font-semibold">Cart</h2>
            {cart.length > 0 && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setCart([])}>Clear</Button>}</div>
          {cart.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Scan or tap products to add them.</p> : (
            <ul className="grid gap-2">
              {cart.map((l) => (
                <li key={l.item.id} className="rounded-xl bg-surface p-2.5 ring-1 ring-border">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-sm font-medium">{l.item.name}</span>
                    {l.item.price_is_editable && (
                      // Items whose price is set at the till: starts at the list price, can be changed here.
                      <Input className="h-7 w-24 text-right text-xs tabular" inputMode="decimal" aria-label={`Price of ${l.item.name}`} value={l.price || ""}
                        onChange={(e) => { const v = Number(e.target.value.replace(/[^\d.]/g, "")) || 0; setCart((c) => c.map((x) => x.item.id === l.item.id ? { ...x, price: v } : x)); }} />
                    )}
                    <Button variant="ghost" size="icon-sm" onClick={() => setQty(l.item.id, 0)} aria-label="Remove"><Trash2 /></Button>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <Button variant="outline" size="icon-sm" onClick={() => setQty(l.item.id, l.qty - 1)} aria-label="Less"><Minus /></Button>
                    <span className="w-8 text-center font-semibold tabular">{l.qty}</span>
                    <Button variant="outline" size="icon-sm" onClick={() => setQty(l.item.id, l.qty + 1)} aria-label="More"><Plus /></Button>
                    {canDiscount && <Input className="h-8 w-20 text-xs" inputMode="decimal" placeholder="Disc." value={l.discount || ""}
                      onChange={(e) => setCart((c) => c.map((x) => x.item.id === l.item.id ? { ...x, discount: Math.min(Number(e.target.value) || 0, x.price * x.qty) } : x))} />}
                    <span className="ml-auto font-bold whitespace-nowrap tabular">{formatPKR(l.price * l.qty - l.discount)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="grid gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="How the customer gets the order">
            {([[false, "In store", Store], [true, "Home delivery", Truck]] as const).map(([v, label, Icon]) => (
              <button key={label} type="button" role="radio" aria-checked={delivery === v} onClick={() => setDelivery(v)}
                className={cn("flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition",
                  delivery === v ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          <CustomerPicker value={customer} onChange={chooseCustomer} required={delivery} />
          {delivery && (
            <div className="grid gap-2 rounded-xl bg-surface p-3 ring-1 ring-border">
              <label className="grid gap-1 text-sm font-medium">
                <span className="flex items-center gap-1.5"><MapPin className="size-4 text-brand" /> Deliver to</span>
                <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)}
                  placeholder={customer ? "No address saved — type it here (house, block, street, area)" : "Choose the customer first"} />
                <span className="text-xs font-normal text-muted-foreground">Filled from the customer&apos;s profile. Change it here if this order goes somewhere else.</span>
              </label>
              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <label className="grid gap-1 text-sm font-medium">
                  Delivery charge (Rs.)
                  <Input inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value.replace(/[^\d.]/g, ""))} className="tabular" />
                </label>
                <div className="flex gap-1 pb-0.5">
                  {[defaultDeliveryCharge, 100, 150].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
                    <Button key={v} type="button" size="sm" variant={Number(charge) === v ? "default" : "outline"} onClick={() => setCharge(String(v))}>{v}</Button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Suggested {formatPKR(defaultDeliveryCharge)} — change it by distance.{canDiscount ? " Enter 0 to waive it." : ""}</p>
              <Input placeholder="Delivery note (optional) — e.g. call before coming, gate 2" value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} />
            </div>
          )}
          {canDiscount && cart.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Input inputMode="decimal" placeholder="Bill discount" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} />
              <Input placeholder="Reason" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
            </div>
          )}
          {delivery && (
            <dl className="grid gap-1 border-t pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Products</dt><dd className="tabular">{formatPKR(Math.max(0, subtotal - (Number(billDiscount) || 0)))}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Delivery charge</dt><dd className="tabular">{deliveryCharge === 0 ? "Waived" : formatPKR(deliveryCharge)}</dd></div>
            </dl>
          )}
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="font-semibold">Total</span><span className="text-3xl font-bold tabular">{formatPKR(total)}</span>
          </div>
          {delivery && (
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="When the customer pays">
              {([[false, "Pay now"], [true, "Cash on delivery"]] as const).map(([v, label]) => (
                <button key={label} type="button" role="radio" aria-checked={cod === v} onClick={() => setCod(v)}
                  className={cn("h-9 rounded-lg text-sm font-semibold transition", cod === v ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>{label}</button>
              ))}
            </div>
          )}
          {payNow && (
            <div className="grid grid-cols-3 gap-1.5">
              {methods.slice(0, 6).map((x) => (
                <button key={x.key} type="button" onClick={() => setMethod(x.key)}
                  className={cn("h-10 rounded-xl text-sm font-semibold ring-1", method === x.key ? "bg-ink text-white ring-ink" : "bg-card ring-border")}>{x.label.split(" ")[0]}</button>
              ))}
            </div>
          )}
          {!payNow ? (
            <p className="rounded-xl bg-info-soft px-3 py-2 text-sm text-info">The rider collects {formatPKR(total)}. Record the cash on <b>Home deliveries</b> when it&apos;s delivered.</p>
          ) : method === "cash" ? (
            <Input className="h-12 text-right text-lg font-semibold tabular" inputMode="decimal" placeholder={`Cash received (${formatPKR(total)})`}
              value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && canPay) pay(); }} />
          ) : m?.needs_reference && <Input placeholder={`${m.label} transaction ID`} value={reference} onChange={(e) => setReference(e.target.value)} />}
          {change > 0 && <p className="rounded-xl bg-info-soft px-3 py-2 text-center text-lg font-bold text-info">Change: {formatPKR(change)}</p>}
          {deliveryProblem && cart.length > 0 && <p className="text-xs text-danger">{deliveryProblem}</p>}
          {cart.some((l) => !(l.price > 0)) && <p className="text-xs text-danger">Enter the price for {cart.find((l) => !(l.price > 0))?.item.name}.</p>}
          {payNow && short > 0 && <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{customer ? `${formatPKR(short)} will be added to ${customer.title}'s account.` : "Walk-in sales must be paid in full — or choose the customer."}</p>}
          {discountReason.trim() === "" && Number(billDiscount) > 0 && <p className="text-xs text-danger">Give a reason for the discount.</p>}
          <Button size="lg" className="h-14 text-lg" onClick={pay} disabled={!canPay}>
            {pending ? <Loader2 className="animate-spin" /> : delivery ? <Truck /> : <Check />}
            {!payNow ? "Confirm order — cash on delivery" : `Pay ${formatPKR(Math.min(paid, total))}`}
          </Button>
        </section>
      </aside>

      {/* Phones: products come first, so keep the total and a way to pay always in reach. */}
      {cart.length > 0 && !done && (
        <div className="fixed inset-x-3 bottom-3 z-30 flex items-center gap-3 rounded-2xl bg-ink p-2 pl-4 text-white shadow-float lg:hidden">
          <ShoppingBag className="size-5 shrink-0 text-white/70" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-xs text-white/60">{cart.reduce((n, l) => n + l.qty, 0)} item{cart.reduce((n, l) => n + l.qty, 0) === 1 ? "" : "s"}{delivery ? " · home delivery" : ""}</span>
            <span className="block text-lg font-bold tabular">{formatPKR(total)}</span>
          </span>
          <Button onClick={() => document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Checkout</Button>
        </div>
      )}

      <Dialog open={!!done} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="rounded-2xl text-center">
          <DialogHeader>
            <DialogTitle className="text-2xl">{delivery ? "Delivery order saved" : "Sale complete"}</DialogTitle>
            <DialogDescription>{delivery ? "Stock updated. It's on the Home deliveries list as “To dispatch”." : "Stock has been updated."}</DialogDescription>
          </DialogHeader>
          {delivery && <p className="rounded-xl bg-surface p-3 text-sm ring-1 ring-border"><MapPin className="mr-1 inline size-4 text-brand" />{address}</p>}
          {change > 0 && <p className="text-xl font-bold text-info">Give change: {formatPKR(change)}</p>}
          <DialogFooter className="sm:justify-center">
            <Button asChild variant="outline"><Link href={`/print/invoice/${done}?receipt=1`} target="_blank"><Printer /> Print receipt</Link></Button>
            {delivery && <Button asChild variant="outline"><Link href="/pos/deliveries"><Truck /> Deliveries</Link></Button>}
            <Button onClick={reset}><Plus /> New sale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomerPicker({ value, onChange, required }: { value: CustomerOption | null; onChange: (c: CustomerOption | null) => void; required?: boolean }) {
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
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={required ? "Customer (required for delivery) — name or phone" : "Customer (optional) — name or phone"} />
      {q.trim().length >= 2 && opts.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-xl bg-popover p-1 shadow-float ring-1 ring-border">
          {opts.map((o) => <li key={o.id}><button type="button" onClick={() => { onChange(o); setQ(""); setOpts([]); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"><b>{o.title}</b> <span className="text-muted-foreground">{o.subtitle}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}


type Card = { key: string; family: boolean; name: string; brand: string | null; category: string | null; sizes: RetailItem[] };

/** One card per product: items that are sizes of the same product share a card. */
function productCards(items: RetailItem[]): Card[] {
  const cards = new Map<string, Card>();
  for (const i of items) {
    const key = i.family_id ?? i.id;
    const c = cards.get(key) ?? { key, family: !!i.family_id, name: i.family_name ?? i.name, brand: i.brand, category: i.category, sizes: [] };
    c.sizes.push(i);
    cards.set(key, c);
  }
  return [...cards.values()]
    .map((c) => ({ ...c, sizes: c.sizes.sort((a, b) => (a.size_grams ?? Infinity) - (b.size_grams ?? Infinity) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Why this item can't be sold right now (or null). */
function blocked(i: RetailItem) {
  if (!i.is_available) return "Not available";
  if (i.stock != null && i.stock <= 0) return "Out of stock";
  return null;
}

function SingleCard({ item: i, onAdd }: { item: RetailItem; onAdd: (i: RetailItem) => void }) {
  const why = blocked(i);
  return (
    <button type="button" disabled={!!why} onClick={() => onAdd(i)}
      className={cn("flex min-h-28 flex-col items-start gap-1 rounded-2xl bg-card p-3 text-left shadow-card ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-brand-muted",
        why && "cursor-not-allowed opacity-50 hover:translate-y-0")}>
      <Package className="size-5 text-brand" />
      <span className="line-clamp-2 text-sm font-semibold">{i.name}</span>
      <span className="text-xs text-muted-foreground">{[i.brand, i.category].filter(Boolean).join(" · ")}</span>
      <span className="mt-auto flex w-full items-end justify-between">
        <span className="font-bold tabular">{formatPKR(i.sale_price)}</span>
        {why ? <span className="text-xs text-danger">{why}</span>
          : i.stock != null && <span className={cn("text-xs", i.stock < 5 ? "text-warning" : "text-muted-foreground")}>{i.stock} left</span>}
      </span>
    </button>
  );
}

/** A product with several sizes: one button per size, sizes that can't be sold are greyed out. */
function SizesCard({ card, onAdd }: { card: Card; onAdd: (i: RetailItem) => void }) {
  const anyOpen = card.sizes.some((i) => !blocked(i));
  return (
    <div className={cn("col-span-2 flex flex-col gap-2 rounded-2xl bg-card p-3 shadow-card ring-1 ring-border sm:col-span-1", !anyOpen && "opacity-60")}>
      <div className="flex items-start gap-2">
        <Package className="mt-0.5 size-5 shrink-0 text-brand" />
        <span className="min-w-0">
          <span className="line-clamp-2 text-sm font-semibold">{card.name}</span>
          <span className="block text-xs text-muted-foreground">{[card.brand, card.category, `${card.sizes.length} sizes`].filter(Boolean).join(" · ")}</span>
        </span>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-1.5">
        {card.sizes.map((i) => {
          const why = blocked(i);
          return (
            <button key={i.id} type="button" disabled={!!why} onClick={() => onAdd(i)} title={why ?? `Add ${i.name}`}
              className={cn("rounded-xl px-2 py-1.5 text-left ring-1 transition",
                why ? "cursor-not-allowed bg-muted text-muted-foreground ring-transparent" : "bg-surface ring-border hover:bg-brand-soft hover:ring-brand-muted")}>
              <span className="block text-xs font-semibold">{i.size_label ?? i.name}</span>
              <span className={cn("block text-[11px] tabular", why ? "line-through" : "text-foreground/80")}>{formatPKR(i.sale_price)}</span>
              {why ? <span className="block text-[10px] font-semibold text-danger">{why}</span>
                : i.stock != null && <span className={cn("block text-[10px]", i.stock < 5 ? "text-warning" : "text-muted-foreground")}>{i.stock} left</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
