"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatStoredDateTime, parseStoredDate } from "@/lib/datetime";
import {
  ArrowUpRight,
  Building2,
  FolderKanban,
  Globe,
  Loader2,
  Mail,
  RefreshCw,
} from "lucide-react";

interface DistributionRow {
  value: string | null;
  count: number;
}

interface Opportunity {
  id: number;
  name: string;
  category: string | null;
  status: string;
  updated_at: string;
  overall_grade: string | null;
  owner_sentiment: string | null;
  website_complexity: string | null;
  replacement_difficulty: string | null;
  has_website: boolean | number | null;
}

interface StatsResponse {
  totalBusinesses: number;
  totalSitesGenerated: number;
  totalEmailsSent: number;
  totalEmailsDraft: number;
  businessesByStatus: Record<string, number>;
  gradeDistribution: Array<{
    grade: string | null;
    count: number;
  }>;
  replacementDifficultyDistribution: DistributionRow[];
  websiteComplexityDistribution: DistributionRow[];
  ownerSentimentDistribution: DistributionRow[];
  leadSignals: {
    noWebsiteFlagged: number;
    easyReplacementFlagged: number;
    simpleSiteFlagged: number;
    embarrassedOwnerFlagged: number;
    primeTargets: number;
  };
  topOpportunities: Opportunity[];
  recentActivity: Array<{
    id: number;
    name: string;
    slug: string;
    status: string;
    category: string | null;
    updated_at: string;
  }>;
}

const EMPTY_STATS: StatsResponse = {
  totalBusinesses: 0,
  totalSitesGenerated: 0,
  totalEmailsSent: 0,
  totalEmailsDraft: 0,
  businessesByStatus: {},
  gradeDistribution: [],
  replacementDifficultyDistribution: [],
  websiteComplexityDistribution: [],
  ownerSentimentDistribution: [],
  leadSignals: {
    noWebsiteFlagged: 0,
    easyReplacementFlagged: 0,
    simpleSiteFlagged: 0,
    embarrassedOwnerFlagged: 0,
    primeTargets: 0,
  },
  topOpportunities: [],
  recentActivity: [],
};

const FUNNEL_STAGE_META = [
  {
    key: "discovered",
    label: "Discovered",
    bgClass: "bg-stone-50 border-stone-200",
  },
  {
    key: "audited",
    label: "Audited",
    bgClass: "bg-sky-50 border-sky-200",
  },
  {
    key: "flagged",
    label: "Flagged",
    bgClass: "bg-amber-50 border-amber-200",
  },
  {
    key: "preview_ready",
    label: "Preview ready",
    bgClass: "bg-emerald-50 border-emerald-200",
  },
  {
    key: "sold",
    label: "Sold",
    bgClass: "bg-teal-50 border-teal-200",
  },
] as const;

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "Easy swap",
  medium: "Medium swap",
  hard: "Hard swap",
  unknown: "Unknown",
};

const COMPLEXITY_LABELS: Record<string, string> = {
  none: "No site",
  simple: "Simple site",
  moderate: "Moderate site",
  advanced: "Advanced site",
  unknown: "Unknown",
};

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompactNumber(value: number) {
  return compactNumberFormatter.format(value);
}

function formatPercent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function formatCategory(category: string | null) {
  if (!category) return "Uncategorized";
  return category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTimeAgo(value: string | null | undefined) {
  const date = parseStoredDate(value);
  if (!date) return "No recent updates";

  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 60_000) return "Updated just now";

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `Updated ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

function DashboardPanel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-h-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_18px_42px_-36px_rgba(15,23,42,0.28)]",
        className
      )}
    >
      <div className="flex h-full min-h-0 flex-col p-3">
        <div className="mb-2 flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-slate-500">
              {title}
            </p>
            <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          </div>
          {action}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void loadStats();
  }, []);

  async function loadStats(options?: { background?: boolean }) {
    const background = options?.background ?? false;

    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/stats", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to fetch stats");
      }

      const data = (await response.json()) as StatsResponse;
      setStats(data);
    } catch {
      toast.error("Failed to load dashboard data");
      setStats((current) => current ?? EMPTY_STATS);
    } finally {
      if (background) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  if (loading && !stats) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center rounded-[22px] border border-slate-200 bg-white">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 className="size-5 animate-spin" />
          Loading dashboard
        </div>
      </div>
    );
  }

  const data = stats ?? EMPTY_STATS;
  const statusCounts = data.businessesByStatus;
  const totalBusinesses = data.totalBusinesses;
  const flaggedCount = statusCounts.flagged ?? 0;
  const generatedCount = statusCounts.generated ?? 0;
  const reviewedCount = statusCounts.reviewed ?? 0;
  const soldCount = statusCounts.sold ?? 0;
  const funnelRows = FUNNEL_STAGE_META.map((stage) => ({
    ...stage,
    count:
      stage.key === "preview_ready"
        ? generatedCount + reviewedCount
        : statusCounts[stage.key] ?? 0,
  }));
  const maxFunnelCount = Math.max(...funnelRows.map((stage) => stage.count), 1);
  const lastUpdatedAt = data.recentActivity[0]?.updated_at ?? null;
  const reviewHref =
    generatedCount > 0
      ? "/businesses?status=generated"
      : "/businesses?status=flagged&view=board";

  const fitRows = [
    {
      label: "Prime targets",
      value: data.leadSignals.primeTargets,
    },
    {
      label: "No site live",
      value: data.leadSignals.noWebsiteFlagged,
    },
    {
      label: "Easy swap",
      value: data.leadSignals.easyReplacementFlagged,
    },
    {
      label: "Simple or none",
      value: data.leadSignals.simpleSiteFlagged,
    },
  ];

  const queueRows = [
    {
      label: "Flagged queue",
      value: flaggedCount,
      hint: "worth rebuilding",
      href: "/businesses?status=flagged&view=board",
      icon: FolderKanban,
    },
    {
      label: "Built previews",
      value: generatedCount + reviewedCount,
      hint: "ready to review",
      href: reviewHref,
      icon: Globe,
    },
    {
      label: "Draft emails",
      value: data.totalEmailsDraft,
      hint: "offers waiting",
      href: "/outreach",
      icon: Mail,
    },
    {
      label: "Closed sales",
      value: soldCount,
      hint: "won deals",
      href: "/businesses?status=sold",
      icon: Building2,
    },
  ];

  return (
    <div className="flex min-h-0 flex-col gap-2 text-slate-950 xl:h-[calc(100vh-4rem)] xl:overflow-hidden">
      <section className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 shadow-[0_18px_42px_-36px_rgba(15,23,42,0.28)]">
        <div className="flex h-full flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Dashboard
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              One-shot upgrade pipeline
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Find weak sites, build the replacement, send the offer.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-500">
              {formatTimeAgo(lastUpdatedAt)}
              {lastUpdatedAt ? ` • ${formatStoredDateTime(lastUpdatedAt)}` : ""}
            </p>
            <Link
              href="/businesses?status=flagged&view=board"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "rounded-full border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
              )}
            >
              Prime targets
            </Link>
            <Link
              href={reviewHref}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "rounded-full border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
              )}
            >
              Built preview
            </Link>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
              onClick={() => void loadStats({ background: true })}
            >
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[minmax(0,1.62fr)_340px]">
        <div className="grid min-h-0 gap-2 xl:grid-rows-[minmax(0,0.72fr)_minmax(0,0.9fr)]">
          <DashboardPanel
            title="Pipeline Funnel"
            subtitle="Actual movement from discovery to sold."
          >
            <div className="flex h-full min-h-0 flex-col justify-start gap-1.5">
              {funnelRows.map((stage) => {
                const width = stage.count > 0 ? Math.max((stage.count / maxFunnelCount) * 100, 16) : 0;

                return (
                  <div key={stage.key} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>{stage.label}</span>
                      <span>
                        {formatCompactNumber(stage.count)} · {formatPercent(stage.count, totalBusinesses)}
                      </span>
                    </div>
                    <div className="flex justify-center">
                      <div
                        className={cn(
                          "flex h-7 items-center justify-between rounded-xl border px-3 text-sm font-medium text-slate-900",
                          stage.bgClass
                        )}
                        style={{ width: `${width}%` }}
                      >
                        <span>{stage.label}</span>
                        <span>{stage.count}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </DashboardPanel>

          <DashboardPanel
            title="Best Immediate Targets"
            subtitle="Top flagged leads that are easiest to turn into a one-shot sale."
            action={
              <Link
                href="/businesses?status=flagged&view=board"
                className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
              >
                View flagged
              </Link>
            }
          >
            {data.topOpportunities.length > 0 ? (
              <div className="grid h-full min-h-0 gap-2">
                {data.topOpportunities.slice(0, 2).map((lead) => {
                  const hasWebsite = Boolean(lead.has_website);
                  const gradeLabel = hasWebsite
                    ? `${lead.overall_grade ?? "?"} grade`
                    : "No site";
                  const difficultyLabel =
                    DIFFICULTY_LABELS[lead.replacement_difficulty ?? "unknown"];
                  const complexityLabel =
                    COMPLEXITY_LABELS[lead.website_complexity ?? "unknown"];

                  return (
                    <Link
                      key={lead.id}
                      href={`/businesses/${lead.id}`}
                      className="group flex min-h-[92px] items-start justify-between gap-3 rounded-[18px] border border-slate-200 bg-white p-3 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">
                          {lead.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatCategory(lead.category)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[0.68rem] font-medium uppercase tracking-[0.16em]">
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                            {gradeLabel}
                          </span>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                            {difficultyLabel}
                          </span>
                          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700">
                            {complexityLabel}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          {formatTimeAgo(lead.updated_at)}
                        </p>
                      </div>
                      <ArrowUpRight className="mt-1 size-4 shrink-0 text-slate-400 transition group-hover:text-slate-900" />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm text-slate-600">
                No prime targets yet.
              </div>
            )}
          </DashboardPanel>
        </div>

        <div className="grid min-h-0 gap-2 xl:grid-rows-[minmax(0,0.72fr)_minmax(0,1fr)]">
          <DashboardPanel
            title="Lead Fit"
            subtitle="How much of the flagged queue really matches the offer."
          >
            <div className="flex h-full min-h-0 flex-col gap-3">
              {fitRows.map((row) => {
                const width = row.value > 0 ? Math.max((row.value / Math.max(flaggedCount, 1)) * 100, 12) : 0;
                return (
                  <div key={row.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{row.label}</span>
                      <span className="font-semibold text-slate-950">{formatCompactNumber(row.value)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-slate-900"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </DashboardPanel>

          <DashboardPanel
            title="Queue"
            subtitle="Current build and sale state."
          >
            <div className="grid h-full min-h-0 gap-2">
              {queueRows.map((row) => {
                const Icon = row.icon;
                return (
                  <Link
                    key={row.label}
                    href={row.href}
                    className="group flex items-center justify-between rounded-[18px] border border-slate-200 bg-white px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-xl bg-slate-100 text-slate-900">
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{row.label}</p>
                        <p className="text-xs text-slate-500">{row.hint}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-slate-950">
                        {formatCompactNumber(row.value)}
                      </span>
                      <ArrowUpRight className="size-3.5 text-slate-400 transition group-hover:text-slate-900" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </DashboardPanel>
        </div>
      </div>
    </div>
  );
}
