"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
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
  ShieldCheck,
  Smartphone,
  RefreshCw,
  Download,
  Mail,
  Check,
  Send,
  ChevronDown,
  ChevronUp,
  ScanSearch,
} from "lucide-react";

const STATUS_OPTIONS = [
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

const STATUS_COLORS: Record<string, string> = {
  discovered: "bg-gray-100 text-gray-700",
  audited: "bg-blue-50 text-blue-700",
  flagged: "bg-orange-50 text-orange-700",
  generated: "bg-green-50 text-green-700",
  reviewed: "bg-indigo-50 text-indigo-700",
  emailed: "bg-purple-50 text-purple-700",
  sold: "bg-emerald-50 text-emerald-700",
  skipped: "bg-slate-100 text-slate-600",
  archived: "bg-red-50 text-red-600",
};

interface AuditData {
  id: number;
  performance: number;
  accessibility: number;
  seo: number;
  grade: string;
  mobile: boolean | number;
  ssl: boolean | number;
  notes: string;
  performance_score: number;
  accessibility_score: number;
  seo_score: number;
  overall_grade: string;
  is_mobile_friendly: boolean | number;
  is_ssl: boolean | number;
  has_website: boolean | number;
  hasWebsite: boolean | number;
  created_at: string;
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

interface EmailDraft {
  id: number;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
  created_at: string;
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
  hours_json: string | null;
  photos_json: string | null;
  audits: AuditData[];
  generatedSites: SiteData[];
  emails: EmailDraft[];
}

export default function BusinessDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [biz, setBiz] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [regeneratePrompt, setRegeneratePrompt] = useState("");
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [editingEmail, setEditingEmail] = useState<EmailDraft | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editEmailOpen, setEditEmailOpen] = useState(false);
  const [expandedEmails, setExpandedEmails] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchBusiness();
  }, [id]);

  async function fetchBusiness() {
    setLoading(true);
    try {
      const res = await fetch(`/api/businesses/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data: BusinessDetail = await res.json();
      setBiz(data);
      setNotes(data.notes || "");
    } catch {
      toast.error("Failed to load business");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(status: string) {
    try {
      const res = await fetch(`/api/businesses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      setBiz((prev) => prev ? { ...prev, status } : prev);
      toast.success(`Status updated to ${status}`);
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

  async function regenerateSite() {
    setActionLoading("regenerate");
    try {
      const res = await fetch(`/api/businesses/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: regeneratePrompt || undefined }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Site regenerated");
      setRegenerateOpen(false);
      setRegeneratePrompt("");
      fetchBusiness();
    } catch {
      toast.error("Regeneration failed");
    } finally {
      setActionLoading(null);
    }
  }

  // Derived data from arrays
  const audit = biz?.audits?.[0] ?? null;
  const site = biz?.generatedSites?.[0] ?? null;
  const hours: Record<string, string> = (() => {
    try {
      return biz?.hours_json ? JSON.parse(biz.hours_json) : {};
    } catch {
      return {};
    }
  })();
  const photos: string[] = (() => {
    try {
      return biz?.photos_json ? JSON.parse(biz.photos_json) : [];
    } catch {
      return [];
    }
  })();

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
      fetchBusiness();
    } catch {
      toast.error("Failed to update email");
    }
  }

  async function approveEmail(emailId: number) {
    await updateEmail(emailId, { status: "approved" } as Partial<EmailDraft>);
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

  function scoreColor(score: number) {
    if (score >= 90) return "text-green-600";
    if (score >= 50) return "text-yellow-600";
    return "text-red-600";
  }

  function gradeColor(grade: string) {
    if (grade === "A") return "bg-green-100 text-green-700 border-green-300";
    if (grade === "B") return "bg-blue-100 text-blue-700 border-blue-300";
    if (grade === "C") return "bg-yellow-100 text-yellow-700 border-yellow-300";
    if (grade === "D") return "bg-orange-100 text-orange-700 border-orange-300";
    return "bg-red-100 text-red-700 border-red-300";
  }

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
        <Button variant="outline" onClick={() => router.push("/businesses")}>
          <ArrowLeft className="size-4" />
          Back to businesses
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={() => router.push("/businesses")}>
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
          <Select value={biz.status} onValueChange={(val: string | null) => { if (val) updateStatus(val); }}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
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
                    {photos.map((url, i) => (
                      <div
                        key={i}
                        className="aspect-square overflow-hidden rounded-lg bg-muted"
                      >
                        <img
                          src={url}
                          alt={`${biz.name} photo ${i + 1}`}
                          className="size-full object-cover"
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
              <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
                {/* Overall Grade */}
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-6">
                    <p className="mb-2 text-sm text-muted-foreground">Overall Grade</p>
                    <div
                      className={`flex size-20 items-center justify-center rounded-2xl border-2 text-4xl font-bold ${gradeColor(
                        audit.grade
                      )}`}
                    >
                      {audit.grade}
                    </div>
                  </CardContent>
                </Card>

                {/* Performance */}
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-6">
                    <p className="mb-2 text-sm text-muted-foreground">Performance</p>
                    <p className={`text-3xl font-bold ${scoreColor(audit.performance)}`}>
                      {audit.performance}
                    </p>
                    <p className="text-xs text-muted-foreground">/100</p>
                  </CardContent>
                </Card>

                {/* Accessibility */}
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-6">
                    <p className="mb-2 text-sm text-muted-foreground">Accessibility</p>
                    <p className={`text-3xl font-bold ${scoreColor(audit.accessibility)}`}>
                      {audit.accessibility}
                    </p>
                    <p className="text-xs text-muted-foreground">/100</p>
                  </CardContent>
                </Card>

                {/* SEO */}
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-6">
                    <p className="mb-2 text-sm text-muted-foreground">SEO</p>
                    <p className={`text-3xl font-bold ${scoreColor(audit.seo)}`}>
                      {audit.seo}
                    </p>
                    <p className="text-xs text-muted-foreground">/100</p>
                  </CardContent>
                </Card>

                {/* Badges + Notes */}
                <Card className="md:col-span-4">
                  <CardContent className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Smartphone className="size-4" />
                      <span className="text-sm">Mobile Friendly</span>
                      {audit.mobile ? (
                        <Badge className="bg-green-100 text-green-700">Yes</Badge>
                      ) : (
                        <Badge variant="destructive">No</Badge>
                      )}
                    </div>
                    <Separator orientation="vertical" className="h-6" />
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-4" />
                      <span className="text-sm">SSL</span>
                      {audit.ssl ? (
                        <Badge className="bg-green-100 text-green-700">Secure</Badge>
                      ) : (
                        <Badge variant="destructive">Not Secure</Badge>
                      )}
                    </div>
                    {audit.notes && (
                      <>
                        <Separator orientation="vertical" className="h-6" />
                        <p className="text-sm text-muted-foreground">{audit.notes}</p>
                      </>
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
                    Run an audit to analyze this business&apos;s web presence.
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
              Run Audit
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
                    Generated {new Date(site.generatedAt).toLocaleString()}
                  </span>
                  <div className="ml-auto flex gap-2">
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
                    <Dialog open={regenerateOpen} onOpenChange={setRegenerateOpen}>
                      <DialogTrigger
                        render={
                          <Button variant="outline" size="sm">
                            <RefreshCw className="size-4" />
                            Regenerate
                          </Button>
                        }
                      />
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Regenerate Site</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <Label>Custom prompt (optional)</Label>
                          <Textarea
                            value={regeneratePrompt}
                            onChange={(e) => setRegeneratePrompt(e.target.value)}
                            placeholder="Add specific instructions for the regeneration..."
                            rows={4}
                          />
                        </div>
                        <DialogFooter>
                          <Button
                            onClick={regenerateSite}
                            disabled={actionLoading === "regenerate"}
                          >
                            {actionLoading === "regenerate" ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <RefreshCw className="size-4" />
                            )}
                            Regenerate
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>

                <Card className="overflow-hidden p-0">
                  <iframe
                    src={`/sites/${site.slug}`}
                    className="h-[600px] w-full border-0"
                    title={`${biz.name} site preview`}
                  />
                </Card>
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
                      setRegenerateOpen(true);
                    }}
                    disabled={actionLoading === "regenerate"}
                  >
                    {actionLoading === "regenerate" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Globe className="size-4" />
                    )}
                    Generate Site
                  </Button>
                  <Dialog open={regenerateOpen} onOpenChange={setRegenerateOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Generate Site</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <Label>Custom prompt (optional)</Label>
                        <Textarea
                          value={regeneratePrompt}
                          onChange={(e) => setRegeneratePrompt(e.target.value)}
                          placeholder="Add specific instructions..."
                          rows={4}
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={regenerateSite}
                          disabled={actionLoading === "regenerate"}
                        >
                          {actionLoading === "regenerate" ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Globe className="size-4" />
                          )}
                          Generate
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Outreach Tab */}
        <TabsContent value="outreach">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Email Drafts</h3>
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
                                {new Date(email.createdAt).toLocaleDateString()}
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
                            <div className="rounded-lg bg-muted/50 p-4 text-sm whitespace-pre-wrap">
                              {email.body}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingEmail(email);
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
