"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FormState } from "@/lib/validation";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Debounced partial-save for long forms (consultations, surgery notes).
 * Unsaved changes are kept and retried with the next edit; closing the tab mid-save warns the user.
 */
export function useAutosave<T extends object>(save: (patch: Partial<T>) => Promise<FormState>, delay = 900) {
  const [state, setState] = useState<SaveState>("idle");
  const pending = useRef<Partial<T>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return true;
    pending.current = {};
    setState("saving");
    const res = await saveRef.current(patch);
    if (!res.ok) {
      pending.current = { ...patch, ...pending.current };
      setState("error");
      toast.error(res.message ?? "Couldn't save — check your connection.");
      return false;
    }
    setState("saved");
    return true;
  }, []);

  const queue = useCallback((patch: Partial<T>) => {
    pending.current = { ...pending.current, ...patch };
    setState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  }, [delay, flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); clearTimeout(timer.current); };
  }, []);

  return { state, queue, flush };
}
