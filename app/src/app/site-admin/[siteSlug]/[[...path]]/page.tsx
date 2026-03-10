import { notFound } from "next/navigation";

import { getSiteCmsBootstrap } from "@/lib/generated-site-cms";
import { SiteAdminApp } from "@/vendor/pages-cms-fork/site-admin-app";

type PageProps = {
  params: Promise<{
    siteSlug: string;
    path?: string[];
  }>;
};

export default async function SiteAdminPage({ params }: PageProps) {
  const { siteSlug, path } = await params;
  let initialData;

  try {
    initialData = getSiteCmsBootstrap(siteSlug);
  } catch {
    notFound();
  }

  return <SiteAdminApp initialData={initialData} initialPath={path ?? []} />;
}
