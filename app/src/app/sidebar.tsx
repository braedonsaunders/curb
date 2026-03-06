"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Search,
  Building2,
  Globe,
  Mail,
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Search },
  { href: "/businesses", label: "Businesses", icon: Building2 },
  { href: "/sites", label: "Sites", icon: Globe },
  { href: "/outreach", label: "Outreach", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border/40 bg-zinc-950 text-zinc-300">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-white font-bold text-zinc-950 text-sm">
          C
        </div>
        <span className="text-lg font-semibold tracking-tight text-white">
          Curb
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-4">
        <p className="text-xs text-zinc-500">Curb v0.1.0</p>
      </div>
    </aside>
  );
}
