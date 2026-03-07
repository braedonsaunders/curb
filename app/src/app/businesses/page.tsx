"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Search,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Loader2,
  ScanSearch,
  Zap,
  Archive,
  Globe,
  LayoutGrid,
  TableProperties,
  Check,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import {
  BUSINESS_BOARD_COLUMNS,
  BUSINESS_STATUSES,
  getBusinessStatusLabel,
  NOT_APPLICABLE_STATUS,
} from "@/lib/business-status";

const STATUS_COLORS: Record<string, string> = {
  discovered: "bg-gray-100 text-gray-700 border-gray-200",
  audited: "bg-blue-50 text-blue-700 border-blue-200",
  flagged: "bg-orange-50 text-orange-700 border-orange-200",
  generated: "bg-green-50 text-green-700 border-green-200",
  reviewed: "bg-indigo-50 text-indigo-700 border-indigo-200",
  emailed: "bg-purple-50 text-purple-700 border-purple-200",
  sold: "bg-emerald-50 text-emerald-700 border-emerald-200",
  skipped: "bg-slate-100 text-slate-600 border-slate-200",
  archived: "bg-red-50 text-red-600 border-red-200",
};

const COLUMN_BORDER_COLORS: Record<string, string> = {
  discovered: "border-t-gray-400",
  audited: "border-t-blue-400",
  flagged: "border-t-orange-400",
  generated: "border-t-green-400",
  reviewed: "border-t-indigo-400",
  emailed: "border-t-purple-400",
  sold: "border-t-emerald-400",
  skipped: "border-t-slate-400",
};

const STATUSES = ["all", ...BUSINESS_STATUSES];

const CATEGORIES_FILTER = [
  "all",
  "restaurants",
  "trades",
  "salons",
  "auto",
  "retail",
  "professional",
  "health",
  "fitness",
  "pets",
  "cleaning",
];

interface Business {
  id: string;
  name: string;
  category: string;
  city: string;
  status: string;
  enrichment_status: string | null;
  overall_grade: string | null;
  website_url: string | null;
  audit_has_website: boolean | number | null;
  site_slug: string | null;
}

interface BusinessesResponse {
  businesses: Business[];
  total: number;
  page: number;
  pageSize: number;
}

export default function BusinessesPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}>
      <BusinessesContent />
    </Suspense>
  );
}

function BusinessesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<"table" | "board">("table");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrichmentEnabled, setEnrichmentEnabled] = useState(true);
  const [enrichmentActionLoading, setEnrichmentActionLoading] = useState<
    "pause" | "resume" | "rerun" | null
  >(null);

  const fetchBusinesses = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(pageSize));
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (searchQuery) params.set("search", searchQuery);
      params.set("sort", sortField);
      params.set("dir", sortDir);

      const res = await fetch(`/api/businesses?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data: BusinessesResponse = await res.json();
      setBusinesses(data.businesses ?? []);
      setTotal(data.total ?? 0);
      setSelectedIds((prev) => {
        const visible = new Set((data.businesses ?? []).map((biz) => biz.id));
        return new Set(Array.from(prev).filter((id) => visible.has(id)));
      });
    } catch {
      toast.error("Failed to load businesses");
      setBusinesses([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, categoryFilter, searchQuery, sortField, sortDir]);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  const fetchEnrichmentState = useCallback(async () => {
    try {
      const res = await fetch("/api/enrichment");
      if (!res.ok) throw new Error("Failed to fetch enrichment state");
      const data = (await res.json()) as { enabled?: boolean };
      setEnrichmentEnabled(data.enabled !== false);
    } catch {
      // Keep previous state if the control endpoint is unavailable.
    }
  }, []);

  useEffect(() => {
    void fetchEnrichmentState();
  }, [fetchEnrichmentState]);

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  async function handleAction(
    action:
      | "audit"
      | "generate"
      | "markNotApplicable"
      | "archive"
      | "rerunEnrichment",
    bizId: string
  ) {
    try {
      let res: Response;
      let successMessage: string;
      let failureMessage: string;

      switch (action) {
        case "audit":
          res = await fetch(`/api/businesses/${bizId}/audit`, {
            method: "POST",
          });
          successMessage = "Audit complete";
          failureMessage = "Failed to audit business";
          break;
        case "generate":
          res = await fetch(`/api/businesses/${bizId}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          successMessage = "Site generated";
          failureMessage = "Failed to generate site";
          break;
        case "markNotApplicable":
          res = await fetch(`/api/businesses/${bizId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: NOT_APPLICABLE_STATUS }),
          });
          successMessage = "Business marked as not applicable";
          failureMessage = "Failed to mark business as not applicable";
          break;
        case "archive":
          res = await fetch(`/api/businesses/${bizId}`, {
            method: "DELETE",
          });
          successMessage = "Business archived";
          failureMessage = "Failed to archive business";
          break;
        case "rerunEnrichment":
          res = await fetch("/api/enrichment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "rerun",
              businessIds: [Number(bizId)],
            }),
          });
          successMessage = "Business requeued for enrichment";
          failureMessage = "Failed to rerun enrichment";
          break;
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || failureMessage);
      }

      toast.success(successMessage);
      await fetchBusinesses();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update business"
      );
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === businesses.length && businesses.length > 0) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds(new Set(businesses.map((biz) => biz.id)));
  }

  async function toggleEnrichment() {
    setEnrichmentActionLoading(enrichmentEnabled ? "pause" : "resume");
    try {
      const action = enrichmentEnabled ? "pause" : "resume";
      const res = await fetch("/api/enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { enabled?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Failed to update enrichment");
      }

      setEnrichmentEnabled(data.enabled !== false);
      toast.success(
        action === "pause"
          ? "Automatic enrichment paused"
          : "Automatic enrichment resumed"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update enrichment"
      );
    } finally {
      setEnrichmentActionLoading(null);
    }
  }

  async function rerunSelectedEnrichment() {
    const ids = Array.from(selectedIds).map((id) => Number(id));
    if (ids.length === 0) {
      toast.error("Select at least one business");
      return;
    }

    setEnrichmentActionLoading("rerun");
    try {
      const res = await fetch("/api/enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rerun",
          businessIds: ids,
        }),
      });
      const data = (await res.json()) as {
        queued?: number;
        skippedInProgress?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Failed to rerun enrichment");
      }

      const queued = data.queued ?? 0;
      const skipped = data.skippedInProgress ?? 0;
      toast.success(
        skipped > 0
          ? `Queued ${queued} business(es); skipped ${skipped} currently running`
          : `Queued ${queued} business(es) for enrichment`
      );
      setSelectedIds(new Set());
      await fetchBusinesses();
      await fetchEnrichmentState();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to rerun enrichment"
      );
    } finally {
      setEnrichmentActionLoading(null);
    }
  }

  const totalPages = Math.ceil(total / pageSize);

  function SortHeader({ field, children }: { field: string; children: React.ReactNode }) {
    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {children}
        <ArrowUpDown className="size-3" />
      </button>
    );
  }

  function getWebsiteStatus(biz: Business): "yes" | "no" | "checking" {
    if (biz.audit_has_website === true || biz.audit_has_website === 1) {
      return "yes";
    }

    if (biz.audit_has_website === false || biz.audit_has_website === 0) {
      return "no";
    }

    if (biz.website_url) {
      return "yes";
    }

    if (biz.enrichment_status === "completed") {
      return "no";
    }

    return "checking";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Businesses</h1>
        <p className="text-muted-foreground">
          Manage discovered businesses through your pipeline
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search businesses..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(val: string | null) => {
              setStatusFilter(val ?? "all");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All statuses" : getBusinessStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={categoryFilter}
            onValueChange={(val: string | null) => {
              setCategoryFilter(val ?? "all");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES_FILTER.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === "all" ? "All categories" : c.charAt(0).toUpperCase() + c.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center rounded-md border">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`inline-flex items-center gap-1.5 rounded-l-md px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === "table"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <TableProperties className="size-4" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              className={`inline-flex items-center gap-1.5 rounded-r-md px-3 py-2 text-sm font-medium transition-colors ${
                viewMode === "board"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <LayoutGrid className="size-4" />
              Board
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {selectedIds.size > 0 && (
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={rerunSelectedEnrichment}
              disabled={
                selectedIds.size === 0 || enrichmentActionLoading === "rerun"
              }
            >
              {enrichmentActionLoading === "rerun" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Rerun Enrichment
            </Button>
            <Button
              variant={enrichmentEnabled ? "outline" : "default"}
              size="sm"
              onClick={toggleEnrichment}
              disabled={enrichmentActionLoading === "pause" || enrichmentActionLoading === "resume"}
            >
              {enrichmentActionLoading === "pause" ||
              enrichmentActionLoading === "resume" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : enrichmentEnabled ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {enrichmentEnabled ? "Stop Enrichment" : "Resume Enrichment"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {viewMode === "table" ? (
        <>
          {/* Table */}
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : businesses.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Search className="size-8" />
                  <p>No businesses found</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={
                            businesses.length > 0 &&
                            selectedIds.size === businesses.length
                          }
                          onChange={toggleSelectAll}
                          className="size-4 rounded border-gray-300 accent-primary"
                        />
                      </TableHead>
                      <TableHead>
                        <SortHeader field="name">Name</SortHeader>
                      </TableHead>
                      <TableHead>
                        <SortHeader field="category">Category</SortHeader>
                      </TableHead>
                      <TableHead>
                        <SortHeader field="city">City</SortHeader>
                      </TableHead>
                      <TableHead>
                        <SortHeader field="status">Status</SortHeader>
                      </TableHead>
                      <TableHead>
                        <SortHeader field="grade">Grade</SortHeader>
                      </TableHead>
                      <TableHead>Has Site</TableHead>
                      <TableHead className="w-12">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {businesses.map((biz) => (
                      <TableRow
                        key={biz.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/businesses/${biz.id}`)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(biz.id)}
                            onChange={() => toggleSelect(biz.id)}
                            className="size-4 rounded border-gray-300 accent-primary"
                          />
                        </TableCell>
                        <TableCell className="font-medium">{biz.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {biz.category}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {biz.city}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                              STATUS_COLORS[biz.status] ?? STATUS_COLORS.discovered
                            }`}
                          >
                            {getBusinessStatusLabel(biz.status)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {biz.overall_grade ? (
                            <span
                              className={`inline-flex size-7 items-center justify-center rounded-md text-xs font-bold ${
                                biz.overall_grade === "A"
                                  ? "bg-green-100 text-green-700"
                                  : biz.overall_grade === "B"
                                  ? "bg-blue-100 text-blue-700"
                                  : biz.overall_grade === "C"
                                  ? "bg-yellow-100 text-yellow-700"
                                  : biz.overall_grade === "D"
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {biz.overall_grade}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {getWebsiteStatus(biz) === "yes" ? (
                            <span className="inline-flex items-center gap-1 text-green-600">
                              <Globe className="size-4" />
                              Yes
                            </span>
                          ) : getWebsiteStatus(biz) === "no" ? (
                            <span className="text-orange-600">No</span>
                          ) : (
                            <span className="text-muted-foreground">Checking</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              onClick={(e) => e.stopPropagation()}
                              className="flex size-8 items-center justify-center rounded-md hover:bg-muted"
                            >
                              <MoreHorizontal className="size-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleAction("rerunEnrichment", biz.id);
                                }}
                              >
                                <RefreshCw className="size-4" />
                                Rerun Enrichment
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction("audit", biz.id);
                                }}
                              >
                                <ScanSearch className="size-4" />
                                Audit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction("generate", biz.id);
                                }}
                              >
                                <Zap className="size-4" />
                                Generate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleAction("markNotApplicable", biz.id);
                                }}
                              >
                                <Check className="size-4" />
                                Mark Not Applicable
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleAction("archive", biz.id);
                                }}
                              >
                                <Archive className="size-4" />
                                Archive
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * pageSize + 1}--{Math.min(page * pageSize, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Board / Kanban View */
        loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : businesses.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Search className="size-8" />
            <p>No businesses found</p>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {BUSINESS_BOARD_COLUMNS.map((status) => {
              const columnBiz = businesses.filter((b) => b.status === status);
              return (
                <div
                  key={status}
                  className={`flex w-72 shrink-0 flex-col rounded-lg border border-t-4 bg-muted/30 ${COLUMN_BORDER_COLORS[status]}`}
                >
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-3 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLORS[status]
                      }`}
                    >
                      {getBusinessStatusLabel(status)}
                    </span>
                    <span className="ml-auto text-xs font-medium text-muted-foreground">
                      {columnBiz.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100vh - 320px)" }}>
                    {columnBiz.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">
                        No businesses
                      </p>
                    ) : (
                      columnBiz.map((biz) => (
                        <button
                          key={biz.id}
                          type="button"
                          onClick={() => router.push(`/businesses/${biz.id}`)}
                          className="rounded-md border bg-background p-3 text-left shadow-sm transition-colors hover:bg-muted/50"
                        >
                          <p className="truncate text-sm font-medium">
                            {biz.name}
                          </p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {biz.category}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {biz.city}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
