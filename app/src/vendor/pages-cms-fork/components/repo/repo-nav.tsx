"use client";

import { type ReactNode, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileStack, FileText, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { useConfig } from "@/vendor/pages-cms-fork/contexts/config-context";

const RepoNavItem = ({
  children,
  href,
  icon,
  active,
  onClick,
}: {
  children: ReactNode;
  href: string;
  icon: ReactNode;
  active: boolean;
  onClick?: () => void;
}) => (
  <Link
    className={cn(
      active ? "bg-accent" : "hover:bg-accent",
      "flex items-center rounded-lg px-3 py-2 font-medium outline-none focus:bg-accent"
    )}
    href={href}
    onClick={onClick}
    prefetch
  >
    {icon}
    <span className="truncate">{children}</span>
  </Link>
);

const RepoNav = ({
  onClick,
}: {
  onClick?: () => void;
}) => {
  const { config } = useConfig();
  const pathname = usePathname();

  const items = useMemo(() => {
    if (!config || !config.object) {
      return [];
    }

    const configObject = config.object;
    const contentItems =
      configObject.content?.map((item) => ({
        key: item.name,
        icon:
          item.type === "file" ? (
            <FileText className="mr-2 h-5 w-5" />
          ) : (
            <FileStack className="mr-2 h-5 w-5" />
          ),
        href: item.href,
        label: item.label || item.name,
      })) || [];

    const settingsItem = !configObject.settings?.hide
      ? {
          key: "settings",
          icon: <Settings className="mr-2 h-5 w-5" />,
          href: configObject.settings?.href || "#",
          label: configObject.settings?.label || "Settings",
        }
      : null;

    return [...contentItems, settingsItem].filter(Boolean);
  }, [config]);

  if (!items.length) {
    return null;
  }

  return (
    <>
      {items.map((item) => (
        <RepoNavItem
          key={item.key}
          href={item.href}
          icon={item.icon}
          active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
          onClick={onClick}
        >
          {item.label}
        </RepoNavItem>
      ))}
    </>
  );
};

export { RepoNav };
