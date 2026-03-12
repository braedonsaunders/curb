import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { getSiteCmsBootstrap } from "@/lib/generated-site-cms";
import {
  SITE_ADMIN_SESSION_COOKIE,
  resolveSiteAdminAccess,
} from "@/lib/site-admin-access";
import { SITE_ADMIN_PREVIEW_QUERY_PARAM } from "@/lib/site-admin-session";
import { SiteAdminApp } from "@/vendor/pages-cms-fork/site-admin-app";

type PageProps = {
  params: Promise<{
    siteSlug: string;
    path?: string[];
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSearchParamValue(
  value: string | string[] | undefined
): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }

  return typeof value === "string" ? value : null;
}

export default async function SiteAdminPage({
  params,
  searchParams,
}: PageProps) {
  const { siteSlug, path } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const headerStore = await headers();
  const cookieStore = await cookies();
  const previewAccessToken = getSearchParamValue(
    resolvedSearchParams[SITE_ADMIN_PREVIEW_QUERY_PARAM]
  );
  const access = resolveSiteAdminAccess({
    siteSlug,
    host: headerStore.get("host"),
    previewAccessToken,
    sessionCookieValue:
      cookieStore.get(SITE_ADMIN_SESSION_COOKIE)?.value ?? null,
  });
  let initialData;

  if (!access.allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Site Admin
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            Admin access required
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Open this site through the dedicated admin preview URL, or use the
            local preview host when working inside Curb.
          </p>
        </div>
      </main>
    );
  }

  try {
    initialData = getSiteCmsBootstrap(siteSlug);
  } catch {
    notFound();
  }

  return (
    <SiteAdminApp
      initialData={initialData}
      initialPath={path ?? []}
      previewAccessToken={previewAccessToken}
      previewAccessSessionValue={access.sessionValue}
    />
  );
}
