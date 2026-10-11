"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type TrendSeries = { name: string; color: string };
export type TrendPoint = { label: string; longLabel: string; values: number[] };

const compact = new Intl.NumberFormat("en-PK", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

function niceMax(v: number) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = [1, 2, 2.5, 5, 10].find((m) => m * p >= v)! * p;
  return n;
}

/**
 * Time-series chart. "line" for money trends (one or two series, one shared axis — never two),
 * "bar" for counts. Crosshair + tooltip on hover/touch; a plain table sits under it for screen
 * readers and anyone who prefers numbers.
 */
export function TrendChart({ series, points, kind = "line", money = false, height = 240, className }: {
  series: TrendSeries[]; points: TrendPoint[]; kind?: "line" | "bar"; money?: boolean; height?: number; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fmt = (n: number) => (money ? `Rs. ${full.format(n)}` : full.format(n));
  const pad = { l: 48, r: 12, t: 12, b: 28 };
  const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...points.flatMap((p) => p.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const n = points.length;
  const band = iw / Math.max(n, 1);
  const x = (i: number) => pad.l + band * i + band / 2;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(n / Math.floor(iw / 64)));
  const barW = Math.min(24, Math.max(3, band - 2));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - pad.l) / band);
    setHover(i >= 0 && i < n ? i : null);
  }

  const h = hover != null ? points[hover] : null;
  return (
    <div className={cn("min-w-0", className)}>
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-2">
              <span className="h-0.5 w-4 rounded-full" style={{ background: s.color, height: 3 }} aria-hidden /> {s.name}
            </li>
          ))}
        </ul>
      )}
      <div ref={box} className="relative w-full">
        <svg width={w} height={height} role="img" aria-label={`${series.map((s) => s.name).join(" and ")} over time`}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-pan-y select-none">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular">{compact.format(t)}</text>
            </g>
          ))}
          {points.map((p, i) => (i % every === 0 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">{p.label}</text>
          ) : null))}
          {hover != null && <rect x={pad.l + band * hover} y={pad.t} width={band} height={ih} className="fill-muted/60" />}
          {kind === "bar"
            ? points.map((p, i) => {
                const v = p.values[0] ?? 0, top = y(v), hgt = pad.t + ih - top;
                if (v <= 0) return null;
                const r = Math.min(4, hgt, barW / 2);
                const bx = x(i) - barW / 2;
                return <path key={i} fill={series[0].color} opacity={hover == null || hover === i ? 1 : 0.55}
                  d={`M${bx},${pad.t + ih} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${pad.t + ih} Z`} />;
              })
            : series.map((s, si) => (
                <g key={s.name}>
                  <path d={points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.values[si] ?? 0)}`).join(" ")}
                    fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {n === 1 && <circle cx={x(0)} cy={y(points[0].values[si] ?? 0)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />}
                </g>
              ))}
          {hover != null && kind === "line" && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--viz-axis)" strokeWidth={1} />
              {series.map((s, si) => (
                <circle key={s.name} cx={x(hover)} cy={y(points[hover].values[si] ?? 0)} r={4.5} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              ))}
            </>
          )}
        </svg>
        {h && hover != null && (
          <div className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-xl bg-popover px-3 py-2 text-sm shadow-float ring-1 ring-border"
            style={x(hover) > w / 2 ? { right: w - x(hover) + 12 } : { left: x(hover) + 12 }}>
            <p className="mb-1 font-semibold">{h.longLabel}</p>
            {series.map((s, si) => (
              <p key={s.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />{s.name}
                </span>
                <span className="font-semibold tabular">{fmt(h.values[si] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">See as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-xl ring-1 ring-border">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-surface text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">Period</th>{series.map((s) => <th key={s.name} className="px-3 py-2 text-right font-medium">{s.name}</th>)}</tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.longLabel} className="border-t">
                  <td className="px-3 py-1.5">{p.longLabel}</td>
                  {p.values.map((v, i) => <td key={i} className="px-3 py-1.5 text-right tabular">{fmt(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
