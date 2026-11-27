"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Ask = { title: string; description?: string; confirm?: string; cancel?: string; danger?: boolean };

/**
 * The app's own confirmation box (instead of the browser's "localhost says…" pop-up).
 * `const [ask, confirmBox] = useConfirm();` — render `{confirmBox}` once, then `if (!(await ask({ title: "…" }))) return;`.
 */
export function useConfirm(): [(q: Ask) => Promise<boolean>, React.ReactNode] {
  const [q, setQ] = useState<Ask | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback((next: Ask) => new Promise<boolean>((resolve) => { resolver.current = resolve; setQ(next); }), []);
  const done = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setQ(null); };
  const box = (
    <AlertDialog open={!!q} onOpenChange={(o) => { if (!o) done(false); }}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{q?.title}</AlertDialogTitle>
          {q?.description && <AlertDialogDescription>{q.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => done(false)}>{q?.cancel ?? "Not now"}</AlertDialogCancel>
          <AlertDialogAction onClick={() => done(true)}
            className={q?.danger ? "bg-danger bg-none text-white shadow-none hover:bg-danger/90" : undefined}>{q?.confirm ?? "Yes"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return [ask, box];
}
