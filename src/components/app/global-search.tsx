"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, CalendarPlus, Clock, CornerDownLeft, ListOrdered, Loader2, Package, PawPrint, Receipt, Search, ShoppingBag, Ticket,
  User, UserPlus, X, type LucideIcon,
} from "lucide-react";
import { Command as Cmdk } from "cmdk";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { prettifyPhones } from "@/lib/phone";
import { cn } from "@/lib/utils";

/** Dispatch on window to open the search from anywhere; detail { q?, scope? } pre-fills it. */
export const OPEN_SEARCH_EVENT = "bdah:open-search";
export function openSearch(detail?: { q?: string; scope?: Scope }) {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail }));
}

type Kind = "customer" | "pet" | "bill" | "item" | "visit";
type Scope = "all" | "owner" | "pet" | "bill" | "item";
type Hit = { kind: Kind; id: string; code: string | null; title: string; subtitle: string | null; badge: string | null; badge_tone: string | null; href: string; rank: number };
export type QuickAction = { label: string; href: string; icon: "owner" | "checkin" | "book" | "bill" | "store" };

const KIND: Record<Kind, { label: string; icon: LucideIcon; tile: string }> = {
  visit: { label: "Today's queue", icon: Ticket, tile: "bg-brand-gradient text-white" },
  customer: { label: "Pet owners", icon: User, tile: "bg-info-soft text-info" },
  pet: { label: "Pets", icon: PawPrint, tile: "bg-brand-soft text-brand" },
  bill: { label: "Bills", icon: Receipt, tile: "bg-success-soft text-success" },
  item: { label: "Price list & stock", icon: Package, tile: "bg-warning-soft text-warning" },
};
const ORDER: Kind[] = ["visit", "customer", "pet", "bill", "item"];
const SCOPES: { key: Scope; label: string; kinds: Kind[] }[] = [
  { key: "all", label: "All", kinds: ORDER },
  { key: "owner", label: "Owners", kinds: ["customer"] },
  { key: "pet", label: "Pets", kinds: ["pet"] },
  { key: "bill", label: "Bills", kinds: ["bill"] },
  { key: "item", label: "Items", kinds: ["item"] },
];
const ACTION_ICON: Record<QuickAction["icon"], LucideIcon> = { owner: UserPlus, checkin: ListOrdered, book: CalendarPlus, bill: Receipt, store: ShoppingBag };
const EXAMPLES = [
  { q: "0300 1234", hint: "any part of a phone" },
  { q: "tiger ahmed", hint: "pet + owner" },
  { q: "P-00012", hint: "pet / owner ID" },
  { q: "#5", hint: "today's token" },
  { q: "bill: 123", hint: "bill number" },
  { q: "item: royal canin", hint: "product / stock" },
];
const BADGE: Record<string, string> = {
  danger: "bg-danger-soft text-danger", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info", neutral: "bg-muted text-muted-foreground",
};
const RECENT_KEY = "bdah:recent-search";

function loadRecent(): Hit[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Hit[]; } catch { return []; }
}
function saveRecent(h: Hit) {
  try {
    const next = [h, ...loadRecent().filter((r) => !(r.kind === h.kind && r.id === h.id))].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode: no recents */ }
}

/** Bold the parts of `text` that match the words typed. */
function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.toLowerCase().replace(/^\s*[a-z]+\s*:/i, "").split(/\s+/).filter((w) => w.length >= 2).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "ig"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-brand-soft px-0.5 text-brand">{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}

/**
 * Ctrl/⌘+K (or "/") — one search for owners, pets, bills, price-list items and today's tokens.
 * Matching and permissions happen in Postgres (public.smart_search): fuzzy names, any phone format,
 * IDs, microchips, "pet + owner" words and prefixes like "pet:" / "bill:".
 */
export function GlobalSearch({ actions = [] }: { actions?: QuickAction[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  // Results are tagged with the query they answer, so stale ones are never shown.
  const [result, setResult] = useState<{ key: string; hits: Hit[] }>({ key: "", hits: [] });
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !isTyping(e.target))) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ q?: string; scope?: Scope } | undefined>).detail;
      if (d?.q !== undefined) setQuery(d.q);
      if (d?.scope) setScope(d.scope);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_SEARCH_EVENT, onOpen); };
  }, []);

  // Re-read each time the window opens.
  const recent = useMemo(() => (open ? loadRecent() : []), [open]);

  const trimmed = query.trim();
  const searchable = trimmed.length >= 2 || /^#\d/.test(trimmed) || (scope === "bill" && /\d/.test(trimmed));
  const key = `${scope}|${trimmed}`;
  useEffect(() => {
    const id = ++seq.current;
    if (!searchable) return;
    const t = setTimeout(async () => {
      const { data } = await createClient().rpc("smart_search", { q: trimmed, p_scope: scope, max_results: 40 });
      if (id === seq.current) setResult({ key, hits: (data ?? []) as Hit[] });
    }, 160);
    return () => clearTimeout(t);
  }, [key, trimmed, scope, searchable]);
  // While the next answer loads, keep the previous one on screen (no flicker between keystrokes).
  const hits = useMemo(() => (searchable ? result.hits : []), [searchable, result]);
  const loading = searchable && result.key !== key;

  const go = useCallback((h: Hit) => {
    saveRecent(h);
    setOpen(false);
    setQuery("");
    router.push(h.href);
  }, [router]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const h of hits) c[h.kind] = (c[h.kind] ?? 0) + 1;
    return c;
  }, [hits]);
  const groups = ORDER.map((k) => ({ kind: k, rows: hits.filter((h) => h.kind === k) })).filter((g) => g.rows.length);

  // Tab / Shift+Tab switches the filter without leaving the keyboard.
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const i = SCOPES.findIndex((s) => s.key === scope);
    setScope(SCOPES[(i + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length].key);
  };

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}
        className="h-11 w-full max-w-xl justify-start gap-2.5 rounded-xl bg-muted/80 px-4 font-normal text-muted-foreground ring-1 ring-transparent hover:bg-muted hover:ring-border">
        <Search className="size-[18px]" />
        <span className="truncate">Search owners, pets, phone, bills, products…</span>
        <kbd className="ml-auto hidden rounded-md border bg-card px-1.5 py-0.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false}
          className="top-[8%] max-h-[84svh] translate-y-0 gap-0 overflow-hidden rounded-3xl p-0 shadow-float sm:top-[12%] sm:max-w-2xl"
          onOpenAutoFocus={(e) => { e.preventDefault(); input.current?.focus(); }}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">Search owners, pets, bills, products and today&apos;s queue</DialogDescription>
          {/* Matching happens in Postgres, so cmdk's own filtering is off. */}
          <Cmdk shouldFilter={false} loop className="flex min-h-0 flex-col">
            <div className="flex items-center gap-3 border-b px-4">
              {loading ? <Loader2 className="size-5 shrink-0 animate-spin text-brand" /> : <Search className="size-5 shrink-0 text-brand" />}
              <Cmdk.Input ref={input} value={query} onValueChange={setQuery} onKeyDown={onInputKey}
                placeholder="Name, phone, ID, microchip, bill no., product…"
                className="h-16 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground/70" />
              {query && (
                <button type="button" onClick={() => { setQuery(""); input.current?.focus(); }} aria-label="Clear search"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
              )}
              <kbd className="hidden rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">Esc</kbd>
            </div>

            <div className="flex gap-1.5 overflow-x-auto border-b px-4 py-2.5 [scrollbar-width:none]" role="tablist" aria-label="What to search">
              {SCOPES.map((s) => {
                const n = s.key === "all" ? hits.length : s.kinds.reduce((a, k) => a + (counts[k] ?? 0), 0);
                return (
                  <button key={s.key} type="button" role="tab" aria-selected={scope === s.key} onClick={() => { setScope(s.key); input.current?.focus(); }}
                    className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition",
                      scope === s.key ? "bg-ink text-white ring-ink" : "bg-card text-muted-foreground ring-border hover:text-foreground")}>
                    {s.label}{searchable && scope === "all" && s.key !== "all" && n > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] text-foreground">{n}</span>}
                  </button>
                );
              })}
            </div>

            <Cmdk.List className="max-h-[56svh] overflow-y-auto overscroll-contain p-2">
              {!searchable && (
                <>
                  {recent.length > 0 && (
                    <Cmdk.Group heading="Recent" className="px-1 pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                      {recent.map((h) => <Row key={`r-${h.kind}-${h.id}`} h={h} q="" onSelect={() => go(h)} recent />)}
                    </Cmdk.Group>
                  )}
                  <div className="px-3 pt-1 pb-3">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">You can search by…</p>
                    <div className="flex flex-wrap gap-1.5">
                      {EXAMPLES.map((x) => (
                        <button key={x.q} type="button" onClick={() => { setQuery(x.q); input.current?.focus(); }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-xs ring-1 ring-border hover:ring-brand-muted">
                          <code className="font-mono font-semibold text-foreground">{x.q}</code><span className="text-muted-foreground">{x.hint}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {actions.length > 0 && (
                    <Cmdk.Group heading="Quick actions" className="px-1 pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                      {actions.map((a) => {
                        const Icon = ACTION_ICON[a.icon];
                        return (
                          <Cmdk.Item key={a.href} value={`action-${a.href}`} onSelect={() => { setOpen(false); router.push(a.href); }}
                            className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-sm data-[selected=true]:bg-muted">
                            <span className="flex size-8 items-center justify-center rounded-lg bg-muted"><Icon className="size-4" /></span>
                            <span className="flex-1 font-medium">{a.label}</span>
                            <ArrowRight className="size-4 text-muted-foreground" />
                          </Cmdk.Item>
                        );
                      })}
                    </Cmdk.Group>
                  )}
                </>
              )}

              {searchable && !loading && hits.length === 0 && (
                <Cmdk.Empty className="px-4 py-10 text-center">
                  <p className="font-semibold">Nothing found for “{trimmed}”</p>
                  <p className="mt-1 text-sm text-muted-foreground">Try fewer letters, part of the phone number, or the ID on a card or bill.</p>
                  {scope !== "all" && <button type="button" className="mt-3 text-sm font-semibold text-brand hover:underline" onClick={() => setScope("all")}>Search everything instead</button>}
                </Cmdk.Empty>
              )}

              {groups.map((g) => (
                <Cmdk.Group key={g.kind} heading={KIND[g.kind].label}
                  className="px-1 pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                  {g.rows.map((h) => <Row key={`${h.kind}-${h.id}`} h={h} q={trimmed} onSelect={() => go(h)} />)}
                </Cmdk.Group>
              ))}
            </Cmdk.List>

            <div className="hidden items-center gap-4 border-t bg-surface px-4 py-2 text-[11px] text-muted-foreground sm:flex">
              <span className="inline-flex items-center gap-1"><kbd className="rounded border bg-card px-1 font-mono">↑</kbd><kbd className="rounded border bg-card px-1 font-mono">↓</kbd> move</span>
              <span className="inline-flex items-center gap-1"><kbd className="rounded border bg-card px-1 font-mono"><CornerDownLeft className="inline size-3" /></kbd> open</span>
              <span className="inline-flex items-center gap-1"><kbd className="rounded border bg-card px-1 font-mono">Tab</kbd> switch filter</span>
              <span className="ml-auto">Tip: <code className="font-mono">pet:</code> <code className="font-mono">owner:</code> <code className="font-mono">bill:</code> <code className="font-mono">item:</code></span>
            </div>
          </Cmdk>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ h, q, onSelect, recent }: { h: Hit; q: string; onSelect: () => void; recent?: boolean }) {
  const k = KIND[h.kind];
  return (
    <Cmdk.Item value={`${h.kind}-${h.id}`} onSelect={onSelect}
      className="group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 data-[selected=true]:bg-muted">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", k.tile)}>
        {recent ? <Clock className="size-4" /> : <k.icon className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold"><Highlight text={h.title} q={q} /></span>
          {h.badge && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", BADGE[h.badge_tone ?? "neutral"] ?? BADGE.neutral)}>{h.badge}</span>}
        </span>
        {h.subtitle && <span className="block truncate text-xs text-muted-foreground"><Highlight text={prettifyPhones(h.subtitle)} q={q} /></span>}
      </span>
      {h.code && <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:block">{h.code}</span>}
      <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition group-data-[selected=true]:opacity-100" />
    </Cmdk.Item>
  );
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}
