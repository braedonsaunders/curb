"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";

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

const BOARD_COLUMNS = [
  "discovered",
  "audited",
  "flagged",
  "generated",
  "reviewed",
  "emailed",
  "sold",
] as const;

const COLUMN_BORDER_COLORS: Record<string, string> = {
  discovered: "border-t-gray-400",
  audited: "border-t-blue-400",
  flagged: "border-t-orange-400",
  generated: "border-t-green-400",
  reviewed: "border-t-indigo-400",
  emailed: "border-t-purple-400",
  sold: "border-t-emerald-400",
};

const STATUSES = [
  "all",
  "discovered",
  "audited",
  "flagged",
  "generated",
  "reviewed",
  "emailed",
  "sold",
  "skipped",
  "archived",
];

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
  overall_grade: string;
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

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  async function handleAction(action: string, bizId: string) {
    try {
      const res = await fetch(`/api/businesses/${bizId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)} complete`);
      fetchBusinesses();
    } catch {
      toast.error(`Failed to ${action} business`);
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
                  {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
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
                            {biz.status}
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
                          {biz.site_slug ? (
                            <Globe className="size-4 text-green-600" />
                          ) : (
                            <span className="text-muted-foreground">--</span>
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
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction("archive", biz.id);
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
            {BOARD_COLUMNS.map((status) => {
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
                      {status.charAt(0).toUpperCase() + status.slice(1)}
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
