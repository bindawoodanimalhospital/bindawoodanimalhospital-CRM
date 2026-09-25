import { CircleCheck, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SaveState } from "@/hooks/use-autosave";

export function SaveIndicator({ state, className }: { state: SaveState; className?: string }) {
  if (state === "idle") return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", state === "error" ? "text-danger" : "text-muted-foreground", className)}>
      {state === "saving" && <><Loader2 className="size-4 animate-spin" /> Saving…</>}
      {state === "saved" && <><CircleCheck className="size-4 text-success" /> Saved</>}
      {state === "error" && <><CloudOff className="size-4" /> Not saved — will retry</>}
    </span>
  );
}
