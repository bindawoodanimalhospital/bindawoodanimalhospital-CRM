"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Note = { id: string; title: string; body: string | null; severity: string; link: string | null; created_at: string; read_at: string | null };

/** Personal inbox: reminders, escalations and new tasks for the signed-in person. Updates live. */
export function NotificationBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    const { data } = await createClient().from("notifications").select("id, title, body, severity, link, created_at, read_at")
      .order("created_at", { ascending: false }).limit(30);
    setItems((data ?? []) as Note[]);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const first = setTimeout(load, 0);
    const ch = supabase.channel(`inbox-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `staff_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => { clearTimeout(first); supabase.removeChannel(ch); };
  }, [load, userId]);

  const unread = items.filter((i) => !i.read_at).length;
  const markAll = async () => {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (!ids.length) return;
    await createClient().from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    load();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unread} unread)`}>
          <Bell />
          {unread > 0 && <span className="absolute top-1 right-1 flex min-w-4.5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] rounded-2xl p-0">
        <div className="flex items-center border-b px-4 py-3">
          <p className="font-semibold">Notifications</p>
          {unread > 0 && <Button variant="ghost" size="sm" className="ml-auto" onClick={markAll}><CheckCheck /> Mark all read</Button>}
        </div>
        <ul className="max-h-[60vh] overflow-auto">
          {items.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nothing yet.</li>}
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? "/alerts"} onClick={async () => { setOpen(false); if (!n.read_at) { await createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id); load(); } }}
                className={cn("flex gap-3 border-b px-4 py-3 last:border-0 hover:bg-muted/60", !n.read_at && "bg-brand-soft/60")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.severity === "critical" ? "bg-danger" : n.severity === "warning" ? "bg-warning" : "bg-info")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{n.title}</span>
                  {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="block text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/alerts" onClick={() => setOpen(false)} className="block border-t px-4 py-3 text-center text-sm font-semibold text-brand hover:bg-muted/60">Open alert centre</Link>
      </PopoverContent>
    </Popover>
  );
}
