"use client";

import { usePathname } from "next/navigation";

import { Toaster } from "@/components/ui/sonner";
import { Sidebar } from "@/app/sidebar";

function isStandaloneSiteAdmin(pathname: string | null): boolean {
  if (!pathname) {
    return false;
  }

  return (
    /^\/sites\/[^/]+\/admin(?:\/.*)?$/.test(pathname) ||
    /^\/purchase\/[^/]+(?:\/.*)?$/.test(pathname)
  );
}

export function AppFrame({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const standaloneSiteAdmin = isStandaloneSiteAdmin(pathname);

  if (standaloneSiteAdmin) {
    return (
      <>
        <main className="min-h-screen bg-background">{children}</main>
        <Toaster position="bottom-right" richColors />
      </>
    );
  }

  return (
    <>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
        </main>
      </div>
      <Toaster position="bottom-right" richColors />
    </>
  );
}
