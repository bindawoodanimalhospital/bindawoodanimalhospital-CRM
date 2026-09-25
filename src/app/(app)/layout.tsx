import { cookies } from "next/headers";
import Link from "next/link";
import { PawPrint, Plus, UserPlus } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppSidebar } from "@/components/app/app-sidebar";
import { GlobalSearch } from "@/components/app/global-search";
import { requireStaff } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireStaff();
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const canCreate = me.can("customers.create") || me.can("pets.create");

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar
        permissions={[...me.permissions]}
        user={{ name: me.fullName, email: me.email, roles: me.roles.map((r) => r.name) }}
      />
      <SidebarInset className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 rounded-t-2xl border-b bg-card/85 px-4 backdrop-blur-md md:px-6">
          <SidebarTrigger className="-ml-1 size-9" />
          <div className="min-w-0 flex-1"><GlobalSearch /></div>
          {canCreate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button><Plus /> <span className="hidden sm:inline">New</span></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl">
                {me.can("customers.create") && (
                  <DropdownMenuItem asChild className="py-2">
                    <Link href="/customers/new"><UserPlus /> New pet owner + pet</Link>
                  </DropdownMenuItem>
                )}
                {me.can("pets.create") && (
                  <DropdownMenuItem asChild className="py-2">
                    <Link href="/pets/new"><PawPrint /> Add pet to an owner</Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
