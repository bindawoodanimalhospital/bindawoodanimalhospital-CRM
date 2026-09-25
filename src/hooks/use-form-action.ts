"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { toast } from "sonner";
import type { FormState } from "@/lib/validation";

/**
 * useActionState wrapper that submits via onSubmit instead of `<form action>`, so React
 * doesn't reset the form when the server returns validation errors.
 */
export function useFormAction(
  action: (prev: FormState, fd: FormData) => Promise<FormState>,
  { onSuccess }: { onSuccess?: (state: FormState) => void } = {},
) {
  const [state, dispatch, pending] = useActionState(action, {});
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; });

  useEffect(() => {
    if (state.message && !state.ok) toast.error(state.message);
    if (state.message && state.ok) toast.success(state.message);
    if (state.ok) onSuccessRef.current?.(state);
  }, [state]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return; // no double submits
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };

  return { state, pending, onSubmit, errors: state.errors ?? {} };
}
