"use client";

import { useState } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STEPS = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)", "var(--heat-5)"];

function hourLabel(h: number) {
  return h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
}

/** Busiest hours: weekday × hour, one-hue ramp (light = quiet, dark = busy). */
export function PeakHours({ cells }: { cells: { dow: number; hour: number; visits: number }[] }) {
  const [hover, setHover] = useState<{ dow: number; hour: number; visits: number } | null>(null);
  if (!cells.length) return <p className="py-6 text-center text-sm text-muted-foreground">No check-ins in this period</p>;
  const lo = Math.min(9, ...cells.map((c) => c.hour));
  const hi = Math.max(21, ...cells.map((c) => c.hour));
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const max = Math.max(...cells.map((c) => c.visits));
  const get = (d: number, h: number) => cells.find((c) => c.dow === d && c.hour === h)?.visits ?? 0;
  const step = (v: number) => (v === 0 ? 0 : Math.min(5, 1 + Math.floor(((v - 1) / Math.max(1, max)) * 5)));
  const busiest = [...cells].sort((a, b) => b.visits - a.visits)[0];

  return (
    <div className="min-w-0">
      <p className="mb-3 text-sm text-muted-foreground">
        Busiest: <b className="text-foreground">{DAYS[busiest.dow - 1]} {hourLabel(busiest.hour)}–{hourLabel((busiest.hour + 1) % 24)}</b> ({busiest.visits} check-ins)
        {hover && <span className="ml-3">· {DAYS[hover.dow - 1]} {hourLabel(hover.hour)}: <b className="text-foreground tabular">{hover.visits}</b></span>}
      </p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-[11px]" onMouseLeave={() => setHover(null)}>
          <thead>
            <tr><th />{hours.map((h) => <th key={h} className="w-7 font-normal text-muted-foreground">{h % 2 === 0 ? hourLabel(h) : ""}</th>)}</tr>
          </thead>
          <tbody>
            {DAYS.map((d, di) => (
              <tr key={d}>
                <th className="pr-2 text-left font-normal text-muted-foreground">{d}</th>
                {hours.map((h) => {
                  const v = get(di + 1, h);
                  return (
                    <td key={h} title={`${d} ${hourLabel(h)}: ${v} check-in${v === 1 ? "" : "s"}`}
                      onMouseEnter={() => setHover({ dow: di + 1, hour: h, visits: v })}
                      className="h-7 w-7 rounded-[4px] ring-brand-strong hover:ring-2" style={{ background: STEPS[step(v)] }} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        Quiet {STEPS.map((s) => <span key={s} className="size-3 rounded-[3px]" style={{ background: s }} />)} Busy
      </div>
    </div>
  );
}
