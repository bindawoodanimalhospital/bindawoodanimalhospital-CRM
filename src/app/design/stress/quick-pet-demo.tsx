"use client";

import { QuickPetForm } from "@/app/(app)/appointments/pet-picker";

/** Dev-only wrapper so the server stress page can show the quick pet form. */
export function QuickPetDemo() {
  return <QuickPetForm customerId="c" onCreated={() => undefined} />;
}
