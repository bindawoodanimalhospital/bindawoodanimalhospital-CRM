import { cn } from "@/lib/utils";

/** The BDAH mark (paw toes over a heart with a cross). Inherits colour from `currentColor`. */
export function LogoMark({ className, strokeWidth = 5.5 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
      strokeLinejoin="round" className={cn("size-8", className)} aria-hidden="true">
      <circle cx="26" cy="30" r="12.5" />
      <circle cx="60" cy="19" r="14.5" />
      <circle cx="94" cy="30" r="12.5" />
      <path d="M60 59.5C54 51 44.5 47.5 36 49.5C23.5 52.5 18 65 22.5 78C25.5 86.5 33 93.5 41 100.5L55 112.5C58 115 62 115 65 112.5L79 100.5C87 93.5 94.5 86.5 97.5 78C102 65 96.5 52.5 84 49.5C75.5 47.5 66 51 60 59.5Z" />
      <path d="M52 72.5H59.5V79.5H66.5V87H59.5V94H52V87H45V79.5H52Z" />
      <path d="M80 58C88 59.5 92.5 67 90.5 75C89.8 77.6 88.6 80 87 82" />
      <circle cx="81" cy="91" r="1" fill="currentColor" />
    </svg>
  );
}

/** Mark in a burgundy tile + two-line wordmark. Used in the sidebar. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-sm shadow-brand/30">
        <LogoMark className="size-6" strokeWidth={7} />
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

/** Full centred lockup, as on the clinic's signage. For dark backgrounds pass text-white. */
export function LogoLockup({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <LogoMark className="size-24" strokeWidth={4.5} />
      <p className="mt-6 font-heading text-4xl leading-none font-bold tracking-tight">BIN DAWOOD</p>
      <p className="mt-2 font-heading text-xl leading-none font-bold tracking-[0.06em]">ANIMAL HOSPITAL</p>
      <p className="mt-4 text-sm tracking-[0.08em] opacity-80">BY DR. MUSAB BIN DAWOOD</p>
    </div>
  );
}
