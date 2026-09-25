"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus
          defaultValue={state.email} className="h-12 text-base" placeholder="name@example.com" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password"
            required className="h-12 pr-12 text-base" />
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground hover:text-foreground">
            {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
      </div>
      {state.error && (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger" role="alert">{state.error}</p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="mt-1">
        {pending ? <Loader2 className="animate-spin" /> : null} Sign in {!pending && <ArrowRight />}
      </Button>
    </form>
  );
}
