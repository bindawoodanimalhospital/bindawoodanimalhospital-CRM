"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, LogOut } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/brand/logo";
import { initials } from "@/lib/format";
import { signOut } from "@/app/(auth)/login/actions";
import { NAV } from "./nav";

type Props = {
  permissions: string[];
  user: { name: string; email: string | null; roles: string[] };
};

export function AppSidebar({ permissions, user }: Props) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const perms = new Set(permissions);
  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.anyOf || i.anyOf.some((p) => perms.has(p))),
  })).filter((g) => g.items.length);

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="px-2 pt-3 pb-4">
        <Link href="/dashboard" className="rounded-xl outline-none" onClick={() => setOpenMobile(false)}>
          <Logo className="group-data-[collapsible=icon]:[&>div:last-child]:hidden" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group, i) => (
          <SidebarGroup key={group.label ?? i}>
            {group.label && <SidebarGroupLabel className="text-[11px] tracking-wider uppercase">{group.label}</SidebarGroupLabel>}
            <SidebarMenu className="gap-1">
              {group.items.map((item) => {
                const active = (pathname === item.href || pathname.startsWith(`${item.href}/`))
                  && !groups.some((g) => g.items.some((o) => o.href !== item.href && o.href.startsWith(item.href) && pathname.startsWith(o.href)));
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link href={item.href} onClick={() => setOpenMobile(false)}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="size-9 rounded-xl">
                    <AvatarFallback className="rounded-xl bg-ink text-xs font-semibold text-white">{initials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-semibold">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.roles.join(" + ") || "No role"}</span>
                  </div>
                  <ChevronsUpDown className="text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-60 rounded-xl">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-semibold">{user.name}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => signOut()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
