"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Message({
  title,
  description,
  href,
  cta,
  className,
  children,
}: {
  title: string;
  description: ReactNode;
  href?: string;
  cta?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-center p-4 md:p-6", className)}>
      <div className="max-w-[340px] text-center">
        <h1 className="mb-2 text-xl font-semibold tracking-tight lg:text-2xl">
          {title}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">{description}</p>
        {children
          ? children
          : href && cta
            ? (
                <Link
                  className={buttonVariants({ variant: "default", size: "sm" })}
                  href={href}
                >
                  {cta}
                </Link>
              )
            : null}
      </div>
    </div>
  );
}
