"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";
import {
  Hammer,
  Library,
  FlaskConical,
  Settings,
  LayoutTemplate,
  BookOpen,
  Terminal,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

const navItems = [
  { href: "/builder", label: "Builder", icon: Hammer },
  { href: "/library", label: "Library", icon: Library },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/playground", label: "Playground", icon: FlaskConical },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/assistant", label: "Assistant", icon: Terminal },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarOpen, toggleSidebar } = useUIStore();

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-border bg-sidebar transition-all duration-200",
        sidebarOpen ? "w-56" : "w-14"
      )}
    >
      <div className="flex items-center justify-between p-3 border-b border-border">
        {sidebarOpen && (
          <Link href="/" className="font-semibold text-sm text-sidebar-foreground">
            CodeMaestro
          </Link>
        )}
        <button
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={sidebarOpen}
          className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground"
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <Icon size={18} />
              {sidebarOpen && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
