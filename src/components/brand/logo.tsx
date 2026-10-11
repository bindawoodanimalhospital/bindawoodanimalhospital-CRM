import Image from "next/image";
import { cn } from "@/lib/utils";

/*
 * The clinic's own logo artwork (supplied by BDAH), prepared as transparent PNGs in public/brand/
 * so it sits cleanly on any background. Originals: docs/brand/.
 */
const MARK = {
  white: "/brand/bdah-mark-white.png",
  ink: "/brand/bdah-mark-ink.png",
  burgundy: "/brand/bdah-mark-burgundy.png",
} as const;

export function LogoMark({ tone = "ink", className, priority }: {
  tone?: keyof typeof MARK; className?: string; priority?: boolean;
}) {
  return (
    <Image src={MARK[tone]} alt="Bin Dawood Animal Hospital" width={496} height={512} priority={priority}
      className={cn("h-auto w-8 select-none", className)} draggable={false} />
  );
}

/** Mark on a burgundy gradient tile + two-line wordmark. Used in the sidebar. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient shadow-md shadow-brand/30">
        <LogoMark tone="white" className="w-6" priority />
      </div>
      {!compact && (
        <div className="grid leading-none">
          <span className="font-heading text-[15px] font-bold tracking-tight">BIN DAWOOD</span>
          <span className="mt-1 text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground">ANIMAL HOSPITAL</span>
        </div>
      )}
    </div>
  );
}

/** Full lockup from the clinic's artwork: mark, name and "By Dr. Musab Bin Dawood". For dark backgrounds. */
export function LogoLockup({ className }: { className?: string }) {
  return (
    <Image src="/brand/bdah-lockup-white.png" alt="Bin Dawood Animal Hospital — by Dr. Musab Bin Dawood"
      width={774} height={647} priority className={cn("h-auto w-80 select-none", className)} draggable={false} />
  );
}
