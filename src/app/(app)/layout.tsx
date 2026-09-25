import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app/app-sidebar";
import { GlobalSearch } from "@/components/app/global-search";
import { requireStaff } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireStaff();
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar
        permissions={[...me.permissions]}
        user={{ name: me.fullName, email: me.email, roles: me.roles.map((r) => r.name) }}
      />
      <SidebarInset className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-5!" />
          <GlobalSearch />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
