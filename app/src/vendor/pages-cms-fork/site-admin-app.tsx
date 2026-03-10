"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ChevronLeft, ExternalLink, Plus, Search } from "lucide-react";

import { SiteFileEditor } from "@/components/site-file-editor";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  SiteCmsBootstrap,
  SiteCmsFieldValue,
  SiteCmsPageRecord,
  SiteCmsProductRecord,
  SiteCmsSettings,
} from "@/lib/generated-site-cms";
import { CollectionTable, type TableData } from "@/vendor/pages-cms-fork/components/collection/collection-table";
import { Message } from "@/vendor/pages-cms-fork/components/message";
import { RepoLayout } from "@/vendor/pages-cms-fork/components/repo/repo-layout";
import { ConfigProvider } from "@/vendor/pages-cms-fork/contexts/config-context";
import { RepoProvider } from "@/vendor/pages-cms-fork/contexts/repo-context";
import type { ForkConfig } from "@/vendor/pages-cms-fork/types/config";
import type { Repo } from "@/vendor/pages-cms-fork/types/repo";

type SiteAdminAppProps = {
  initialData: SiteCmsBootstrap;
  initialPath: string[];
};

type AdminRoute =
  | {
      section: "content";
      pageKey?: string;
    }
  | {
      section: "files";
    }
  | {
      section: "products";
      productId?: string;
    }
  | {
      section: "settings";
    };

type StatusState = {
  tone: "default" | "error";
  message: string;
} | null;

type PageRow = TableData & {
  pageKey: string;
  title: string;
  fieldCount: number;
};

type ProductRow = TableData & {
  productId: string;
  title: string;
  priceLabel: string;
  checkoutState: string;
  position: number;
};

function decodePathSegment(segment: string | undefined): string | undefined {
  if (!segment) {
    return undefined;
  }

  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizeRoute(path: string[] | undefined): AdminRoute {
  const [sectionRaw, entryRaw] = path ?? [];
  const section = decodePathSegment(sectionRaw);
  const entry = decodePathSegment(entryRaw);

  if (section === "products") {
    return {
      section: "products",
      productId: entry,
    };
  }

  if (section === "files") {
    return { section: "files" };
  }

  if (section === "settings") {
    return { section: "settings" };
  }

  return {
    section: "content",
    pageKey: entry,
  };
}

function buildPageDraft(
  page: SiteCmsPageRecord | null
): Record<string, SiteCmsFieldValue> {
  if (!page) {
    return {};
  }

  return page.fields.reduce<Record<string, SiteCmsFieldValue>>((draft, field) => {
    draft[field.key] = field.currentValue;
    return draft;
  }, {});
}

function sortProducts(products: SiteCmsProductRecord[]): SiteCmsProductRecord[] {
  return [...products].sort((left, right) => left.position - right.position);
}

function makeProductId(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base || `product-${Date.now().toString(36)}`;
}

function makeUniqueProductId(
  title: string,
  products: SiteCmsProductRecord[],
  existingId?: string
): string {
  const baseId = existingId || makeProductId(title);
  let candidate = baseId;
  let suffix = 2;

  while (
    products.some(
      (product) => product.id === candidate && product.id !== existingId
    )
  ) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function buildProductDraft(
  product: SiteCmsProductRecord | null,
  products: SiteCmsProductRecord[]
): SiteCmsProductRecord {
  const nextPosition =
    products.reduce((highest, entry) => Math.max(highest, entry.position), 0) + 1;

  return {
    id: product?.id || "",
    title: product?.title || "",
    priceLabel: product?.priceLabel || "",
    position: product?.position || nextPosition,
    description: product?.description || "",
    imageUrl: product?.imageUrl || "",
    imageAlt: product?.imageAlt || "",
    actionLabel: product?.actionLabel || "Buy now",
    checkoutUrl: product?.checkoutUrl || "",
  };
}

function buildSiteAdminHref(siteSlug: string, suffix?: string): string {
  const base = `/sites/${encodeURIComponent(siteSlug)}/admin`;
  if (!suffix) {
    return base;
  }

  return `${base}/${suffix.replace(/^\/+/, "")}`;
}

function buildPageEditorHref(siteSlug: string, pageKey: string): string {
  return buildSiteAdminHref(
    siteSlug,
    `content/${encodeURIComponent(pageKey)}`
  );
}

function buildProductEditorHref(siteSlug: string, productId: string): string {
  return buildSiteAdminHref(
    siteSlug,
    `products/${encodeURIComponent(productId)}`
  );
}

function buildPreviewHref(siteSlug: string, filePath?: string): string {
  const base = `/sites/${encodeURIComponent(siteSlug)}`;
  const normalizedPath = String(filePath ?? "").replace(/^\/+|\/+$/g, "");

  if (!normalizedPath || normalizedPath === "index.html") {
    return base;
  }

  if (normalizedPath.endsWith("/index.html")) {
    return `${base}/${normalizedPath.slice(0, -"index.html".length)}`;
  }

  if (normalizedPath.endsWith(".html")) {
    return `${base}/${normalizedPath}`;
  }

  return `${base}/${normalizedPath}`;
}

function noopExpand() {
  return Promise.resolve();
}

function buildForkConfig(
  initialData: SiteCmsBootstrap,
  pageIndexHref: string,
  productIndexHref: string,
  filesHref: string,
  settingsHref: string,
  siteHref: string,
  shopHref: string
): ForkConfig {
  return {
    owner: "curb",
    repo: initialData.settings.businessName,
    branch: initialData.siteSlug,
    sha: "local",
    version: "fork",
    object: {
      content: [
        {
          name: "pages",
          type: "collection",
          label: "Pages",
          href: pageIndexHref,
        },
        {
          name: "products",
          type: "collection",
          label: "Products",
          href: productIndexHref,
        },
        {
          name: "files",
          type: "file",
          label: "Files",
          href: filesHref,
        },
      ],
      settings: {
        href: settingsHref,
        label: "Settings",
      },
      site: {
        name: initialData.settings.businessName,
        slug: initialData.siteSlug,
        siteHref,
        shopHref,
      },
    },
  };
}

function buildRepo(initialData: SiteCmsBootstrap): Repo {
  return {
    id: 1,
    owner: "curb",
    ownerId: 1,
    repo: initialData.settings.businessName,
    branches: [initialData.siteSlug],
    defaultBranch: initialData.siteSlug,
    isPrivate: true,
  };
}

function EntryShell({
  title,
  navigateBack,
  desktopActions,
  mobileActions,
  sidebar,
  children,
}: {
  title: string;
  navigateBack: string;
  desktopActions: ReactNode;
  mobileActions: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-screen-xl gap-x-8">
      <div className="flex-1 w-0">
        <header className="mb-6 flex items-center">
          <Link
            className={cn(
              buttonVariants({ variant: "outline", size: "icon-xs" }),
              "mr-4 shrink-0"
            )}
            href={navigateBack}
            prefetch
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>

          <h1 className="truncate text-lg font-semibold md:text-2xl">{title}</h1>
        </header>
        <div className="grid items-start gap-6">{children}</div>
      </div>
      <div className="hidden w-64 lg:block">
        <div className="sticky top-0 flex flex-col gap-y-4">{desktopActions}{sidebar}</div>
      </div>
      <div className="fixed right-0 top-0 z-10 flex h-14 items-center gap-x-2 pr-4 md:pr-6 lg:hidden">
        {mobileActions}
      </div>
    </div>
  );
}

function SettingsForm({
  settingsDraft,
  setSettingsDraft,
}: {
  settingsDraft: Pick<SiteCmsSettings, "ownerEmail" | "commerceProvider">;
  setSettingsDraft: Dispatch<
    SetStateAction<Pick<SiteCmsSettings, "ownerEmail" | "commerceProvider">>
  >;
}) {
  return (
    <div className="grid items-start gap-6">
      <div className="space-y-2">
        <Label>Owner email</Label>
        <Input
          value={settingsDraft.ownerEmail}
          onChange={(event) =>
            setSettingsDraft((currentDraft) => ({
              ...currentDraft,
              ownerEmail: event.target.value,
            }))
          }
          placeholder="owner@example.com"
        />
      </div>
      <div className="space-y-2">
        <Label>Checkout provider</Label>
        <select
          className="h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={settingsDraft.commerceProvider}
          onChange={(event) =>
            setSettingsDraft((currentDraft) => ({
              ...currentDraft,
              commerceProvider: event.target.value as
                | "none"
                | "shopify"
                | "stripe-payment-links",
            }))
          }
        >
          <option value="stripe-payment-links">Stripe Payment Links</option>
          <option value="shopify">Shopify</option>
          <option value="none">No store</option>
        </select>
      </div>
    </div>
  );
}

export function SiteAdminApp({
  initialData,
  initialPath,
}: SiteAdminAppProps) {
  const router = useRouter();
  const route = useMemo(() => normalizeRoute(initialPath), [initialPath]);

  const [pages, setPages] = useState(initialData.pages);
  const [products, setProducts] = useState(sortProducts(initialData.products));
  const [settings, setSettings] = useState(initialData.settings);
  const [pageDraft, setPageDraft] = useState<Record<string, SiteCmsFieldValue>>(
    {}
  );
  const [productDraft, setProductDraft] = useState<SiteCmsProductRecord>(
    buildProductDraft(null, initialData.products)
  );
  const [settingsDraft, setSettingsDraft] = useState({
    ownerEmail: initialData.settings.ownerEmail,
    commerceProvider: initialData.settings.commerceProvider,
  });
  const [pageQuery, setPageQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [status, setStatus] = useState<StatusState>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setPages(initialData.pages);
    setProducts(sortProducts(initialData.products));
    setSettings(initialData.settings);
    setSettingsDraft({
      ownerEmail: initialData.settings.ownerEmail,
      commerceProvider: initialData.settings.commerceProvider,
    });
  }, [initialData]);

  const currentPage =
    route.section === "content" && route.pageKey
      ? pages.find((page) => page.pageKey === route.pageKey) ?? null
      : null;

  const currentProduct =
    route.section === "products" &&
    route.productId &&
    route.productId !== "new"
      ? products.find((product) => product.id === route.productId) ?? null
      : null;

  useEffect(() => {
    setPageDraft(buildPageDraft(currentPage));
  }, [currentPage]);

  useEffect(() => {
    setProductDraft(buildProductDraft(currentProduct, products));
  }, [currentProduct, products]);

  const deferredPageQuery = useDeferredValue(pageQuery.trim().toLowerCase());
  const deferredProductQuery = useDeferredValue(productQuery.trim().toLowerCase());

  const filteredPages = useMemo(() => {
    if (!deferredPageQuery) {
      return pages;
    }

    return pages.filter((page) =>
      [page.title, page.path, page.pageKey].some((value) =>
        value.toLowerCase().includes(deferredPageQuery)
      )
    );
  }, [deferredPageQuery, pages]);

  const filteredProducts = useMemo(() => {
    if (!deferredProductQuery) {
      return products;
    }

    return products.filter((product) =>
      [product.title, product.id, product.priceLabel, product.checkoutUrl].some(
        (value) => value.toLowerCase().includes(deferredProductQuery)
      )
    );
  }, [deferredProductQuery, products]);

  const pageIndexHref = buildSiteAdminHref(initialData.siteSlug, "content");
  const productIndexHref = buildSiteAdminHref(initialData.siteSlug, "products");
  const filesHref = buildSiteAdminHref(initialData.siteSlug, "files");
  const settingsHref = buildSiteAdminHref(initialData.siteSlug, "settings");
  const siteHref = buildPreviewHref(initialData.siteSlug);
  const shopHref = buildPreviewHref(initialData.siteSlug, "shop/index.html");

  const config = useMemo(
    () =>
      buildForkConfig(
        initialData,
        pageIndexHref,
        productIndexHref,
        filesHref,
        settingsHref,
        siteHref,
        shopHref
      ),
    [
      filesHref,
      initialData,
      pageIndexHref,
      productIndexHref,
      settingsHref,
      shopHref,
      siteHref,
    ]
  );

  const repo = useMemo(() => buildRepo(initialData), [initialData]);

  const pageRows = useMemo<PageRow[]>(
    () =>
      filteredPages.map((page) => ({
        name: page.title,
        path: page.path,
        type: "file",
        pageKey: page.pageKey,
        title: page.title,
        fieldCount: page.fields.length,
      })),
    [filteredPages]
  );

  const productRows = useMemo<ProductRow[]>(
    () =>
      filteredProducts.map((product) => ({
        name: product.title,
        path: product.id,
        type: "file",
        productId: product.id,
        title: product.title,
        priceLabel: product.priceLabel || "Not set",
        checkoutState: product.checkoutUrl ? "Configured" : "Missing",
        position: product.position,
      })),
    [filteredProducts]
  );

  const pageColumns = useMemo(
    () => [
      {
        accessorKey: "title",
        header: "Title",
        meta: {
          className: "truncate w-full min-w-[14rem] max-w-[1px]",
        },
        cell: ({ row }: { row: { original: PageRow } }) => (
          <Link
            className="truncate font-medium"
            href={buildPageEditorHref(initialData.siteSlug, row.original.pageKey)}
            prefetch
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "path",
        header: "Path",
        cell: ({ row }: { row: { original: PageRow } }) => (
          <span className="font-mono text-sm text-muted-foreground">
            {row.original.path}
          </span>
        ),
      },
      {
        accessorKey: "fieldCount",
        header: "Fields",
        meta: {
          className: "w-[96px]",
        },
        cell: ({ row }: { row: { original: PageRow } }) => row.original.fieldCount,
      },
    ],
    [initialData.siteSlug]
  );

  const productColumns = useMemo(
    () => [
      {
        accessorKey: "title",
        header: "Title",
        meta: {
          className: "truncate w-full min-w-[14rem] max-w-[1px]",
        },
        cell: ({ row }: { row: { original: ProductRow } }) => (
          <Link
            className="truncate font-medium"
            href={buildProductEditorHref(initialData.siteSlug, row.original.productId)}
            prefetch
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "priceLabel",
        header: "Price",
        cell: ({ row }: { row: { original: ProductRow } }) => row.original.priceLabel,
      },
      {
        accessorKey: "checkoutState",
        header: "Checkout",
        cell: ({ row }: { row: { original: ProductRow } }) => row.original.checkoutState,
      },
      {
        accessorKey: "position",
        header: "Position",
        meta: {
          className: "w-[96px]",
        },
        cell: ({ row }: { row: { original: ProductRow } }) => row.original.position,
      },
    ],
    [initialData.siteSlug]
  );

  async function savePage() {
    if (!currentPage) {
      return;
    }

    setIsSaving(true);
    setStatus(null);

    try {
      const response = await fetch(
        `/api/site-admin/${encodeURIComponent(initialData.siteSlug)}/pages`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            pageKey: currentPage.pageKey,
            fields: pageDraft,
          }),
        }
      );

      const payload = (await response.json()) as {
        error?: string;
        page?: SiteCmsPageRecord;
      };

      if (!response.ok || !payload.page) {
        throw new Error(payload.error || "Failed to save page.");
      }

      setPages((currentPages) =>
        currentPages.map((page) =>
          page.pageKey === payload.page!.pageKey ? payload.page! : page
        )
      );
      setPageDraft(buildPageDraft(payload.page));
      setStatus({
        tone: "default",
        message: `Saved ${payload.page.title}.`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to save page.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function persistProducts(
    nextProducts: SiteCmsProductRecord[],
    message: string,
    nextRouteProductId?: string | null
  ) {
    setIsSaving(true);
    setStatus(null);

    try {
      const response = await fetch(
        `/api/site-admin/${encodeURIComponent(initialData.siteSlug)}/products`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            products: sortProducts(nextProducts),
          }),
        }
      );

      const payload = (await response.json()) as {
        error?: string;
        products?: SiteCmsProductRecord[];
      };

      if (!response.ok || !payload.products) {
        throw new Error(payload.error || "Failed to save products.");
      }

      const nextSavedProducts = sortProducts(payload.products);
      setProducts(nextSavedProducts);
      setStatus({ tone: "default", message });

      if (nextRouteProductId === null) {
        startTransition(() => {
          router.push(productIndexHref);
        });
      } else if (nextRouteProductId) {
        startTransition(() => {
          router.push(buildProductEditorHref(initialData.siteSlug, nextRouteProductId));
        });
      }
    } catch (error) {
      setStatus({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Failed to save products.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveProduct() {
    if (!productDraft.title.trim()) {
      setStatus({
        tone: "error",
        message: "Enter a product title before saving.",
      });
      return;
    }

    const nextId = makeUniqueProductId(
      productDraft.title,
      products,
      productDraft.id || undefined
    );

    const nextProduct: SiteCmsProductRecord = {
      ...productDraft,
      id: nextId,
      position: Math.max(1, Number(productDraft.position) || 1),
      title: productDraft.title.trim(),
      priceLabel: productDraft.priceLabel.trim(),
      description: productDraft.description.trim(),
      imageUrl: productDraft.imageUrl.trim(),
      imageAlt: productDraft.imageAlt.trim(),
      actionLabel: productDraft.actionLabel.trim() || "Buy now",
      checkoutUrl: productDraft.checkoutUrl.trim(),
    };

    const nextProducts = products.filter((product) => product.id !== nextProduct.id);
    nextProducts.push(nextProduct);

    await persistProducts(nextProducts, `Saved ${nextProduct.title}.`, nextProduct.id);
  }

  async function handleDeleteProduct(productId: string) {
    const nextProducts = products.filter((product) => product.id !== productId);
    const shouldExitEditor =
      route.section === "products" && route.productId === productId;

    await persistProducts(
      nextProducts,
      `Deleted ${productId}.`,
      shouldExitEditor ? nextProducts[0]?.id ?? null : undefined
    );
  }

  async function saveSettings() {
    setIsSaving(true);
    setStatus(null);

    try {
      const response = await fetch(
        `/api/site-admin/${encodeURIComponent(initialData.siteSlug)}/settings`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(settingsDraft),
        }
      );

      const payload = (await response.json()) as {
        error?: string;
        settings?: SiteCmsSettings;
      };

      if (!response.ok || !payload.settings) {
        throw new Error(payload.error || "Failed to save settings.");
      }

      setSettings(payload.settings);
      setSettingsDraft({
        ownerEmail: payload.settings.ownerEmail,
        commerceProvider: payload.settings.commerceProvider,
      });
      setStatus({
        tone: "default",
        message: "Saved settings.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Failed to save settings.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function renderStatus() {
    if (!status) {
      return null;
    }

    return (
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-sm",
          status.tone === "error"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-emerald-200 bg-emerald-50 text-emerald-700"
        )}
      >
        {status.message}
      </div>
    );
  }

  function renderContentIndex() {
    return (
      <div className="mx-auto flex max-w-screen-xl flex-1 flex-col">
        <header className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold md:text-2xl">Pages</h1>
          <div className="flex items-center gap-2">
            {renderStatus()}
            <a
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={siteHref}
              target="_blank"
              rel="noreferrer"
            >
              View site
              <ExternalLink className="ml-1.5 h-4 w-4" />
            </a>
          </div>
        </header>
        <div className="mb-4 flex max-w-sm items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={pageQuery}
            onChange={(event) => setPageQuery(event.target.value)}
            placeholder="Search pages"
          />
        </div>
        <div className="flex flex-1 flex-col">
          <CollectionTable<PageRow>
            columns={pageColumns}
            data={pageRows}
            search={pageQuery}
            setSearch={setPageQuery}
            onExpand={noopExpand}
            pathname={pageIndexHref}
            path=""
            primaryField="title"
          />
        </div>
      </div>
    );
  }

  function renderPagesEditor() {
    if (!route.pageKey || !currentPage) {
      return (
        <Message
          title="Page missing"
          description="The page you tried to open could not be found."
          href={pageIndexHref}
          cta="Back to pages"
          className="absolute inset-0"
        />
      );
    }

    const desktopActions = (
      <>
        <div className="flex gap-x-2">
          <Button className="w-full" onClick={savePage} disabled={isSaving}>
            Save
          </Button>
        </div>
        <div className="rounded-lg border p-3 text-sm">
          <div className="font-medium">{currentPage.title}</div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {currentPage.path}
          </div>
        </div>
        <a
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={buildPreviewHref(initialData.siteSlug, currentPage.path)}
          target="_blank"
          rel="noreferrer"
        >
          View page
          <ExternalLink className="ml-1.5 h-4 w-4" />
        </a>
        {renderStatus()}
      </>
    );

    const mobileActions = (
      <>
        <Button size="sm" onClick={savePage} disabled={isSaving}>
          Save
        </Button>
      </>
    );

    return (
      <EntryShell
        title={currentPage.title}
        navigateBack={pageIndexHref}
        desktopActions={desktopActions}
        mobileActions={mobileActions}
        sidebar={null}
      >
        {currentPage.fields.map((field) => {
          const value = pageDraft[field.key];

          if (field.type === "link") {
            const linkValue =
              "text" in (value || {})
                ? (value as Extract<SiteCmsFieldValue, { text: string; href: string }>)
                : { text: "", href: "" };

            return (
              <div key={field.key} className="space-y-3">
                <div>
                  <div className="text-sm font-medium">{field.label}</div>
                  <div className="text-xs text-muted-foreground">{field.key}</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Label</Label>
                    <Input
                      value={linkValue.text}
                      onChange={(event) =>
                        setPageDraft((currentDraft) => ({
                          ...currentDraft,
                          [field.key]: {
                            text: event.target.value,
                            href: linkValue.href,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Destination</Label>
                    <Input
                      value={linkValue.href}
                      onChange={(event) =>
                        setPageDraft((currentDraft) => ({
                          ...currentDraft,
                          [field.key]: {
                            text: linkValue.text,
                            href: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            );
          }

          if (field.type === "image") {
            const imageValue =
              "src" in (value || {})
                ? (value as Extract<SiteCmsFieldValue, { src: string; alt: string }>)
                : { src: "", alt: "" };

            return (
              <div key={field.key} className="space-y-3">
                <div>
                  <div className="text-sm font-medium">{field.label}</div>
                  <div className="text-xs text-muted-foreground">{field.key}</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Image source</Label>
                    <Input
                      value={imageValue.src}
                      onChange={(event) =>
                        setPageDraft((currentDraft) => ({
                          ...currentDraft,
                          [field.key]: {
                            src: event.target.value,
                            alt: imageValue.alt,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Alt text</Label>
                    <Input
                      value={imageValue.alt}
                      onChange={(event) =>
                        setPageDraft((currentDraft) => ({
                          ...currentDraft,
                          [field.key]: {
                            src: imageValue.src,
                            alt: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            );
          }

          const textValue =
            "value" in (value || {})
              ? (value as Extract<SiteCmsFieldValue, { value: string }>)
              : { value: "" };

          return (
            <div key={field.key} className="space-y-3">
              <div>
                <div className="text-sm font-medium">{field.label}</div>
                <div className="text-xs text-muted-foreground">{field.key}</div>
              </div>
              <div className="space-y-2">
                <Label>{field.type === "textarea" ? "Content" : "Value"}</Label>
                {field.type === "textarea" ? (
                  <Textarea
                    rows={8}
                    value={textValue.value}
                    onChange={(event) =>
                      setPageDraft((currentDraft) => ({
                        ...currentDraft,
                        [field.key]: {
                          value: event.target.value,
                        },
                      }))
                    }
                  />
                ) : (
                  <Input
                    value={textValue.value}
                    onChange={(event) =>
                      setPageDraft((currentDraft) => ({
                        ...currentDraft,
                        [field.key]: {
                          value: event.target.value,
                        },
                      }))
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
      </EntryShell>
    );
  }

  function renderProductsIndex() {
    return (
      <div className="mx-auto flex max-w-screen-xl flex-1 flex-col">
        <header className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold md:text-2xl">Products</h1>
          <div className="flex items-center gap-2">
            {renderStatus()}
            <a
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={shopHref}
              target="_blank"
              rel="noreferrer"
            >
              View shop
              <ExternalLink className="ml-1.5 h-4 w-4" />
            </a>
            <Link
              className={buttonVariants({ variant: "default", size: "sm" })}
              href={buildProductEditorHref(initialData.siteSlug, "new")}
              prefetch
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New product
            </Link>
          </div>
        </header>
        <div className="mb-4 flex max-w-sm items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={productQuery}
            onChange={(event) => setProductQuery(event.target.value)}
            placeholder="Search products"
          />
        </div>
        <div className="flex flex-1 flex-col">
          <CollectionTable<ProductRow>
            columns={productColumns}
            data={productRows}
            search={productQuery}
            setSearch={setProductQuery}
            onExpand={noopExpand}
            pathname={productIndexHref}
            path=""
            primaryField="title"
          />
        </div>
      </div>
    );
  }

  function renderProductEditor() {
    if (route.productId && route.productId !== "new" && !currentProduct) {
      return (
        <Message
          title="Product missing"
          description="The product you tried to open could not be found."
          href={productIndexHref}
          cta="Back to products"
          className="absolute inset-0"
        />
      );
    }

    const desktopActions = (
      <>
        <div className="flex gap-x-2">
          <Button className="w-full" onClick={handleSaveProduct} disabled={isSaving}>
            Save
          </Button>
          {currentProduct ? (
            <Button
              variant="outline"
              onClick={() => void handleDeleteProduct(currentProduct.id)}
              disabled={isSaving}
            >
              Delete
            </Button>
          ) : null}
        </div>
        <div className="rounded-lg border p-3 text-sm">
          <div className="font-medium">
            {currentProduct ? currentProduct.title : "New product"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Position {productDraft.position}
          </div>
        </div>
        <a
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={shopHref}
          target="_blank"
          rel="noreferrer"
        >
          View shop
          <ExternalLink className="ml-1.5 h-4 w-4" />
        </a>
        {renderStatus()}
      </>
    );

    const mobileActions = (
      <>
        <Button size="sm" onClick={handleSaveProduct} disabled={isSaving}>
          Save
        </Button>
      </>
    );

    return (
      <EntryShell
        title={currentProduct ? currentProduct.title : "New product"}
        navigateBack={productIndexHref}
        desktopActions={desktopActions}
        mobileActions={mobileActions}
        sidebar={null}
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              value={productDraft.title}
              onChange={(event) =>
                setProductDraft((currentDraft) => ({
                  ...currentDraft,
                  title: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Price label</Label>
            <Input
              value={productDraft.priceLabel}
              onChange={(event) =>
                setProductDraft((currentDraft) => ({
                  ...currentDraft,
                  priceLabel: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Position</Label>
            <Input
              type="number"
              min={1}
              value={String(productDraft.position)}
              onChange={(event) =>
                setProductDraft((currentDraft) => ({
                  ...currentDraft,
                  position: Math.max(1, Number(event.target.value) || 1),
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Button label</Label>
            <Input
              value={productDraft.actionLabel}
              onChange={(event) =>
                setProductDraft((currentDraft) => ({
                  ...currentDraft,
                  actionLabel: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            rows={8}
            value={productDraft.description}
            onChange={(event) =>
              setProductDraft((currentDraft) => ({
                ...currentDraft,
                description: event.target.value,
              }))
            }
          />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Image URL</Label>
            <Input
              value={productDraft.imageUrl}
              onChange={(event) =>
                setProductDraft((currentDraft) => ({
                  ...currentDraft,
                  imageUrl: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Image alt</Label>
            <Input
              value={productDraft.imageAlt}
              onChange={(event) =>
                setProductDraft((currentDraft) => ({
                  ...currentDraft,
                  imageAlt: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>
            {settings.commerceProvider === "shopify"
              ? "Shopify checkout URL"
              : "Stripe checkout URL"}
          </Label>
          <Input
            value={productDraft.checkoutUrl}
            onChange={(event) =>
              setProductDraft((currentDraft) => ({
                ...currentDraft,
                checkoutUrl: event.target.value,
              }))
            }
          />
        </div>
      </EntryShell>
    );
  }

  function renderSettings() {
    const desktopActions = (
      <>
        <div className="flex gap-x-2">
          <Button className="w-full" onClick={saveSettings} disabled={isSaving}>
            Save
          </Button>
        </div>
        <div className="rounded-lg border p-3 text-sm">
          <div className="font-medium">{settings.businessName}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {initialData.siteSlug}
          </div>
        </div>
        <a
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={siteHref}
          target="_blank"
          rel="noreferrer"
        >
          View site
          <ExternalLink className="ml-1.5 h-4 w-4" />
        </a>
        {renderStatus()}
      </>
    );

    const mobileActions = (
      <>
        <Button size="sm" onClick={saveSettings} disabled={isSaving}>
          Save
        </Button>
      </>
    );

    return (
      <EntryShell
        title="Settings"
        navigateBack={pageIndexHref}
        desktopActions={desktopActions}
        mobileActions={mobileActions}
        sidebar={null}
      >
        <SettingsForm
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
        />
      </EntryShell>
    );
  }

  function renderFiles() {
    return (
      <div className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col">
        <div className="h-[calc(100dvh-8rem)] min-h-[40rem] lg:h-[calc(100dvh-4rem)]">
          <SiteFileEditor
            filesApiPath={`/api/site-admin/${encodeURIComponent(initialData.siteSlug)}/files`}
            siteSlug={initialData.siteSlug}
            title="Files"
            description="Browse and edit the generated site files. A backup is created automatically on the first save."
            className="rounded-xl border bg-background shadow-sm"
          />
        </div>
      </div>
    );
  }

  function renderBody() {
    if (route.section === "content" && route.pageKey) {
      return renderPagesEditor();
    }

    if (route.section === "products" && route.productId) {
      return renderProductEditor();
    }

    if (route.section === "products") {
      return renderProductsIndex();
    }

    if (route.section === "files") {
      return renderFiles();
    }

    if (route.section === "settings") {
      return renderSettings();
    }

    return renderContentIndex();
  }

  return (
    <ConfigProvider value={config}>
      <RepoProvider repo={repo}>
        <RepoLayout>{renderBody()}</RepoLayout>
      </RepoProvider>
    </ConfigProvider>
  );
}
