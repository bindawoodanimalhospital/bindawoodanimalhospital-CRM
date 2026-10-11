"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Records every page a staff member opens and every print, for the owner's activity log.
 * Fire-and-forget: never blocks or breaks the page. The database ignores repeats of the
 * same page by the same person within 30 seconds.
 */
export function ActivityTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const path = search ? `${pathname}?${search}` : pathname;
    // Wait a moment so document.title is the new page's title.
    const t = setTimeout(() => {
      createClient().rpc("log_activity", { p_kind: "view", p_path: path, p_title: document.title }).then(() => {}, () => {});
    }, 700);
    return () => clearTimeout(t);
  }, [pathname, search]);

  useEffect(() => {
    const onPrint = () => {
      createClient().rpc("log_activity", { p_kind: "print", p_path: location.pathname + location.search, p_title: document.title }).then(() => {}, () => {});
    };
    window.addEventListener("beforeprint", onPrint);
    return () => window.removeEventListener("beforeprint", onPrint);
  }, []);

  return null;
}
