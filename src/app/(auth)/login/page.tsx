import type { Metadata } from "next";
import { Logo, LogoLockup } from "@/components/brand/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-svh bg-card lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel — matches the clinic's black signage */}
      <section className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:items-center lg:justify-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_20%,oklch(0.42_0.135_12/0.55),transparent_70%),radial-gradient(50%_45%_at_85%_90%,oklch(0.42_0.135_12/0.35),transparent_70%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] bg-[size:48px_48px] opacity-[0.035]" />
        <LogoLockup className="relative" />
        <p className="absolute bottom-8 left-0 right-0 text-center text-xs tracking-wide text-white/50">
          Lahore · Caring for pets, one visit at a time
        </p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 mb-8 text-muted-foreground">Sign in with the account the hospital admin gave you.</p>
          <LoginForm next={typeof next === "string" ? next : undefined} />
          <p className="mt-8 text-sm text-muted-foreground">
            Forgot your password? Ask the hospital admin to reset it.
          </p>
        </div>
      </section>
    </main>
  );
}
