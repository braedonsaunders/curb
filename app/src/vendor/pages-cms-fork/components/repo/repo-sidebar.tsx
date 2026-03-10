"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useConfig } from "@/vendor/pages-cms-fork/contexts/config-context";
import { RepoNav } from "@/vendor/pages-cms-fork/components/repo/repo-nav";

const RepoSidebar = ({
  onClick,
}: {
  onClick?: () => void;
}) => {
  const { config } = useConfig();
  const site = config?.object.site;

  return (
    <>
      <header className="flex items-center border-b px-3 py-2">
        <Link
          className={buttonVariants({ variant: "ghost", size: "xs" })}
          href="/sites"
          prefetch
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          All sites
        </Link>
      </header>
      <div className="px-3 pt-1">
        <Button variant="outline" className="h-15 w-full justify-start px-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-sm font-semibold">
            {(site?.name || "S").slice(0, 1).toUpperCase()}
          </div>
          <div className="ml-3 overflow-hidden text-left">
            <div className="truncate font-medium">{site?.name || "Site"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {site?.slug || "admin"}
            </div>
          </div>
        </Button>
      </div>
      <nav className="flex flex-col gap-y-1 overflow-auto px-3">
        <RepoNav onClick={onClick} />
      </nav>
      <footer className="mt-auto flex items-center gap-x-2 border-t px-3 py-2">
        {site ? (
          <a
            className={buttonVariants({ variant: "ghost", size: "xs" })}
            href={site.siteHref}
            target="_blank"
            rel="noreferrer"
            onClick={onClick}
          >
            View site
            <ArrowUpRight className="ml-1.5 h-3 w-3" />
          </a>
        ) : null}
      </footer>
    </>
  );
};

export { RepoSidebar };
