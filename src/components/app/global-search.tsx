"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PawPrint, Search, User } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type Hit = { kind: "customer" | "pet"; id: string; code: string; title: string; subtitle: string };

/** Ctrl/⌘+K (or "/") search across customers & pets by name, phone, ID or microchip. Results are filtered by RLS. */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !isTyping(e.target))) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    const short = value.trim().length < 2;
    if (short) {
      seq.current++; // drop any in-flight response
      setHits([]);
    }
    setLoading(!short);
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const { data } = await createClient().rpc("global_search", { q, max_results: 15 });
      if (id !== seq.current) return;
      setHits((data ?? []) as Hit[]);
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const go = (h: Hit) => {
    setOpen(false);
    onQueryChange("");
    router.push(h.kind === "customer" ? `/customers/${h.id}` : `/pets/${h.id}`);
  };

  const customers = hits.filter((h) => h.kind === "customer");
  const pets = hits.filter((h) => h.kind === "pet");

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}
        className="h-9 w-full max-w-md justify-start gap-2 bg-background font-normal text-muted-foreground">
        <Search className="size-4" />
        <span className="truncate">Search pet, owner, phone, ID…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[20%] translate-y-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">Search customers and pets</DialogDescription>
          {/* Matching happens in Postgres (fuzzy + phone), so cmdk's own filter is off. */}
          <CommandPrimitive shouldFilter={false} className="flex flex-col">
            <CommandInput placeholder="Pet name, owner, 0300…, C-00012, microchip…" value={query} onValueChange={onQueryChange} />
            <CommandList className="max-h-[60vh]">
              {loading && (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Searching…
                </div>
              )}
              {!loading && query.trim().length >= 2 && <CommandEmpty>No matches.</CommandEmpty>}
              {customers.length > 0 && (
                <CommandGroup heading="Customers">
                  {customers.map((h) => (
                    <CommandItem key={h.id} value={`${h.kind}-${h.id}`} onSelect={() => go(h)}>
                      <User /> <ResultText h={h} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {pets.length > 0 && (
                <CommandGroup heading="Pets">
                  {pets.map((h) => (
                    <CommandItem key={h.id} value={`${h.kind}-${h.id}`} onSelect={() => go(h)}>
                      <PawPrint /> <ResultText h={h} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResultText({ h }: { h: Hit }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="truncate font-medium">{h.title}</span>
      <span className="truncate text-xs text-muted-foreground">{h.subtitle}</span>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{h.code}</span>
    </div>
  );
}

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}
