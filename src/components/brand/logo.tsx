import { PawPrint } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
        <PawPrint className="size-4.5" />
      </div>
      {!compact && (
        <div className="grid leading-tight">
          <span className="text-sm font-semibold tracking-tight">Bin Dawood</span>
          <span className="text-[11px] text-muted-foreground">Animal Hospital</span>
        </div>
      )}
    </div>
  );
}
