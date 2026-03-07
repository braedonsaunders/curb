"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  formatStoredDateTime,
  formatStoredTime,
} from "@/lib/datetime";
import { toast } from "sonner";
import { DISCOVERY_CATEGORIES } from "@/lib/discovery-categories";
import {
  Search,
  MapPin,
  Loader2,
  Star,
  Globe,
  ChevronDown,
  ChevronUp,
  Clock,
  Pause,
  Play,
} from "lucide-react";

interface DiscoveredBusiness {
  id: number;
  slug: string;
  name: string;
  category: string | null;
  address: string | null;
  website_url: string | null;
  rating: number | null;
  status: string;
  enrichment_status: string | null;
  details_enriched_at: string | null;
  overall_grade?: string | null;
  website_complexity?: string | null;
  replacement_difficulty?: string | null;
  isNew: boolean;
}

interface DiscoveryRun {
  id: string;
  location: string;
  categories: string[];
  totalFound: number;
  newFound: number;
  timestamp: string;
}

interface WorkerActivity {
  enabled: boolean;
  current: {
    id: number;
    name: string;
    status: string;
    startedAt: string | null;
    stage: string | null;
    message: string | null;
  } | null;
  queue: {
    pending: number;
    inProgress: number;
    failed: number;
    completed: number;
  };
  recent: Array<{
    id: number;
    stage: string;
    businessId: number | null;
    businessName: string | null;
    message: string;
    createdAt: string;
  }>;
}

export default function DiscoverPage() {
  const [location, setLocation] = useState("Hamilton, ON");
  const [radius, setRadius] = useState(15);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DiscoveredBusiness[] | null>(null);
  const [resultIds, setResultIds] = useState<number[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [pastRuns, setPastRuns] = useState<DiscoveryRun[]>([]);
  const [showPastRuns, setShowPastRuns] = useState(false);
  const [workerActivity, setWorkerActivity] = useState<WorkerActivity | null>(null);
  const [workerControlLoading, setWorkerControlLoading] = useState<
    "pause" | "resume" | null
  >(null);

  useEffect(() => {
    async function loadDefaults() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error("Failed to load settings");

        const data = await res.json();
        setLocation(data.defaults?.location ?? "Hamilton, ON");
        setRadius(data.defaults?.radius ?? 15);
        setSelectedCategories(data.defaults?.categories ?? []);
      } catch {
        // Keep local defaults if settings are unavailable.
      }
    }

    loadDefaults();
  }, []);

  const loadWorkerActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/activity?kind=enrichment&limit=12");
      if (!res.ok) {
        throw new Error("Failed to load worker activity");
      }

      const data = (await res.json()) as WorkerActivity;
      setWorkerActivity(data);
    } catch {
      // Worker activity is informational only.
    }
  }, []);

  useEffect(() => {
    void loadWorkerActivity();
    const intervalId = window.setInterval(() => {
      void loadWorkerActivity();
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [loadWorkerActivity]);

  async function toggleWorker() {
    const action = workerActivity?.enabled === false ? "resume" : "pause";
    setWorkerControlLoading(action);
    try {
      const res = await fetch("/api/enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Failed to update enrichment");
      }
      await loadWorkerActivity();
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
      setWorkerControlLoading(null);
    }
  }

  function toggleCategory(id: string) {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function selectAll() {
    setSelectedCategories(DISCOVERY_CATEGORIES.map((c) => c.id));
  }

  function clearAll() {
    setSelectedCategories([]);
  }

  const refreshResults = useCallback(async (ids: number[]) => {
    if (ids.length === 0) {
      return;
    }

    const params = new URLSearchParams();
    params.set("ids", ids.join(","));

    const res = await fetch(`/api/businesses?${params.toString()}`);
    if (!res.ok) {
      throw new Error("Failed to refresh discovery results");
    }

    const data = await res.json();
    const rows = Array.isArray(data.businesses) ? data.businesses : [];
    const rowMap = new Map(
      rows.map((row: Record<string, unknown>) => [
        Number(row.id),
        {
          id: Number(row.id),
          slug: String(row.slug ?? ""),
          name: String(row.name ?? ""),
          category: typeof row.category === "string" ? row.category : null,
          address: typeof row.address === "string" ? row.address : null,
          website_url:
            typeof row.website_url === "string" ? row.website_url : null,
          rating:
            typeof row.rating === "number" ? row.rating : row.rating == null ? null : Number(row.rating),
          status: String(row.status ?? "discovered"),
          enrichment_status:
            typeof row.enrichment_status === "string"
              ? row.enrichment_status
              : null,
          details_enriched_at:
            typeof row.details_enriched_at === "string"
              ? row.details_enriched_at
              : null,
          overall_grade:
            typeof row.overall_grade === "string" ? row.overall_grade : null,
          website_complexity:
            typeof row.website_complexity === "string"
              ? row.website_complexity
              : null,
          replacement_difficulty:
            typeof row.replacement_difficulty === "string"
              ? row.replacement_difficulty
              : null,
        },
      ])
    );

    setResults((current) => {
      const previous = new Map(
        (current ?? []).map((biz) => [biz.id, biz])
      );

      return ids
        .map((id) => {
          const next = rowMap.get(id);
          if (!next) {
            return previous.get(id) ?? null;
          }

          return {
            ...next,
            isNew: previous.get(id)?.isNew ?? false,
          };
        })
        .filter((biz): biz is DiscoveredBusiness => biz !== null);
    });
  }, []);

  async function handleSearch() {
    if (!location.trim()) {
      toast.error("Please enter a location");
      return;
    }
    if (selectedCategories.length === 0) {
      toast.error("Please select at least one category");
      return;
    }

    setSearching(true);
    setResults(null);

    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location,
          radius,
          categories: selectedCategories,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Discovery failed");
      }

      setResults(data.businesses ?? []);
      setResultIds(
        Array.isArray(data.businesses)
          ? data.businesses
              .map((biz: Record<string, unknown>) => Number(biz.id))
              .filter((id: number) => Number.isInteger(id) && id > 0)
          : []
      );
      setNewCount(data.newAdded ?? 0);

      if (data.run) {
        setPastRuns((prev) => [data.run, ...prev]);
      }

      if (Array.isArray(data.businesses) && data.businesses.length > 0) {
        void refreshResults(
          data.businesses
            .map((biz: Record<string, unknown>) => Number(biz.id))
            .filter((id: number) => Number.isInteger(id) && id > 0)
        ).catch(() => undefined);
      }

      toast.success(
        `Found ${data.businesses?.length ?? 0} businesses (${data.newAdded ?? 0} new)`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!results || resultIds.length === 0) {
      return;
    }

    const hasPendingEnrichment = results.some((biz) => {
      if (biz.enrichment_status === "failed") {
        return false;
      }

      if (
        biz.enrichment_status === "pending" ||
        biz.enrichment_status === "in_progress"
      ) {
        return true;
      }

      return biz.details_enriched_at == null || biz.overall_grade == null;
    });

    if (!hasPendingEnrichment) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshResults(resultIds).catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [refreshResults, resultIds, results]);

  function renderStars(rating: number | null) {
    if (rating == null || rating <= 0) {
      return <span className="text-xs text-muted-foreground">Rating pending</span>;
    }

    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star
          key={i}
          className={`size-3.5 ${
            i <= rating
              ? "fill-yellow-400 text-yellow-400"
              : i - 0.5 <= rating
              ? "fill-yellow-400/50 text-yellow-400"
              : "text-gray-300"
          }`}
        />
      );
    }
    return <div className="flex gap-0.5">{stars}</div>;
  }

  function websiteBadge(biz: DiscoveredBusiness) {
    if (biz.website_url) {
      return {
        label: "Website found",
        className: "gap-1 border-green-200 text-green-700",
      };
    }

    if (biz.details_enriched_at) {
      return {
        label: "No website",
        className: "gap-1 text-orange-600",
      };
    }

    return {
      label: "Checking website",
      className: "gap-1 border-slate-200 text-slate-600",
    };
  }

  function enrichmentBadge(biz: DiscoveredBusiness) {
    if (biz.enrichment_status === "in_progress") {
      return {
        label: "Enriching",
        className: "bg-blue-50 text-blue-700 border-blue-200",
      };
    }

    if (biz.enrichment_status === "failed") {
      return {
        label: "Needs retry",
        className: "bg-red-50 text-red-700 border-red-200",
      };
    }

    if (
      biz.enrichment_status === "completed" &&
      biz.details_enriched_at &&
      biz.overall_grade
    ) {
      return {
        label: "Ready",
        className: "bg-green-50 text-green-700 border-green-200",
      };
    }

    return {
      label: "Queued",
      className: "bg-slate-50 text-slate-700 border-slate-200",
    };
  }

  function complexityLabel(value: string | null | undefined) {
    if (value === "advanced") return "Advanced site";
    if (value === "moderate") return "Moderate site";
    if (value === "simple") return "Simple site";
    if (value === "none") return "No website";
    return null;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Discover Businesses</h1>
        <p className="text-muted-foreground">
          Search for local businesses that need a better web presence
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Search Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="size-4" />
                Search Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="City, Province"
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="radius">Radius (km): {radius}</Label>
                  <div className="flex items-center gap-3">
                    <input
                      id="radius"
                      type="range"
                      min={1}
                      max={50}
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value))}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                    />
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={radius}
                      onChange={(e) => setRadius(Math.min(50, Math.max(1, Number(e.target.value))))}
                      className="w-20"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Categories</Label>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="xs" onClick={selectAll}>
                      Select all
                    </Button>
                    <Button variant="ghost" size="xs" onClick={clearAll}>
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {DISCOVERY_CATEGORIES.map((cat) => {
                    const isSelected = selectedCategories.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => toggleCategory(cat.id)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        <div
                          className={`flex size-4 items-center justify-center rounded border transition-colors ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/30"
                          }`}
                        >
                          {isSelected && (
                            <svg
                              className="size-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={3}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </div>
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                onClick={handleSearch}
                disabled={searching}
                className="w-full"
                size="lg"
              >
                {searching ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="size-4" />
                    Search Businesses
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Past Runs Sidebar */}
        <div>
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <Loader2 className={`size-4 ${workerActivity?.current ? "animate-spin" : ""}`} />
                  Worker Activity
                </CardTitle>
                <Button
                  variant={workerActivity?.enabled === false ? "default" : "outline"}
                  size="sm"
                  onClick={() => void toggleWorker()}
                  disabled={workerControlLoading !== null}
                >
                  {workerControlLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : workerActivity?.enabled === false ? (
                    <Play className="size-4" />
                  ) : (
                    <Pause className="size-4" />
                  )}
                  {workerActivity?.enabled === false ? "Resume" : "Stop"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-muted-foreground">Pending</p>
                  <p className="text-lg font-semibold">{workerActivity?.queue.pending ?? 0}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-muted-foreground">Running</p>
                  <p className="text-lg font-semibold">{workerActivity?.queue.inProgress ?? 0}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-muted-foreground">Failed</p>
                  <p className="text-lg font-semibold">{workerActivity?.queue.failed ?? 0}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-muted-foreground">Done</p>
                  <p className="text-lg font-semibold">{workerActivity?.queue.completed ?? 0}</p>
                </div>
              </div>

              {workerActivity?.enabled === false && !workerActivity?.current ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Automatic enrichment is paused.
                </div>
              ) : workerActivity?.current ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
                  <p className="font-medium text-blue-900">
                    Working on {workerActivity.current.name}
                  </p>
                  <p className="mt-1 text-blue-800">
                    {workerActivity.current.message ?? "Enrichment in progress"}
                  </p>
                  <p className="mt-2 text-xs text-blue-700">
                    {workerActivity.current.startedAt
                      ? `Started ${formatStoredTime(workerActivity.current.startedAt)}`
                      : "Running now"}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No business is actively being evaluated right now.
                </p>
              )}

              {workerActivity?.recent && workerActivity.recent.length > 0 && (
                <div className="space-y-2">
                  {workerActivity.recent.slice(0, 8).map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      <p className="font-medium">
                        {entry.businessName ?? "Worker"}
                      </p>
                      <p className="text-muted-foreground">{entry.message}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatStoredTime(entry.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <button
                type="button"
                onClick={() => setShowPastRuns(!showPastRuns)}
                className="flex w-full items-center justify-between"
              >
                <CardTitle className="flex items-center gap-2">
                  <Clock className="size-4" />
                  Past Runs
                </CardTitle>
                {showPastRuns ? (
                  <ChevronUp className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground" />
                )}
              </button>
            </CardHeader>
            {showPastRuns && (
              <CardContent>
                {pastRuns.length > 0 ? (
                  <div className="space-y-3">
                    {pastRuns.map((run) => (
                      <div
                        key={run.id}
                        className="rounded-lg border border-border p-3 text-sm"
                      >
                        <p className="font-medium">{run.location}</p>
                        <p className="text-muted-foreground">
                          {run.totalFound} found, {run.newFound} new
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatStoredDateTime(run.timestamp)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No past discovery runs
                  </p>
                )}
              </CardContent>
            )}
          </Card>
        </div>
      </div>

      {/* Results */}
      {results !== null && (
        <>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Found {results.length} businesses
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({newCount} new)
                </span>
              </h2>
            </div>

            {results.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {results.map((biz) => (
                  <Card key={biz.id}>
                    <CardContent className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-medium leading-tight">
                            {biz.name}
                          </h3>
                          <Badge variant="secondary" className="mt-1">
                            {biz.category ?? "Unknown category"}
                          </Badge>
                        </div>
                        {biz.isNew && (
                          <Badge className="shrink-0 bg-green-600 text-white">
                            NEW
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {biz.address ?? "Address syncing from Google Places..."}
                      </p>
                      <div className="flex items-center justify-between gap-3">
                        {renderStars(biz.rating)}
                        {biz.website_url ? (
                          <Badge variant="outline" className={websiteBadge(biz).className}>
                            <Globe className="size-3" />
                            {websiteBadge(biz).label}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className={websiteBadge(biz).className}>
                            {websiteBadge(biz).label}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className={enrichmentBadge(biz).className}>
                          {enrichmentBadge(biz).label}
                        </Badge>
                        {biz.overall_grade && (
                          <Badge variant="outline">Grade {biz.overall_grade}</Badge>
                        )}
                        {complexityLabel(biz.website_complexity) && (
                          <Badge variant="outline">
                            {complexityLabel(biz.website_complexity)}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent>
                  <p className="py-8 text-center text-muted-foreground">
                    No businesses found matching your criteria. Try expanding
                    your search radius or selecting different categories.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
