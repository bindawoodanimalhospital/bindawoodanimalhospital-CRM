"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PawPrint, Search, User } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/** Dispatch on window to open the search dialog from anywhere (e.g. dashboard tiles). */
export const OPEN_SEARCH_EVENT = "bdah:open-search";

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
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
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
      <Button variant="ghost" onClick={() => setOpen(true)}
        className="h-11 w-full max-w-xl justify-start gap-2.5 rounded-xl bg-muted/80 px-4 font-normal text-muted-foreground ring-1 ring-transparent hover:bg-muted hover:ring-border">
        <Search className="size-[18px]" />
        <span className="truncate">Search a pet, owner or phone number…</span>
        <kbd className="ml-auto hidden rounded-md border bg-card px-1.5 py-0.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[15%] translate-y-0 overflow-hidden rounded-2xl p-0 shadow-float sm:max-w-2xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">Search customers and pets</DialogDescription>
          {/* Matching happens in Postgres (fuzzy + phone), so cmdk's own filter is off. */}
          <CommandPrimitive shouldFilter={false} className="flex flex-col">
            <CommandInput placeholder="Type a pet name, owner name, 0300… number, or ID" value={query} onValueChange={onQueryChange} />
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
