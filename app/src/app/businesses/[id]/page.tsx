"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  ArrowLeft,
  Star,
  MapPin,
  Phone,
  Globe,
  ExternalLink,
  Loader2,
  RefreshCw,
  Download,
  Mail,
  Check,
  Send,
  ChevronDown,
  ChevronUp,
  ScanSearch,
  Camera,
  CircleAlert,
  Sparkles,
  FileCode2,
} from "lucide-react";
import { SiteEditorDialog } from "@/components/site-editor-dialog";
import {
  BUSINESS_STATUSES,
  getBusinessStatusLabel,
  NOT_APPLICABLE_STATUS,
} from "@/lib/business-status";
import {
  formatStoredDate,
  formatStoredDateTime,
  formatStoredTime,
} from "@/lib/datetime";
import { buildMailtoUrl } from "@/lib/mailto";

const STATUS_OPTIONS = BUSINESS_STATUSES;

interface AuditData {
  id: number;
  grade: string | null;
  notes: string;
  summary: string;
  overall_grade: string | null;
  has_website: boolean | number;
  hasWebsite: boolean | number;
  url_reachable: boolean | number | null;
  urlReachable: boolean | number | null;
  owner_sentiment: "proud" | "mixed" | "embarrassed" | null;
  ownerSentiment: "proud" | "mixed" | "embarrassed" | null;
  screenshot_path: string | null;
  screenshotUrl: string | null;
  strengths_json: string | null;
  issues_json: string | null;
  website_complexity: string | null;
  websiteComplexity: string | null;
  replacement_difficulty: string | null;
  replacementDifficulty: string | null;
  advanced_features_json: string | null;
  advancedFeatures: string[];
  strengths: string[];
  issues: string[];
  created_at: string;
  createdAt: string;
}

interface SiteData {
  id: number;
  slug: string;
  version: number;
  generatedAt: string;
  created_at: string;
  prompt_used: string;
  site_path: string;
}

interface DomainVerificationChallenge {
  type: string;
  domain: string;
  value: string;
  reason: string;
}

interface SiteDeploymentData {
  id: number;
  generatedSiteId: number;
  deploymentKind: "preview" | "customer";
  vercelProjectId: string;
  vercelProjectName: string | null;
  vercelDeploymentId: string;
  vercelDeploymentUrl: string;
  aliasUrl: string | null;
  aliasHost: string | null;
  target: string;
  readyState: string | null;
  active: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EmailDraft {
  id: number;
  subject: string;
  body: string;
  toAddress: string | null;
  status: string;
  createdAt: string;
  created_at: string;
  sentAt: string | null;
}

interface BusinessDetail {
  id: number;
  name: string;
  category: string;
  address: string;
  city: string;
  phone: string;
  website_url: string;
  place_id: string;
  google_maps_url: string;
  rating: number;
  review_count: number;
  status: string;
  notes: string;
  email: string | null;
  customerDomain: string | null;
  customerDomainVerified: boolean;
  customerDomainVerification: DomainVerificationChallenge[];
  customerVercelProjectId: string | null;
  customerVercelProjectName: string | null;
  publicPreviewUrl: string | null;
  publicPreviewUrlSource: "vercel-alias" | "vercel-deployment" | "local";
  hours_json: string | null;
  photos_json: string | null;
  audits: AuditData[];
  generatedSites: SiteData[];
  emails: EmailDraft[];
  siteDeployments: SiteDeploymentData[];
}

interface GenerationActivity {
  id: number;
  kind: string;
  stage: string;
  message: string;
  createdAt: string;
}

const GENERATION_STAGE_ORDER = [
  "started",
  "assets",
  "crawl",
  "crawl_complete",
  "screenshots",
  "model",
  "write",
  "completed",
] as const;

const GENERATION_STAGE_LABELS: Record<string, string> = {
  started: "Starting",
  assets: "Assets",
  crawl: "Source Crawl",
  crawl_complete: "Content Ready",
  screenshots: "Screenshots",
  model: "AI Generation",
  write: "Writing Files",
  completed: "Done",
  failed: "Failed",
};

const TERMINAL_GENERATION_STAGES = new Set(["completed", "failed"]);
type SiteDialogMode = "generate" | "modify" | "regenerate";

function isTerminalGenerationStage(stage: string): boolean {
  return TERMINAL_GENERATION_STAGES.has(stage);
}

function extractLatestGenerationRun(
  recentActivity: GenerationActivity[]
): GenerationActivity[] {
  if (recentActivity.length === 0) {
    return [];
  }

  const latestRunDescending: GenerationActivity[] = [];
  for (const item of recentActivity) {
    if (
      latestRunDescending.length > 0 &&
      isTerminalGenerationStage(item.stage)
    ) {
      break;
    }
    latestRunDescending.push(item);
  }

  return latestRunDescending.slice().reverse();
}

function getBusinessesReturnHref(returnTo: string | null) {
  if (returnTo && returnTo.startsWith("/businesses")) {
    return returnTo;
  }

  return "/businesses";
}

const MIN_SITE_PREVIEW_LOADER_MS = 900;

function SitePreviewFrame({
  businessName,
  sitePreviewUrl,
  siteSlug,
}: {
  businessName: string;
  sitePreviewUrl: string | null;
  siteSlug: string;
}) {
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [minimumLoaderElapsed, setMinimumLoaderElapsed] = useState(false);
  const previewLoading = !iframeLoaded || !minimumLoaderElapsed;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setMinimumLoaderElapsed(true);
    }, MIN_SITE_PREVIEW_LOADER_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <Card className="relative overflow-hidden p-0">
      <div
        aria-hidden={!previewLoading}
        className={`absolute inset-0 z-10 transition-opacity duration-500 ${
          previewLoading ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,rgba(248,250,252,0.96),rgba(239,246,255,0.98),rgba(236,253,245,0.96))]">
          <div className="animate-site-preview-float absolute left-[-4rem] top-10 h-44 w-44 rounded-full bg-sky-300/25 blur-3xl" />
          <div className="animate-site-preview-float-delayed absolute bottom-6 right-[-2rem] h-56 w-56 rounded-full bg-emerald-300/25 blur-3xl" />

          <div className="relative flex h-full items-center justify-center p-6 sm:p-10">
            <div
              role="status"
              aria-live="polite"
              className="relative w-full max-w-4xl overflow-hidden rounded-[2rem] border border-slate-200/70 bg-white/75 p-4 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.45)] backdrop-blur-sm sm:p-6"
            >
              <div className="animate-site-preview-beam absolute inset-y-0 left-[-25%] w-[28%] bg-gradient-to-r from-transparent via-white/80 to-transparent" />

              <div className="mb-6 flex items-center gap-2">
                <span className="animate-site-preview-pulse h-2.5 w-2.5 rounded-full bg-rose-400/75" />
                <span
                  className="animate-site-preview-pulse h-2.5 w-2.5 rounded-full bg-amber-400/75"
                  style={{ animationDelay: "120ms" }}
                />
                <span
                  className="animate-site-preview-pulse h-2.5 w-2.5 rounded-full bg-emerald-400/75"
                  style={{ animationDelay: "240ms" }}
                />
                <div className="ml-3 h-3 flex-1 rounded-full bg-slate-200/80" />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(15rem,0.85fr)]">
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-[1.6rem] border border-slate-200/70 bg-white/85 p-5 shadow-sm">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                        <Sparkles className="size-5" />
                      </div>
                      <div className="space-y-2">
                        <div className="h-4 w-40 rounded-full bg-slate-200/90" />
                        <div className="h-3 w-28 rounded-full bg-slate-100" />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="h-24 rounded-3xl bg-slate-100/90" />
                      <div className="h-24 rounded-3xl bg-slate-100/90" />
                      <div className="h-24 rounded-3xl bg-slate-100/90" />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(13rem,0.9fr)]">
                    <div className="space-y-3 rounded-[1.5rem] border border-slate-200/70 bg-white/85 p-5 shadow-sm">
                      <div className="h-4 w-32 rounded-full bg-slate-200/90" />
                      <div className="h-3 w-full rounded-full bg-slate-100" />
                      <div className="h-3 w-5/6 rounded-full bg-slate-100" />
                      <div className="h-3 w-2/3 rounded-full bg-slate-100" />
                    </div>
                    <div className="rounded-[1.5rem] border border-dashed border-sky-200 bg-sky-50/80 p-5 shadow-sm">
                      <div className="mb-3 h-4 w-24 rounded-full bg-sky-200/80" />
                      <div className="space-y-2">
                        <div className="h-12 rounded-2xl bg-white/90" />
                        <div className="h-12 rounded-2xl bg-white/90" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[1.6rem] border border-slate-200/70 bg-slate-950 px-5 py-6 text-white shadow-[0_18px_55px_-28px_rgba(15,23,42,0.9)]">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                        <Globe className="size-5" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-white/90">
                          Rendering site preview
                        </p>
                        <p className="text-xs text-white/60">{businessName}</p>
                      </div>
                    </div>
                    <p className="text-sm leading-6 text-white/70">
                      Loading the latest generated version and preparing the
                      live preview canvas.
                    </p>
                  </div>

                  <div className="space-y-3 rounded-[1.5rem] border border-slate-200/70 bg-white/85 p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="h-4 w-24 rounded-full bg-slate-200/90" />
                      <div className="animate-site-preview-pulse rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-medium text-emerald-700">
                        Booting
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-3 w-full rounded-full bg-slate-100" />
                      <div className="h-3 w-4/5 rounded-full bg-slate-100" />
                      <div className="h-3 w-3/5 rounded-full bg-slate-100" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <iframe
        key={sitePreviewUrl}
        src={sitePreviewUrl ?? `/sites/${siteSlug}`}
        className={`h-[600px] w-full border-0 transition-opacity duration-500 ${
          previewLoading ? "opacity-0" : "opacity-100"
        }`}
        title={`${businessName} site preview`}
        sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts"
        onLoad={() => setIframeLoaded(true)}
      />
    </Card>
  );
}

export default function BusinessDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const businessesReturnHref = getBusinessesReturnHref(
    searchParams.get("returnTo")
  );

  const [biz, setBiz] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [regeneratePrompt, setRegeneratePrompt] = useState("");
  const [siteDialogMode, setSiteDialogMode] = useState<SiteDialogMode | null>(
    null
  );
  const [editingEmail, setEditingEmail] = useState<EmailDraft | null>(null);
  const [editToAddress, setEditToAddress] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editEmailOpen, setEditEmailOpen] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [generationActivity, setGenerationActivity] = useState<
    GenerationActivity[]
  >([]);
  const [generationActive, setGenerationActive] = useState(false);
  const [generationBaselineId, setGenerationBaselineId] = useState<number | null>(
    null
  );
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [siteEditorOpen, setSiteEditorOpen] = useState(false);
  const [sitePreviewNonce, setSitePreviewNonce] = useState(0);
  const [customerDomainDraft, setCustomerDomainDraft] = useState("");
  const siteDialogOpen = siteDialogMode !== null;

  const fetchBusiness = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/businesses/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Not found");
      const data: BusinessDetail = await res.json();
      setBiz(data);
      setNotes(data.notes || "");
      setCustomerDomainDraft(data.customerDomain || "");
    } catch {
      toast.error("Failed to load business");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchBusiness();
  }, [fetchBusiness]);

  const fetchGenerationActivity = useCallback(
    async ({
      baselineId = generationBaselineId,
      latestRunOnly = false,
    }: {
      baselineId?: number | null;
      latestRunOnly?: boolean;
    } = {}) => {
      const res = await fetch(
        `/api/activity?kind=generation&businessId=${id}&limit=25`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error("Failed to load generation activity");
      }

      const data = (await res.json()) as {
        recent?: GenerationActivity[];
      };
      const recent = Array.isArray(data.recent) ? data.recent : [];
      const chronological =
        baselineId == null
          ? latestRunOnly
            ? extractLatestGenerationRun(recent)
            : recent.slice().reverse()
          : recent.filter((item) => item.id > baselineId).slice().reverse();
      const latestItem =
        chronological.length > 0
          ? chronological[chronological.length - 1]
          : null;

      setGenerationActivity(chronological);
      setGenerationActive(
        latestItem ? !isTerminalGenerationStage(latestItem.stage) : baselineId != null
      );
      return recent;
    },
    [generationBaselineId, id]
  );

  useEffect(() => {
    const shouldPoll =
      siteDialogOpen && (actionLoading === "regenerate" || generationActive);
    if (!shouldPoll) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        await fetchGenerationActivity({
          baselineId:
            actionLoading === "regenerate" ? generationBaselineId : null,
          latestRunOnly: actionLoading !== "regenerate",
        });
        if (!cancelled) {
          setGenerationError(null);
        }
      } catch {
        if (!cancelled) {
          setGenerationError("Failed to load live generation progress");
        }
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    actionLoading,
    fetchGenerationActivity,
    generationActive,
    generationBaselineId,
    siteDialogOpen,
  ]);

  useEffect(() => {
    if (!siteDialogOpen || actionLoading === "regenerate") {
      return;
    }

    let cancelled = false;

    const loadCurrentGeneration = async () => {
      try {
        const recent = await fetchGenerationActivity({ latestRunOnly: true });
        if (cancelled) {
          return;
        }

        const latestRun = extractLatestGenerationRun(recent);
        const latestItem =
          latestRun.length > 0 ? latestRun[latestRun.length - 1] : null;
        const isActive =
          latestItem != null && !isTerminalGenerationStage(latestItem.stage);

        if (!isActive) {
          setGenerationActivity([]);
          setGenerationActive(false);
        }
        setGenerationError(null);
      } catch {
        if (!cancelled) {
          setGenerationError("Failed to load live generation progress");
        }
      }
    };

    void loadCurrentGeneration();

    return () => {
      cancelled = true;
    };
  }, [actionLoading, fetchGenerationActivity, siteDialogOpen]);

  async function updateStatus(status: string) {
    try {
      const res = await fetch(`/api/businesses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      setBiz((prev) => prev ? { ...prev, status } : prev);
      toast.success(`Status updated to ${getBusinessStatusLabel(status)}`);
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function saveNotes() {
    try {
      const res = await fetch(`/api/businesses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Notes saved");
    } catch {
      toast.error("Failed to save notes");
    }
  }

  async function runAudit() {
    setActionLoading("audit");
    try {
      const res = await fetch(`/api/businesses/${id}/audit`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      toast.success("Audit complete");
      fetchBusiness();
    } catch {
      toast.error("Audit failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function rerunEnrichment() {
    setActionLoading("enrichment");
    try {
      const res = await fetch("/api/enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rerun",
          businessIds: [Number(id)],
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

      if ((data.skippedInProgress ?? 0) > 0) {
        toast.error("This business is already being enriched");
      } else {
        toast.success("Business requeued for enrichment");
      }
      void fetchBusiness();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to rerun enrichment"
      );
    } finally {
      setActionLoading(null);
    }
  }

  async function regenerateSite() {
    setGenerationError(null);
    const requestedMode: SiteDialogMode =
      siteDialogMode ?? (site ? "regenerate" : "generate");
    try {
      const recentActivity = await fetchGenerationActivity({
        baselineId: null,
        latestRunOnly: true,
      }).catch(() => []);
      const latestRun = extractLatestGenerationRun(recentActivity);
      const latestRunItem =
        latestRun.length > 0 ? latestRun[latestRun.length - 1] : null;

      if (
        latestRunItem &&
        !isTerminalGenerationStage(latestRunItem.stage)
      ) {
        setGenerationActivity(latestRun);
        setGenerationActive(true);
        toast.error("Site generation is already in progress for this business");
        return;
      }

      setActionLoading("regenerate");
      setGenerationActive(true);

      const baselineId =
        recentActivity.length > 0 ? recentActivity[0]?.id ?? null : null;
      setGenerationBaselineId(baselineId);
      setGenerationActivity([]);

      const promptForRequest =
        requestedMode === "modify" || requestedMode === "generate"
          ? regeneratePrompt || undefined
          : undefined;

      const res = await fetch(`/api/businesses/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: requestedMode,
          prompt: promptForRequest,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        previewDeploymentError?: string | null;
        previewDeployment?: {
          aliasUrl?: string | null;
          deploymentUrl?: string | null;
        } | null;
      };
      if (!res.ok) {
        throw new Error(data.error || "Generation failed");
      }
      await fetchGenerationActivity({ baselineId }).catch(() => undefined);
      toast.success(
        requestedMode === "modify"
          ? "Site updated"
          : requestedMode === "regenerate"
            ? "Site regenerated"
            : "Site generated"
      );
      if (data.previewDeploymentError) {
        toast.error(`Public preview deploy failed: ${data.previewDeploymentError}`);
      } else if (data.previewDeployment) {
        const deployedUrl =
          data.previewDeployment.aliasUrl ||
          data.previewDeployment.deploymentUrl ||
          null;
        if (deployedUrl) {
          toast.success(`Public preview updated at ${deployedUrl}`);
        }
      }
      setSiteDialogMode(null);
      setRegeneratePrompt("");
      setGenerationActivity([]);
      setGenerationActive(false);
      setGenerationBaselineId(null);
      setGenerationError(null);
      await fetchBusiness();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Regeneration failed";
      setGenerationError(message);
      setGenerationActive(false);
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  }

  // Derived data from arrays
  const audit = biz?.audits?.[0] ?? null;
  const site = biz?.generatedSites?.[0] ?? null;
  const sitePreviewUrl = site
    ? `/sites/${site.slug}?v=${encodeURIComponent(
        `${site.version}-${site.generatedAt ?? site.created_at ?? ""}-${sitePreviewNonce}`
      )}`
    : null;
  const previewDeployment =
    biz?.siteDeployments?.find(
      (deployment) =>
        deployment.deploymentKind === "preview" && deployment.active
    ) ?? null;
  const customerDeployment =
    biz?.siteDeployments?.find(
      (deployment) =>
        deployment.deploymentKind === "customer" && deployment.active
    ) ?? null;
  const publicPreviewUrl = biz?.publicPreviewUrl ?? null;
  const hours: Record<string, string> = (() => {
    try {
      return biz?.hours_json ? JSON.parse(biz.hours_json) : {};
    } catch {
      return {};
    }
  })();
  const photos: Array<{ reference: string; url: string }> = (() => {
    try {
      const parsed = biz?.photos_json ? JSON.parse(biz.photos_json) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((reference) => String(reference).trim())
        .filter(Boolean)
        .map((reference) => ({
          reference,
          url:
            reference.startsWith("http://") ||
            reference.startsWith("https://")
              ? reference
              : `/api/place-photo?reference=${encodeURIComponent(reference)}&maxWidth=800`,
        }));
    } catch {
      return [];
    }
  })();
  const latestGenerationActivity =
    generationActivity.length > 0
      ? generationActivity[generationActivity.length - 1]
      : null;
  const generationRunning =
    actionLoading === "regenerate" || generationActive;
  const siteDialogShowsPrompt =
    siteDialogMode === "modify" || siteDialogMode === "generate";
  const siteDialogTitle =
    siteDialogMode === "modify"
      ? "Modify Site"
      : siteDialogMode === "regenerate"
        ? "Regenerate Site"
        : "Generate Site";
  const siteDialogPromptLabel =
    siteDialogMode === "modify"
      ? "Changes to make"
      : "Generation notes";
  const siteDialogPromptPlaceholder =
    siteDialogMode === "modify"
      ? "Describe what to change on the current site..."
      : "Add any specific direction for the next draft...";
  const siteDialogSubmitLabel =
    generationActive && actionLoading !== "regenerate"
      ? "Generation Running"
      : siteDialogMode === "modify"
        ? "Apply Changes"
        : siteDialogMode === "regenerate"
          ? "Regenerate Site"
          : "Generate Site";
  const generationStageIndex = latestGenerationActivity
    ? GENERATION_STAGE_ORDER.indexOf(
        latestGenerationActivity.stage as (typeof GENERATION_STAGE_ORDER)[number]
      )
    : -1;
  const generationProgressPercent =
    generationRunning
      ? Math.max(
          8,
          generationStageIndex >= 0
            ? Math.round(
                ((generationStageIndex + 1) / GENERATION_STAGE_ORDER.length) * 100
              )
            : 8
        )
      : latestGenerationActivity?.stage === "completed"
        ? 100
        : 0;

  async function exportSite() {
    try {
      const res = await fetch(`/api/businesses/${id}/export`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${site?.slug ?? "site"}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Site exported");
    } catch {
      toast.error("Export failed");
    }
  }

  async function saveCustomerDomain() {
    try {
      const res = await fetch(`/api/businesses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_domain: customerDomainDraft.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Customer domain saved");
      await fetchBusiness();
    } catch {
      toast.error("Failed to save customer domain");
    }
  }

  async function deployPreview() {
    setActionLoading("deployPreview");
    try {
      const res = await fetch(`/api/businesses/${id}/deploy-preview`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: string;
            deployment?: {
              aliasUrl?: string | null;
              deploymentUrl?: string | null;
            };
          }
        | null;
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to deploy preview");
      }
      const deployedUrl =
        data?.deployment?.aliasUrl || data?.deployment?.deploymentUrl || null;
      toast.success(
        deployedUrl
          ? `Preview deployed at ${deployedUrl}`
          : "Preview deployed"
      );
      await fetchBusiness();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to deploy preview"
      );
    } finally {
      setActionLoading(null);
    }
  }

  async function deployCustomerProject() {
    setActionLoading("deployCustomer");
    try {
      const res = await fetch(`/api/businesses/${id}/deploy-customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerDomain: customerDomainDraft.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: string;
            deployment?: {
              aliasUrl?: string | null;
              deploymentUrl?: string | null;
              customerDomain?: string | null;
              customerDomainVerified?: boolean;
            };
          }
        | null;
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to deploy customer site");
      }

      const deployedUrl =
        data?.deployment?.aliasUrl || data?.deployment?.deploymentUrl || null;
      if (
        data?.deployment?.customerDomain &&
        data.deployment.customerDomainVerified === false
      ) {
        toast.success(
          "Customer project deployed. Finish the DNS verification steps below before the custom domain will work."
        );
      } else {
        toast.success(
          deployedUrl
            ? `Customer site deployed at ${deployedUrl}`
            : "Customer site deployed"
        );
      }
      await fetchBusiness();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to deploy customer site"
      );
    } finally {
      setActionLoading(null);
    }
  }

  async function generateEmail() {
    setActionLoading("email");
    try {
      const res = await fetch(`/api/businesses/${id}/email`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      toast.success("Email draft generated");
      fetchBusiness();
    } catch {
      toast.error("Failed to generate email");
    } finally {
      setActionLoading(null);
    }
  }

  async function updateEmail(emailId: number, updates: Partial<EmailDraft>) {
    try {
      const res = await fetch(`/api/emails/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Email updated");
      void fetchBusiness();
    } catch {
      toast.error("Failed to update email");
    }
  }

  async function approveEmail(emailId: number) {
    await updateEmail(emailId, { status: "approved" } as Partial<EmailDraft>);
  }

  function openEmailDraft(email: EmailDraft) {
    const mailtoUrl = buildMailtoUrl({
      toAddress: email.toAddress,
      subject: email.subject,
      body: email.body,
    });

    if (!mailtoUrl) {
      toast.error("Add a recipient email before opening your mail app");
      return;
    }

    window.location.href = mailtoUrl;
    toast.success("Opening your default mail app");
  }

  async function markSent(emailId: number) {
    await updateEmail(emailId, { status: "sent" } as Partial<EmailDraft>);
  }

  function renderStars(rating: number) {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={`size-4 ${
              i <= rating
                ? "fill-yellow-400 text-yellow-400"
                : "text-gray-300"
            }`}
          />
        ))}
      </div>
    );
  }

  function gradeColor(grade: string) {
    if (grade === "A") return "bg-green-100 text-green-700 border-green-300";
    if (grade === "B") return "bg-blue-100 text-blue-700 border-blue-300";
    if (grade === "C") return "bg-yellow-100 text-yellow-700 border-yellow-300";
    if (grade === "D") return "bg-orange-100 text-orange-700 border-orange-300";
    return "bg-red-100 text-red-700 border-red-300";
  }

  function sentimentBadge(sentiment: AuditData["ownerSentiment"]) {
    if (sentiment === "proud") {
      return "bg-green-100 text-green-700";
    }
    if (sentiment === "mixed") {
      return "bg-yellow-100 text-yellow-700";
    }
    if (sentiment === "embarrassed") {
      return "bg-red-100 text-red-700";
    }
    return "bg-slate-100 text-slate-600";
  }

  function sentimentLabel(sentiment: AuditData["ownerSentiment"]) {
    if (sentiment === "proud") return "Proud";
    if (sentiment === "mixed") return "Mixed";
    if (sentiment === "embarrassed") return "Embarrassed";
    return "Unavailable";
  }

  function complexityBadge(complexity: AuditData["websiteComplexity"]) {
    if (complexity === "advanced") {
      return "bg-red-100 text-red-700";
    }
    if (complexity === "moderate") {
      return "bg-orange-100 text-orange-700";
    }
    if (complexity === "simple") {
      return "bg-green-100 text-green-700";
    }
    if (complexity === "none") {
      return "bg-slate-100 text-slate-600";
    }
    return "bg-slate-100 text-slate-600";
  }

  function complexityLabel(complexity: AuditData["websiteComplexity"]) {
    if (complexity === "advanced") return "Advanced";
    if (complexity === "moderate") return "Moderate";
    if (complexity === "simple") return "Simple";
    if (complexity === "none") return "No website";
    return "Unknown";
  }

  function difficultyBadge(difficulty: AuditData["replacementDifficulty"]) {
    if (difficulty === "hard") {
      return "bg-red-100 text-red-700";
    }
    if (difficulty === "medium") {
      return "bg-orange-100 text-orange-700";
    }
    if (difficulty === "easy") {
      return "bg-green-100 text-green-700";
    }
    return "bg-slate-100 text-slate-600";
  }

  function difficultyLabel(difficulty: AuditData["replacementDifficulty"]) {
    if (difficulty === "hard") return "Hard to replace";
    if (difficulty === "medium") return "Moderate effort";
    if (difficulty === "easy") return "Easy to replace";
    return "Unknown effort";
  }

  const generationProgressPanel =
    generationRunning ||
    generationActivity.length > 0 ||
    generationError ? (
      <div className="min-w-0 space-y-3 rounded-lg border bg-muted/30 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="break-words text-sm font-medium">
              {latestGenerationActivity?.message ||
                "Preparing website generation..."}
            </p>
            <p className="break-words text-xs text-muted-foreground">
              Building a production-ready site bundle from source content,
              screenshots, and business data.
            </p>
          </div>
          {generationRunning ? (
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-500"
            style={{ width: `${generationProgressPercent}%` }}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {GENERATION_STAGE_ORDER.map((stage, index) => {
            const completed = generationActivity.some(
              (item) => item.stage === stage
            );
            const active = latestGenerationActivity?.stage === stage;

            return (
              <div
                key={stage}
                className={`rounded-md border px-3 py-2 text-xs ${
                  active
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : completed
                      ? "border-green-300 bg-green-50 text-green-700"
                      : "border-border bg-background text-muted-foreground"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words">
                    {GENERATION_STAGE_LABELS[stage] ?? stage}
                  </span>
                  <span className="shrink-0">{index + 1}</span>
                </div>
              </div>
            );
          })}
        </div>

        {generationActivity.length > 0 ? (
          <div className="max-h-40 min-w-0 space-y-2 overflow-y-auto rounded-md border bg-background p-3 text-xs">
            {generationActivity.map((item) => (
              <div key={item.id} className="min-w-0 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words font-medium">
                    {GENERATION_STAGE_LABELS[item.stage] ?? item.stage}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatStoredTime(item.createdAt)}
                  </span>
                </div>
                <p className="break-words text-muted-foreground">
                  {item.message}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {generationError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {generationError}
          </div>
        ) : null}
      </div>
    ) : null;

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!biz) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Business not found</p>
        <Button
          variant="outline"
          onClick={() => router.push(businessesReturnHref)}
        >
          <ArrowLeft className="size-4" />
          Back to businesses
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push(businessesReturnHref)}
      >
        <ArrowLeft className="size-4" />
        Back
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{biz.name}</h1>
            <Badge variant="secondary">{biz.category}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {biz.address && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {biz.address}
              </span>
            )}
            {biz.phone && (
              <a
                href={`tel:${biz.phone}`}
                className="flex items-center gap-1 text-foreground hover:underline"
              >
                <Phone className="size-3.5" />
                {biz.phone}
              </a>
            )}
            {biz.rating > 0 && (
              <div className="flex items-center gap-1">
                {renderStars(biz.rating)}
                <span>({biz.review_count})</span>
              </div>
            )}
            {biz.place_id && (
              <a
                href={biz.google_maps_url || `https://www.google.com/maps/place/?q=place_id:${biz.place_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-600 hover:underline"
              >
                <ExternalLink className="size-3.5" />
                Google Maps
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void rerunEnrichment()}
            disabled={actionLoading === "enrichment"}
          >
            {actionLoading === "enrichment" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Rerun Enrichment
          </Button>
          <Button
            variant={biz.status === NOT_APPLICABLE_STATUS ? "secondary" : "outline"}
            size="sm"
            disabled={biz.status === NOT_APPLICABLE_STATUS}
            onClick={() => void updateStatus(NOT_APPLICABLE_STATUS)}
          >
            <Check className="size-4" />
            {biz.status === NOT_APPLICABLE_STATUS
              ? "Not Applicable"
              : "Mark Not Applicable"}
          </Button>
          <Select value={biz.status} onValueChange={(val: string | null) => { if (val) void updateStatus(val); }}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {getBusinessStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Info</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="site">Site</TabsTrigger>
          <TabsTrigger value="outreach">Outreach</TabsTrigger>
        </TabsList>

        {/* Info Tab */}
        <TabsContent value="info">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Business Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{biz.name}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Category</span>
                  <span>{biz.category}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Address</span>
                  <span>{biz.address || "--"}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">City</span>
                  <span>{biz.city || "--"}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone</span>
                  <span>
                    {biz.phone ? (
                      <a href={`tel:${biz.phone}`} className="text-blue-600 hover:underline">
                        {biz.phone}
                      </a>
                    ) : (
                      "--"
                    )}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Website</span>
                  <span>
                    {biz.website_url ? (
                      <a
                        href={biz.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {biz.website_url}
                      </a>
                    ) : (
                      "--"
                    )}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rating</span>
                  <div className="flex items-center gap-1">
                    {renderStars(biz.rating)}
                    <span className="text-muted-foreground">({biz.review_count})</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              {/* Hours */}
              {Object.keys(hours).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Hours</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableBody>
                        {Object.entries(hours).map(([day, h]) => (
                          <TableRow key={day}>
                            <TableCell className="font-medium capitalize">{day}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{h}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Notes */}
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={saveNotes}
                    placeholder="Add notes about this business..."
                    rows={4}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Photos */}
            {photos.length > 0 && (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Photos</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {photos.map((photo, i) => (
                      <div
                        key={photo.reference || i}
                        className="aspect-square overflow-hidden rounded-lg bg-muted"
                      >
                        <img
                          src={photo.url}
                          alt={`${biz.name} photo ${i + 1}`}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

          </div>
        </TabsContent>

        {/* Audit Tab */}
        <TabsContent value="audit">
          <div className="space-y-6">
            {audit ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-6">
                    <p className="mb-2 text-sm text-muted-foreground">Overall Grade</p>
                    <div
                      className={`flex size-20 items-center justify-center rounded-2xl border-2 text-4xl font-bold ${gradeColor(
                        audit.grade ?? "F"
                      )}`}
                    >
                      {audit.grade ?? "--"}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {audit.createdAt
                        ? formatStoredDateTime(audit.createdAt)
                        : ""}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="flex h-full flex-col justify-center gap-3 py-6">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Owner Sentiment</p>
                    </div>
                    <Badge className={sentimentBadge(audit.ownerSentiment)}>
                      {sentimentLabel(audit.ownerSentiment)}
                    </Badge>
                    <p className="text-sm text-muted-foreground">
                      Based on the screenshot, not technical audit scores.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="flex h-full flex-col justify-center gap-3 py-6">
                    <div className="flex items-center gap-2">
                      <CircleAlert className="size-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Website Status</p>
                    </div>
                    <Badge
                      className={
                        audit.hasWebsite
                          ? audit.urlReachable
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-600"
                      }
                    >
                      {audit.hasWebsite
                        ? audit.urlReachable
                          ? "Reachable"
                          : "Not reachable"
                        : "No website"}
                    </Badge>
                    <p className="text-sm text-muted-foreground">
                      {audit.hasWebsite
                        ? "Audit uses a live browser capture of the current site."
                        : "No live website was available to capture."}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="flex h-full flex-col justify-center gap-3 py-6">
                    <div className="flex items-center gap-2">
                      <Globe className="size-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Replacement Complexity</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={complexityBadge(audit.websiteComplexity)}>
                        {complexityLabel(audit.websiteComplexity)}
                      </Badge>
                      <Badge className={difficultyBadge(audit.replacementDifficulty)}>
                        {difficultyLabel(audit.replacementDifficulty)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {audit.advancedFeatures.length > 0
                        ? audit.advancedFeatures.join(", ")
                        : "No advanced site features were detected."}
                    </p>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-4">
                  <CardHeader>
                    <CardTitle>Audit Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {audit.summary || audit.notes || "No summary available."}
                    </p>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-3">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Camera className="size-4" />
                      Website Screenshot
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {audit.screenshotUrl ? (
                      <img
                        src={audit.screenshotUrl}
                        alt={`${biz.name} website screenshot`}
                        className="w-full rounded-xl border object-cover"
                      />
                    ) : (
                      <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                        No screenshot stored for this audit.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Strengths</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {audit.strengths.length > 0 ? (
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        {audit.strengths.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No strengths were captured for this audit.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="lg:col-span-4">
                  <CardHeader>
                    <CardTitle>Visible Problems</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {audit.issues.length > 0 ? (
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        {audit.issues.map((item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No visible issues were captured for this audit.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <ScanSearch className="mb-3 size-12 text-muted-foreground" />
                  <p className="mb-1 font-medium">No Audit Data</p>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Run a visual audit to capture the current website and have the LLM review the screenshot.
                  </p>
                </CardContent>
              </Card>
            )}
            <Button onClick={runAudit} disabled={actionLoading === "audit"}>
              {actionLoading === "audit" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ScanSearch className="size-4" />
              )}
              Run Visual Audit
            </Button>
          </div>
        </TabsContent>

        {/* Site Tab */}
        <TabsContent value="site">
          <div className="space-y-6">
            {site ? (
              <>
                <div className="flex flex-wrap items-center gap-4">
                  <Badge variant="secondary">Version {site.version}</Badge>
                  <span className="text-sm text-muted-foreground">
                    Generated {formatStoredDateTime(site.generatedAt)}
                  </span>
                  <div className="ml-auto flex gap-2">
                    {publicPreviewUrl && biz.publicPreviewUrlSource !== "local" ? (
                      <a
                        href={publicPreviewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm">
                          <ExternalLink className="size-4" />
                          Open Public Preview
                        </Button>
                      </a>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={deployPreview}
                      disabled={
                        generationRunning || actionLoading === "deployPreview"
                      }
                    >
                      {actionLoading === "deployPreview" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Globe className="size-4" />
                      )}
                      {previewDeployment ? "Redeploy Preview" : "Deploy Preview"}
                    </Button>
                    <a
                      href={`/sites/${site.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="size-4" />
                        Open in New Tab
                      </Button>
                    </a>
                    <Button variant="outline" size="sm" onClick={exportSite}>
                      <Download className="size-4" />
                      Export
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSiteEditorOpen(true)}
                      disabled={generationRunning}
                    >
                      <FileCode2 className="size-4" />
                      Edit Files
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRegeneratePrompt("");
                        setSiteDialogMode("modify");
                      }}
                      disabled={generationRunning}
                    >
                      <RefreshCw className="size-4" />
                      Modify
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRegeneratePrompt("");
                        setSiteDialogMode("regenerate");
                      }}
                      disabled={generationRunning}
                    >
                      <RefreshCw className="size-4" />
                      Regenerate
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Public Preview</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="space-y-1">
                        <p className="font-medium">Current public URL</p>
                        <p className="break-all text-muted-foreground">
                          {publicPreviewUrl ?? "Not deployed yet"}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Source:{" "}
                        {biz.publicPreviewUrlSource === "vercel-alias"
                          ? "Vercel alias"
                          : biz.publicPreviewUrlSource === "vercel-deployment"
                            ? "Direct Vercel deployment URL"
                            : "Local preview fallback"}
                      </p>
                      {previewDeployment ? (
                        <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
                          <p className="font-medium">Latest deployment</p>
                          <p className="break-all text-xs text-muted-foreground">
                            {previewDeployment.aliasUrl ||
                              previewDeployment.vercelDeploymentUrl}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            State: {previewDeployment.readyState ?? "Unknown"}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Deploy this site to the shared Vercel preview project
                          to replace the local-only preview link in outreach.
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Customer Project
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="space-y-2">
                        <Label htmlFor="customerDomain">Customer Domain</Label>
                        <Input
                          id="customerDomain"
                          value={customerDomainDraft}
                          onChange={(event) =>
                            setCustomerDomainDraft(event.target.value)
                          }
                          placeholder="www.customerdomain.com"
                        />
                        <p className="text-xs text-muted-foreground">
                          Optional. When set, Curb attaches the domain to the
                          dedicated customer project and returns any DNS
                          verification records that are still missing.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={saveCustomerDomain}
                          disabled={actionLoading === "deployCustomer"}
                        >
                          <Check className="size-4" />
                          Save Domain
                        </Button>
                        <Button
                          size="sm"
                          onClick={deployCustomerProject}
                          disabled={
                            generationRunning || actionLoading === "deployCustomer"
                          }
                        >
                          {actionLoading === "deployCustomer" ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Globe className="size-4" />
                          )}
                          {biz.customerVercelProjectId
                            ? "Redeploy Customer Site"
                            : "Create Customer Project"}
                        </Button>
                        {customerDeployment ? (
                          <a
                            href={
                              customerDeployment.aliasUrl ||
                              customerDeployment.vercelDeploymentUrl
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Button variant="outline" size="sm">
                              <ExternalLink className="size-4" />
                              Open Customer Site
                            </Button>
                          </a>
                        ) : null}
                      </div>

                      {biz.customerVercelProjectId ? (
                        <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
                          <p className="font-medium">
                            {biz.customerVercelProjectName || "Dedicated project"}
                          </p>
                          <p className="break-all text-xs text-muted-foreground">
                            Project ID: {biz.customerVercelProjectId}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Use this after a deal is closed and you want a
                          separate Vercel project for the live customer site.
                        </p>
                      )}

                      {biz.customerDomain &&
                      biz.customerDomainVerification.length > 0 &&
                      !biz.customerDomainVerified ? (
                        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                          <div className="flex items-start gap-2">
                            <CircleAlert className="mt-0.5 size-4" />
                            <div className="space-y-1">
                              <p className="font-medium">
                                DNS verification required for {biz.customerDomain}
                              </p>
                              {biz.customerDomainVerification.map((challenge) => (
                                <div
                                  key={`${challenge.type}-${challenge.domain}-${challenge.value}`}
                                  className="space-y-1 text-xs"
                                >
                                  <p>
                                    Add a {challenge.type} record on{" "}
                                    {challenge.domain}
                                  </p>
                                  <p className="break-all font-mono">
                                    {challenge.value}
                                  </p>
                                  {challenge.reason ? (
                                    <p>{challenge.reason}</p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : biz.customerDomain ? (
                        <p className="text-xs text-muted-foreground">
                          {biz.customerDomainVerified
                            ? `${biz.customerDomain} is verified on the customer project.`
                            : `${biz.customerDomain} is saved for the next customer deployment.`}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>

                <SitePreviewFrame
                  key={sitePreviewUrl ?? site.slug}
                  businessName={biz.name}
                  sitePreviewUrl={sitePreviewUrl}
                  siteSlug={site.slug}
                />
              </>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Globe className="mb-3 size-12 text-muted-foreground" />
                  <p className="mb-1 font-medium">No Site Generated</p>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Generate a site for this business to preview it here.
                  </p>
                  <Button
                    onClick={() => {
                      setRegeneratePrompt("");
                      setSiteDialogMode("generate");
                    }}
                    disabled={generationRunning}
                  >
                    {generationRunning ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Globe className="size-4" />
                    )}
                    Generate Site
                  </Button>
                </CardContent>
              </Card>
            )}

            <Dialog
              open={siteDialogOpen}
              onOpenChange={(open) => {
                if (actionLoading === "regenerate") {
                  return;
                }
                if (!open) {
                  setSiteDialogMode(null);
                  setGenerationActivity([]);
                  setGenerationActive(false);
                  setGenerationBaselineId(null);
                  setGenerationError(null);
                }
              }}
            >
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{siteDialogTitle}</DialogTitle>
                </DialogHeader>
                <div className="min-w-0 space-y-3">
                  {siteDialogShowsPrompt ? (
                    <>
                      <Label>{siteDialogPromptLabel} (optional)</Label>
                      <Textarea
                        value={regeneratePrompt}
                        onChange={(e) => setRegeneratePrompt(e.target.value)}
                        placeholder={siteDialogPromptPlaceholder}
                        rows={4}
                      />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Rebuild this site from the source website, screenshots, and
                      business data without applying prompt-based edits to the
                      current draft.
                    </p>
                  )}
                  {generationProgressPanel}
                </div>
                <DialogFooter>
                  <Button onClick={regenerateSite} disabled={generationRunning}>
                    {generationRunning ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : siteDialogMode === "generate" ? (
                      <Globe className="size-4" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {siteDialogSubmitLabel}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {site ? (
              <SiteEditorDialog
                businessId={id}
                siteSlug={site.slug}
                siteVersion={site.version}
                open={siteEditorOpen}
                onOpenChange={setSiteEditorOpen}
                onSaved={() => {
                  setSitePreviewNonce((current) => current + 1);
                }}
              />
            ) : null}
          </div>
        </TabsContent>

        {/* Outreach Tab */}
        <TabsContent value="outreach">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Email Drafts</h3>
                <p className="text-sm text-muted-foreground">
                  Open prefilled drafts in your default desktop mail app.
                </p>
              </div>
              <Button
                onClick={generateEmail}
                disabled={actionLoading === "email"}
                size="sm"
              >
                {actionLoading === "email" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                Generate Email
              </Button>
            </div>

            {biz.emails && biz.emails.length > 0 ? (
              <div className="space-y-3">
                {biz.emails.map((email) => {
                  const isExpanded = expandedEmails.has(email.id);
                  return (
                    <Card key={email.id}>
                      <CardContent className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="flex flex-1 items-start gap-2 text-left"
                            onClick={() => {
                              setExpandedEmails((prev) => {
                                const next = new Set(prev);
                                if (next.has(email.id)) next.delete(email.id);
                                else next.add(email.id);
                                return next;
                              });
                            }}
                          >
                            {isExpanded ? (
                              <ChevronUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            )}
                            <div>
                              <p className="font-medium">{email.subject}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatStoredDate(email.createdAt)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {email.toAddress
                                  ? `To: ${email.toAddress}`
                                  : "Add a recipient email"}
                              </p>
                            </div>
                          </button>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                email.status === "sent"
                                  ? "bg-green-100 text-green-700"
                                  : email.status === "approved"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {email.status}
                            </span>
                          </div>
                        </div>
                        {isExpanded && (
                          <>
                            <Separator />
                            <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {email.toAddress ? `To: ${email.toAddress}` : "Recipient missing"}
                              </p>
                              <div className="whitespace-pre-wrap">{email.body}</div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingEmail(email);
                                  setEditToAddress(email.toAddress ?? "");
                                  setEditSubject(email.subject);
                                  setEditBody(email.body);
                                  setEditEmailOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              {email.status === "draft" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => approveEmail(email.id)}
                                >
                                  <Check className="size-3.5" />
                                  Approve
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEmailDraft(email)}
                                disabled={!email.toAddress}
                              >
                                <Mail className="size-3.5" />
                                Open in Mail App
                              </Button>
                              {(email.status === "draft" || email.status === "approved") && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => markSent(email.id)}
                                >
                                  <Send className="size-3.5" />
                                  Mark Sent
                                </Button>
                              )}
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Mail className="mb-3 size-12 text-muted-foreground" />
                  <p className="mb-1 font-medium">No Email Drafts</p>
                  <p className="text-sm text-muted-foreground">
                    Generate an email draft to start outreach.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Edit Email Dialog */}
            <Dialog open={editEmailOpen} onOpenChange={setEditEmailOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Email</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>To</Label>
                    <Input
                      type="email"
                      value={editToAddress}
                      onChange={(e) => setEditToAddress(e.target.value)}
                      placeholder="owner@business.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Subject</Label>
                    <Input
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Body</Label>
                    <Textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={10}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={async () => {
                      if (editingEmail) {
                        await updateEmail(editingEmail.id, {
                          toAddress: editToAddress,
                          subject: editSubject,
                          body: editBody,
                        });
                        setEditEmailOpen(false);
                      }
                    }}
                  >
                    Save Changes
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
