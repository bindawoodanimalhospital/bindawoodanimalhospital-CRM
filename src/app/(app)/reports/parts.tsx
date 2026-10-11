import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PRESETS, type PresetKey } from "@/lib/reports";
import { cn } from "@/lib/utils";

const full = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/** Headline number with a one-line plain explanation of exactly what it counts. */
export function StatTile({ label, value, money, explain, delta, upIsGood = true, tone, hero, suffix }: {
  label: string; value: number | null; money?: boolean; explain: string; delta?: number | null; upIsGood?: boolean;
  tone?: "danger" | "warning" | "brand"; hero?: boolean; suffix?: string;
}) {
  const good = delta != null && (delta >= 0) === upIsGood;
  return (
    <div className={cn("rounded-2xl p-5 ring-1", hero ? "bg-ink bg-hero-gradient text-white ring-transparent shadow-float shadow-brand/20" : "bg-card shadow-card ring-border")}>
      <p className={cn("text-sm font-medium", hero ? "text-white/70" : "text-muted-foreground")}>{label}</p>
      <p className={cn("mt-1.5 font-bold tracking-tight", hero ? "text-4xl" : "text-3xl",
        !hero && tone === "danger" && "text-danger", !hero && tone === "warning" && "text-warning", !hero && tone === "brand" && "text-brand")}>
        {value == null ? "—" : `${money ? "Rs. " : ""}${full.format(value)}${suffix ?? ""}`}
      </p>
      {delta != null && (
        <p className={cn("mt-1 inline-flex items-center gap-0.5 text-xs font-semibold",
          hero ? "text-white/80" : good ? "text-success" : "text-danger")}>
          {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {Math.abs(delta)}% vs previous period
        </p>
      )}
      <p className={cn("mt-2 text-xs leading-relaxed", hero ? "text-white/60" : "text-muted-foreground")}>{explain}</p>
    </div>
  );
}

export function Panel({ title, note, children, className, action }: {
  title: string; note?: string; children: React.ReactNode; className?: string; action?: React.ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-surface px-3 py-2 text-xs text-muted-foreground ring-1 ring-border">
      <Info className="mt-0.5 size-3.5 shrink-0" /> <span>{children}</span>
    </p>
  );
}

/** Presets + custom range, all in one row above the report. Plain GET links/form — bookmarkable. */
export function RangeBar({ tab, preset, from, to }: { tab: string; preset: PresetKey | null; from: string; to: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <Link key={p.key} href={`?tab=${tab}&range=${p.key}`}
          className={cn("inline-flex h-9 items-center rounded-xl px-3.5 text-sm font-medium ring-1 transition",
            preset === p.key ? "bg-ink text-white ring-transparent" : "bg-card ring-border hover:ring-brand-muted")}>
          {p.label}
        </Link>
      ))}
      <form className="flex flex-wrap items-center gap-2" action="/reports">
        <input type="hidden" name="tab" value={tab} />
        <Input type="date" name="from" defaultValue={from} className="h-9 w-auto" aria-label="From" />
        <span className="text-sm text-muted-foreground">to</span>
        <Input type="date" name="to" defaultValue={to} className="h-9 w-auto" aria-label="To" />
        <Button type="submit" variant="outline" size="sm" className="h-9">Show</Button>
      </form>
    </div>
  );
}

export type ExportOption = { dataset: string; label: string };

export function ExportMenu({ options, from, to }: { options: ExportOption[]; from: string; to: string }) {
  if (!options.length) return null;
  const href = (d: string, f: string) => `/reports/export?dataset=${d}&from=${from}&to=${to}&format=${f}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" size="lg"><Download /> Export</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-xl">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">For the dates shown · every export is recorded in the history log</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuItem key={o.dataset} asChild className="flex items-center justify-between gap-3">
            <div>
              <span>{o.label}</span>
              <span className="flex gap-1">
                <a href={href(o.dataset, "xlsx")} className="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand hover:bg-brand-muted">Excel</a>
                <a href={href(o.dataset, "csv")} className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold hover:bg-border">CSV</a>
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
