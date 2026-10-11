"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Refreshes the page when ward data changes on any screen, and every minute (so "overdue" stays current). */
export function LiveRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();
  const key = tables.join(",");
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = supabase.channel(`live-${key}`);
    for (const table of key.split(",")) {
      ch.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        clearTimeout(t);
        t = setTimeout(() => router.refresh(), 300);
      });
    }
    ch.subscribe();
    const tick = setInterval(() => router.refresh(), 60_000);
    return () => { clearTimeout(t); clearInterval(tick); supabase.removeChannel(ch); };
  }, [router, key]);
  return null;
}
