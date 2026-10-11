"use client";

import { useEffect, useState } from "react";
import { TIMEZONE } from "@/lib/format";

/** Hour (0–23) in Pakistan right now, whatever the computer's own time zone is. */
function pkHour(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TIMEZONE }).formatToParts(d);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

/** Morning 4:00–11:59 · afternoon 12:00–16:59 · evening 17:00–3:59 (Pakistan time). */
export function greetingFor(d: Date) {
  const h = pkHour(d);
  return h >= 4 && h < 12 ? "Good morning" : h >= 12 && h < 17 ? "Good afternoon" : "Good evening";
}

export function pkDateLine(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE }).format(d);
}

/**
 * "Good evening, Dr. Musab" + today's date, always in Pakistan time, and kept current while the page
 * stays open (a dashboard left open over lunch switches from morning to afternoon on its own).
 * The server renders the first value so there's no flash; the client re-checks every 30 seconds.
 */
export function Greeting({ name, initial }: { name: string; initial: string }) {
  const [now, setNow] = useState<Date>(() => new Date(initial));
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <p className="text-sm font-medium text-white/60" suppressHydrationWarning>{pkDateLine(now)}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl" suppressHydrationWarning>{greetingFor(now)}, {name}</h1>
    </>
  );
}
