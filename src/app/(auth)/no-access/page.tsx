import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { getCurrentStaff } from "@/lib/auth";
import { signOut } from "../login/actions";

export default async function NoAccessPage() {
  const me = await getCurrentStaff();
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <Logo className="mb-8 justify-center" />
        <div className="rounded-3xl bg-card p-10 shadow-float ring-1 ring-border">
          <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning"><ShieldAlert className="size-7" /></span>
          <h1 className="text-lg font-semibold">Your account isn&apos;t active yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {me?.email ? <>Signed in as <b>{me.email}</b>. </> : null}
            Ask the hospital admin to activate your account and assign your role.
          </p>
          <form action={signOut} className="mt-6">
            <Button variant="outline" type="submit">Sign out</Button>
          </form>
        </div>
      </div>
    </main>
  );
}
