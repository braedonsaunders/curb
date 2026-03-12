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
import { ChevronLeft, ExternalLink, Plus, Search, Trash2 } from "lucide-react";

import { SiteFileEditor } from "@/components/site-file-editor";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  SiteCmsBootstrap,
  SiteCmsCollectionItemInput,
  SiteCmsCollectionRecord,
  SiteCmsFieldValue,
  SiteCmsPageRecord,
  SiteCmsProductRecord,
  SiteCmsSettings,
} from "@/lib/generated-site-cms";
import {
  SITE_ADMIN_PREVIEW_QUERY_PARAM,
  SITE_ADMIN_SESSION_COOKIE,
} from "@/lib/site-admin-session";
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
  previewAccessToken: string | null;
  previewAccessSessionValue: string | null;
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

type EditableCmsField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "link" | "image";
  role?: string;
  defaultValue?: string;
  defaultHref?: string;
  defaultAlt?: string;
};

type PageDraftState = {
  fields: Record<string, SiteCmsFieldValue>;
  collections: Record<string, SiteCmsCollectionItemInput[]>;
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
): PageDraftState {
  if (!page) {
    return {
      fields: {},
      collections: {},
    };
  }

  return {
    fields: page.fields.reduce<Record<string, SiteCmsFieldValue>>((draft, field) => {
      draft[field.key] = field.currentValue;
      return draft;
    }, {}),
    collections: (page.collections ?? []).reduce<
      Record<string, SiteCmsCollectionItemInput[]>
    >((draft, collection) => {
      draft[collection.key] = collection.items.map((item) => ({
        id: item.id,
        fields: item.fields.reduce<Record<string, SiteCmsFieldValue>>(
          (fieldDraft, field) => {
            fieldDraft[field.key] = field.currentValue;
            return fieldDraft;
          },
          {}
        ),
      }));
      return draft;
    }, {}),
  };
}

function createDefaultFieldValue(field: EditableCmsField): SiteCmsFieldValue {
  if (field.type === "link") {
    return {
      text: field.defaultValue || "",
      href: field.defaultHref || "",
    };
  }

  if (field.type === "image") {
    return {
      src: field.defaultValue || "",
      alt: field.defaultAlt || "",
    };
  }

  return {
    value: field.defaultValue || "",
  };
}

function buildCollectionItemDraft(
  collection: SiteCmsCollectionRecord
): SiteCmsCollectionItemInput {
  return {
    id: `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    fields: collection.fields.reduce<Record<string, SiteCmsFieldValue>>(
      (draft, field) => {
        draft[field.key] = createDefaultFieldValue(field);
        return draft;
      },
      {}
    ),
  };
}

function getValueLabel(value: SiteCmsFieldValue | undefined): string {
  if (!value) {
    return "";
  }

  if ("value" in value) {
    return value.value.trim();
  }

  if ("text" in value) {
    return value.text.trim();
  }

  return value.alt.trim() || value.src.trim();
}

function getCollectionItemLabel(
  collection: SiteCmsCollectionRecord,
  item: SiteCmsCollectionItemInput,
  index: number
): string {
  const nameFieldKey = collection.itemNameFieldKey || collection.fields[0]?.key;
  const name = nameFieldKey ? getValueLabel(item.fields[nameFieldKey]) : "";
  return name || `${collection.itemLabel} ${index + 1}`;
}

function CmsFieldEditor({
  field,
  value,
  onChange,
  showKey = true,
}: {
  field: EditableCmsField;
  value: SiteCmsFieldValue | undefined;
  onChange: (nextValue: SiteCmsFieldValue) => void;
  showKey?: boolean;
}) {
  if (field.type === "link") {
    const linkValue =
      value && "text" in value ? value : createDefaultFieldValue(field);
    const normalizedLinkValue = linkValue as Extract<
      SiteCmsFieldValue,
      { text: string; href: string }
    >;

    return (
      <div className="space-y-3">
        <div>
          <div className="text-sm font-medium">{field.label}</div>
          {showKey ? (
            <div className="text-xs text-muted-foreground">{field.key}</div>
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Label</Label>
            <Input
              value={normalizedLinkValue.text}
              onChange={(event) =>
                onChange({
                  text: event.target.value,
                  href: normalizedLinkValue.href,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Destination</Label>
            <Input
              value={normalizedLinkValue.href}
              onChange={(event) =>
                onChange({
                  text: normalizedLinkValue.text,
                  href: event.target.value,
                })
              }
            />
          </div>
        </div>
      </div>
    );
  }

  if (field.type === "image") {
    const imageValue =
      value && "src" in value ? value : createDefaultFieldValue(field);
    const normalizedImageValue = imageValue as Extract<
      SiteCmsFieldValue,
      { src: string; alt: string }
    >;

    return (
      <div className="space-y-3">
        <div>
          <div className="text-sm font-medium">{field.label}</div>
          {showKey ? (
            <div className="text-xs text-muted-foreground">{field.key}</div>
          ) : null}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Image source</Label>
            <Input
              value={normalizedImageValue.src}
              onChange={(event) =>
                onChange({
                  src: event.target.value,
                  alt: normalizedImageValue.alt,
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Alt text</Label>
            <Input
              value={normalizedImageValue.alt}
              onChange={(event) =>
                onChange({
                  src: normalizedImageValue.src,
                  alt: event.target.value,
                })
              }
            />
          </div>
        </div>
      </div>
    );
  }

  const textValue =
    value && "value" in value ? value : createDefaultFieldValue(field);
  const normalizedTextValue = textValue as Extract<
    SiteCmsFieldValue,
    { value: string }
  >;

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">{field.label}</div>
        {showKey ? (
          <div className="text-xs text-muted-foreground">{field.key}</div>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label>{field.type === "textarea" ? "Content" : "Value"}</Label>
        {field.type === "textarea" ? (
          <Textarea
            rows={8}
            value={normalizedTextValue.value}
            onChange={(event) =>
              onChange({
                value: event.target.value,
              })
            }
          />
        ) : (
          <Input
            value={normalizedTextValue.value}
            onChange={(event) =>
              onChange({
                value: event.target.value,
              })
            }
          />
        )}
      </div>
    </div>
  );
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

function appendPreviewAccess(
  href: string,
  previewAccessToken?: string | null
): string {
  if (!previewAccessToken) {
    return href;
  }

  const url = new URL(href, "http://local-preview.invalid");
  url.searchParams.set(SITE_ADMIN_PREVIEW_QUERY_PARAM, previewAccessToken);

  if (/^https?:\/\//i.test(href)) {
    return url.toString();
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function buildSiteAdminHref(
  siteSlug: string,
  suffix?: string,
  previewAccessToken?: string | null
): string {
  const base = `/sites/${encodeURIComponent(siteSlug)}/admin`;
  const href = !suffix ? base : `${base}/${suffix.replace(/^\/+/, "")}`;

  return appendPreviewAccess(href, previewAccessToken);
}

function buildPageEditorHref(
  siteSlug: string,
  pageKey: string,
  previewAccessToken?: string | null
): string {
  return buildSiteAdminHref(
    siteSlug,
    `content/${encodeURIComponent(pageKey)}`,
    previewAccessToken
  );
}

function buildProductEditorHref(
  siteSlug: string,
  productId: string,
  previewAccessToken?: string | null
): string {
  return buildSiteAdminHref(
    siteSlug,
    `products/${encodeURIComponent(productId)}`,
    previewAccessToken
  );
}

function buildSiteAdminApiHref(
  siteSlug: string,
  section: "files" | "pages" | "products" | "settings",
  previewAccessToken?: string | null
): string {
  return appendPreviewAccess(
    `/api/site-admin/${encodeURIComponent(siteSlug)}/${section}`,
    previewAccessToken
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
  previewAccessToken: initialPreviewAccessToken,
  previewAccessSessionValue,
}: SiteAdminAppProps) {
  const router = useRouter();
  const route = useMemo(() => normalizeRoute(initialPath), [initialPath]);

  const [pages, setPages] = useState(initialData.pages);
  const [products, setProducts] = useState(sortProducts(initialData.products));
  const [settings, setSettings] = useState(initialData.settings);
  const [pageDraft, setPageDraft] = useState<PageDraftState>(buildPageDraft(null));
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
  const [previewAccessToken, setPreviewAccessToken] = useState<string | null>(
    initialPreviewAccessToken
  );

  useEffect(() => {
    setPages(initialData.pages);
    setProducts(sortProducts(initialData.products));
    setSettings(initialData.settings);
    setSettingsDraft({
      ownerEmail: initialData.settings.ownerEmail,
      commerceProvider: initialData.settings.commerceProvider,
    });
  }, [initialData]);

  useEffect(() => {
    setPreviewAccessToken(initialPreviewAccessToken);
  }, [initialPreviewAccessToken]);

  useEffect(() => {
    if (!previewAccessSessionValue || typeof document === "undefined") {
      return;
    }

    document.cookie = `${SITE_ADMIN_SESSION_COOKIE}=${encodeURIComponent(
      previewAccessSessionValue
    )}; path=/; SameSite=Lax${
      window.location.protocol === "https:" ? "; Secure" : ""
    }`;

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has(SITE_ADMIN_PREVIEW_QUERY_PARAM)) {
      currentUrl.searchParams.delete(SITE_ADMIN_PREVIEW_QUERY_PARAM);
      window.history.replaceState(
        {},
        document.title,
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
      );
    }

    setPreviewAccessToken(null);
  }, [previewAccessSessionValue]);

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

  const pageIndexHref = buildSiteAdminHref(
    initialData.siteSlug,
    "content",
    previewAccessToken
  );
  const productIndexHref = buildSiteAdminHref(
    initialData.siteSlug,
    "products",
    previewAccessToken
  );
  const filesHref = buildSiteAdminHref(
    initialData.siteSlug,
    "files",
    previewAccessToken
  );
  const settingsHref = buildSiteAdminHref(
    initialData.siteSlug,
    "settings",
    previewAccessToken
  );
  const siteHref = buildPreviewHref(initialData.siteSlug);
  const shopHref = buildPreviewHref(initialData.siteSlug, "shop/index.html");
  const pagesApiHref = buildSiteAdminApiHref(
    initialData.siteSlug,
    "pages",
    previewAccessToken
  );
  const productsApiHref = buildSiteAdminApiHref(
    initialData.siteSlug,
    "products",
    previewAccessToken
  );
  const settingsApiHref = buildSiteAdminApiHref(
    initialData.siteSlug,
    "settings",
    previewAccessToken
  );
  const filesApiHref = buildSiteAdminApiHref(
    initialData.siteSlug,
    "files",
    previewAccessToken
  );

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
        fieldCount: page.fields.length + page.collections.length,
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
            href={buildPageEditorHref(
              initialData.siteSlug,
              row.original.pageKey,
              previewAccessToken
            )}
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
        header: "Editable",
        meta: {
          className: "w-[96px]",
        },
        cell: ({ row }: { row: { original: PageRow } }) => row.original.fieldCount,
      },
    ],
    [initialData.siteSlug, previewAccessToken]
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
            href={buildProductEditorHref(
              initialData.siteSlug,
              row.original.productId,
              previewAccessToken
            )}
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
    [initialData.siteSlug, previewAccessToken]
  );

  async function savePage() {
    if (!currentPage) {
      return;
    }

    setIsSaving(true);
    setStatus(null);

    try {
      const response = await fetch(
        pagesApiHref,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            pageKey: currentPage.pageKey,
            fields: pageDraft.fields,
            collections: pageDraft.collections,
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

  function updatePageField(fieldKey: string, nextValue: SiteCmsFieldValue) {
    setPageDraft((currentDraft) => ({
      ...currentDraft,
      fields: {
        ...currentDraft.fields,
        [fieldKey]: nextValue,
      },
    }));
  }

  function addCollectionItem(collection: SiteCmsCollectionRecord) {
    setPageDraft((currentDraft) => ({
      ...currentDraft,
      collections: {
        ...currentDraft.collections,
        [collection.key]: [
          ...(currentDraft.collections[collection.key] ?? []),
          buildCollectionItemDraft(collection),
        ],
      },
    }));
  }

  function updateCollectionField(
    collectionKey: string,
    itemId: string | undefined,
    itemIndex: number,
    fieldKey: string,
    nextValue: SiteCmsFieldValue
  ) {
    setPageDraft((currentDraft) => ({
      ...currentDraft,
      collections: {
        ...currentDraft.collections,
        [collectionKey]: (currentDraft.collections[collectionKey] ?? []).map(
          (item, index) => {
            const matchesItem =
              (itemId && item.id === itemId) || (!itemId && index === itemIndex);

            if (!matchesItem) {
              return item;
            }

            return {
              ...item,
              fields: {
                ...item.fields,
                [fieldKey]: nextValue,
              },
            };
          }
        ),
      },
    }));
  }

  function removeCollectionItem(
    collectionKey: string,
    itemId: string | undefined,
    itemIndex: number
  ) {
    setPageDraft((currentDraft) => ({
      ...currentDraft,
      collections: {
        ...currentDraft.collections,
        [collectionKey]: (currentDraft.collections[collectionKey] ?? []).filter(
          (item, index) =>
            itemId ? item.id !== itemId : index !== itemIndex
        ),
      },
    }));
  }

  async function persistProducts(
    nextProducts: SiteCmsProductRecord[],
    message: string,
    nextRouteProductId?: string | null
  ) {
    setIsSaving(true);
    setStatus(null);

    try {
      const response = await fetch(productsApiHref, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          products: sortProducts(nextProducts),
        }),
      });

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
          router.push(
            buildProductEditorHref(
              initialData.siteSlug,
              nextRouteProductId,
              previewAccessToken
            )
          );
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
        settingsApiHref,
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
    if (route.section !== "content" || !route.pageKey || !currentPage) {
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
        {currentPage.collections.length > 0 ? (
          <section className="space-y-5 rounded-xl border bg-background p-5 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Repeatable sections</h2>
              <p className="text-sm text-muted-foreground">
                Use these for schedules, services, reviews, menus, team members,
                and similar repeatable cards.
              </p>
            </div>
            {currentPage.collections.map((collection) => {
              const items = pageDraft.collections[collection.key] ?? [];

              return (
                <div
                  key={collection.key}
                  className="space-y-4 rounded-xl border bg-muted/20 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold">{collection.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {items.length} editable {items.length === 1 ? "item" : "items"}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addCollectionItem(collection)}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Add {collection.itemLabel.toLowerCase()}
                    </Button>
                  </div>
                  {items.length > 0 ? (
                    items.map((item, itemIndex) => (
                      <div
                        key={item.id ?? `${collection.key}-${itemIndex}`}
                        className="space-y-5 rounded-lg border bg-background p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-medium">
                              {getCollectionItemLabel(collection, item, itemIndex)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {collection.itemLabel} {itemIndex + 1}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              removeCollectionItem(
                                collection.key,
                                item.id,
                                itemIndex
                              )
                            }
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Remove
                          </Button>
                        </div>
                        <div className="space-y-6">
                          {collection.fields.map((field) => (
                            <CmsFieldEditor
                              key={`${collection.key}-${item.id ?? itemIndex}-${field.key}`}
                              field={field}
                              value={item.fields[field.key]}
                              showKey={false}
                              onChange={(nextValue) =>
                                updateCollectionField(
                                  collection.key,
                                  item.id,
                                  itemIndex,
                                  field.key,
                                  nextValue
                                )
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                      No {collection.itemLabel.toLowerCase()} entries yet. Add one
                      to populate this section.
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ) : null}
        {currentPage.fields.length > 0 ? (
          <section className="space-y-5 rounded-xl border bg-background p-5 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Page content</h2>
              <p className="text-sm text-muted-foreground">
                Edit the standalone headings, paragraphs, links, and images on
                this page.
              </p>
            </div>
            {currentPage.fields.map((field) => (
              <CmsFieldEditor
                key={field.key}
                field={field}
                value={pageDraft.fields[field.key]}
                onChange={(nextValue) => updatePageField(field.key, nextValue)}
              />
            ))}
          </section>
        ) : null}
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
              href={buildProductEditorHref(
                initialData.siteSlug,
                "new",
                previewAccessToken
              )}
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
    if (
      route.section !== "products" ||
      (route.productId && route.productId !== "new" && !currentProduct)
    ) {
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
            filesApiPath={filesApiHref}
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
