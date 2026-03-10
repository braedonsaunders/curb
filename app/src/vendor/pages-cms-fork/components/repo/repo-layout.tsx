"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RepoSidebar } from "@/vendor/pages-cms-fork/components/repo/repo-sidebar";

export function RepoLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [isMenuOpen, setMenuOpen] = useState(false);

  const handleMenuClose = () => setMenuOpen(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      window.addEventListener("keydown", handleKeyDown);
    } else {
      window.removeEventListener("keydown", handleKeyDown);
    }

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen]);

  return (
    <>
      <div className="flex h-screen w-full">
        <aside className="hidden h-screen w-72 flex-col gap-y-2 border-r lg:flex">
          <RepoSidebar />
        </aside>
        <main className="relative flex h-screen flex-1 flex-col overflow-hidden">
          <div className="h-14 lg:h-0"></div>
          <div className="scrollbar flex-1 overflow-auto p-4 md:p-6">{children}</div>
        </main>
      </div>
      <div className="lg:hidden">
        <div className="fixed left-0 right-0 top-0 flex h-14 items-center border-b bg-background px-4 md:px-6">
          <Button
            variant="outline"
            size="icon"
            className="gap-x-2"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>
        <div
          className={cn(
            "fixed inset-0 z-50 invisible bg-black/80 opacity-0 transition-all duration-150",
            isMenuOpen ? "visible opacity-100" : ""
          )}
          onClick={handleMenuClose}
        ></div>
        <aside
          className={cn(
            "fixed inset-y-0 z-50 flex h-screen max-w-72 w-[calc(100vw-4rem)] -translate-x-full flex-col gap-y-2 border-r bg-background shadow-lg invisible opacity-0 transition-all duration-500 ease-in-out",
            isMenuOpen ? "visible translate-x-0 opacity-100" : ""
          )}
        >
          <RepoSidebar onClick={handleMenuClose} />
        </aside>
      </div>
    </>
  );
}
