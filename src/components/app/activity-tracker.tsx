"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Kind = "view" | "print" | "call" | "whatsapp" | "email" | "download" | "external" | "copy" | "search" | "idle" | "active" | "closed" | "denied";

const here = () => location.pathname + location.search;
const cleanTitle = () => document.title.replace(/\s*·\s*Bin Dawood Animal Hospital$/, "");

/** Report one thing the staff member did. Fire-and-forget: never blocks or breaks the page. */
export function logActivity(kind: Kind, context?: Record<string, unknown>, path = here()) {
  createClient().rpc("log_activity", { p_kind: kind, p_path: path, p_title: document.title, p_context: context ?? undefined })
    .then(() => {}, () => {});
}

const IDLE_MS = 10 * 60_000;

/**
 * Records, for the owner's activity log, what each staff member does in the CRM:
 * pages opened, prints, phone / WhatsApp / email taps, downloads, outside links, copying,
 * going idle and coming back, closing the tab, and pages they weren't allowed into.
 * The database ignores repeats of the same page within 30 seconds.
 */
export function ActivityTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // Pages opened (after a moment, so document.title belongs to the new page).
  useEffect(() => {
    const path = search ? `${pathname}?${search}` : pathname;
    const t = setTimeout(() => {
      logActivity("view", undefined, path);
      const denied = new URLSearchParams(search).get("denied");
      if (denied) logActivity("denied", { permission: denied === "1" ? null : denied, from: document.referrer ? new URL(document.referrer).pathname : null }, path);
    }, 700);
    return () => clearTimeout(t);
  }, [pathname, search]);

  useEffect(() => {
    // Prints (Ctrl+P or the print buttons).
    const onPrint = () => logActivity("print");

    // Taps on phone numbers, WhatsApp, email, downloads and outside websites.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      const label = (a.textContent ?? "").trim().slice(0, 80) || a.getAttribute("title") || a.getAttribute("aria-label");
      if (href.startsWith("tel:")) return logActivity("call", { to: href.slice(4), label });
      if (href.startsWith("mailto:")) return logActivity("email", { to: href.slice(7).split("?")[0], label });
      if (/wa\.me\/|api\.whatsapp\.com|^whatsapp:/.test(href)) {
        const to = href.match(/wa\.me\/(\d+)/)?.[1] ?? new URL(href, location.href).searchParams.get("phone");
        return logActivity("whatsapp", { to, label });
      }
      if (a.hasAttribute("download")) return logActivity("download", { file: a.getAttribute("download") || href, label });
      try {
        const url = new URL(href, location.href);
        if (url.origin !== location.origin && /^https?:/.test(url.protocol)) logActivity("external", { url: url.href.slice(0, 200), label });
      } catch { /* not a URL */ }
    };

    // Copying text off a page (how much, not what).
    const onCopy = () => {
      const chars = String(window.getSelection() ?? "").length;
      if (chars > 0) logActivity("copy", { chars });
    };

    // Idle: nothing touched for 10 minutes → "went away"; the next touch → "came back after N min".
    let last = Date.now();
    let idleSince: number | null = null;
    const touch = () => {
      const now = Date.now();
      if (idleSince) {
        logActivity("active", { away_minutes: Math.round((now - idleSince) / 60_000) + 10 });
        idleSince = null;
      }
      last = now;
    };
    const tick = setInterval(() => {
      if (!idleSince && Date.now() - last >= IDLE_MS) { idleSince = Date.now(); logActivity("idle"); }
    }, 30_000);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

    // Tab closed or refreshed: sendBeacon survives the page unloading.
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      try {
        navigator.sendBeacon("/api/activity", new Blob([JSON.stringify({ kind: "closed", path: here(), title: cleanTitle() })], { type: "application/json" }));
      } catch { /* ignore */ }
    };

    window.addEventListener("beforeprint", onPrint);
    document.addEventListener("click", onClick, true);
    document.addEventListener("copy", onCopy);
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("beforeprint", onPrint);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("copy", onCopy);
      events.forEach((ev) => window.removeEventListener(ev, touch));
      window.removeEventListener("pagehide", onHide);
      clearInterval(tick);
    };
  }, []);

  return null;
}
