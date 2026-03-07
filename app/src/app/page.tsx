"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatStoredDateTime } from "@/lib/datetime";
import { toast } from "sonner";
import {
  Search,
  FileText,
  Building2,
  Globe,
  Mail,
  ArrowRight,
  Loader2,
  TrendingUp,
} from "lucide-react";

interface Stats {
  pipeline: Record<string, number>;
  totalBusinesses: number;
  sitesGenerated: number;
  emailsSent: number;
  recentActivity: Array<{
    id: string;
    type: string;
    message: string;
    timestamp: string;
  }>;
}

const PIPELINE_STAGES = [
  { key: "discovered", label: "Discovered", color: "text-gray-700", bgColor: "bg-gray-100 border-gray-200" },
  { key: "audited", label: "Audited", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200" },
  { key: "flagged", label: "Flagged", color: "text-orange-700", bgColor: "bg-orange-50 border-orange-200" },
  { key: "generated", label: "Generated", color: "text-green-700", bgColor: "bg-green-50 border-green-200" },
  { key: "reviewed", label: "Reviewed", color: "text-indigo-700", bgColor: "bg-indigo-50 border-indigo-200" },
  { key: "emailed", label: "Emailed", color: "text-purple-700", bgColor: "bg-purple-50 border-purple-200" },
  { key: "sold", label: "Sold", color: "text-emerald-700", bgColor: "bg-emerald-50 border-emerald-200" },
] as const;

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      setStats(data);
    } catch {
      toast.error("Failed to load dashboard data");
      setStats({
        pipeline: {},
        totalBusinesses: 0,
        sitesGenerated: 0,
        emailsSent: 0,
        recentActivity: [],
      });
    } finally {
      setLoading(false);
    }
  }

  const pipeline = PIPELINE_STAGES.map((stage) => ({
    ...stage,
    count: stats?.pipeline?.[stage.key] ?? 0,
  }));

  const maxCount = Math.max(...pipeline.map((s) => s.count), 1);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your local business pipeline
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <Building2 className="size-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Businesses</p>
              <p className="text-2xl font-bold">{stats?.totalBusinesses ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-green-100 text-green-700">
              <Globe className="size-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Sites Generated</p>
              <p className="text-2xl font-bold">{stats?.sitesGenerated ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
              <Mail className="size-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Emails Sent</p>
              <p className="text-2xl font-bold">{stats?.emailsSent ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-4" />
            Pipeline Funnel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pipeline.map((stage, idx) => (
              <div key={stage.key} className="flex items-center gap-4">
                <div className="w-24 shrink-0 text-right">
                  <span className={`text-sm font-medium ${stage.color}`}>
                    {stage.label}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="relative h-8 w-full overflow-hidden rounded-md bg-muted/50">
                    <div
                      className={`absolute inset-y-0 left-0 flex items-center rounded-md border ${stage.bgColor} transition-all duration-500`}
                      style={{
                        width: `${Math.max((stage.count / maxCount) * 100, stage.count > 0 ? 8 : 0)}%`,
                        minWidth: stage.count > 0 ? "3rem" : "0",
                      }}
                    >
                      <span className={`px-2 text-sm font-semibold ${stage.color}`}>
                        {stage.count}
                      </span>
                    </div>
                  </div>
                </div>
                {idx < pipeline.length - 1 && (
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/40" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions + Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => router.push("/discover")}
            >
              <Search className="size-4" />
              New Discovery
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => router.push("/businesses")}
            >
              <Globe className="size-4" />
              Open Businesses
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => router.push("/businesses?status=generated")}
            >
              <FileText className="size-4" />
              Review Drafts
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.recentActivity && stats.recentActivity.length > 0 ? (
              <div className="space-y-3">
                {stats.recentActivity.slice(0, 10).map((item, i) => (
                  <div
                    key={item.id || i}
                    className="flex items-start gap-3 text-sm"
                  >
                    <div className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" />
                    <div className="flex-1">
                      <p className="text-foreground">{item.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatStoredDateTime(item.timestamp)}
                      </p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {item.type}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-muted-foreground">
                No recent activity. Start by discovering some businesses!
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
