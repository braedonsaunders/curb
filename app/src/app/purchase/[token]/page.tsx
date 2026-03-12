"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CheckCircle2, Download, ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PurchaseStatus = {
  businessName: string;
  customerSiteUrl: string | null;
  downloadUrl: string | null;
  mode: "handoff" | "managed";
  paidAt: string | null;
  publicToken: string;
  status:
    | "draft"
    | "payment-pending"
    | "paid"
    | "fulfilled"
    | "activation-failed"
    | "cancelled";
  updatedAt: string;
};

export default function PurchaseStatusPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const checkoutSessionId = searchParams.get("session_id");
  const [loading, setLoading] = useState(true);
  const [purchase, setPurchase] = useState<PurchaseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const res = await fetch(`/api/public-sales/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => null)) as
          | (PurchaseStatus & { error?: string })
          | null;

        if (!res.ok) {
          throw new Error(data?.error ?? "Failed to load purchase status");
        }

        if (cancelled) {
          return;
        }

        setPurchase(data as PurchaseStatus);
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load purchase status"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadStatus();
    const shouldPoll =
      checkoutSessionId &&
      (!purchase ||
        purchase.status === "payment-pending" ||
        purchase.status === "paid");
    if (!shouldPoll) {
      return () => {
        cancelled = true;
      };
    }

    const intervalId = window.setInterval(() => {
      void loadStatus();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [checkoutSessionId, purchase, token]);

  const statusLabel = (() => {
    if (!purchase) {
      return "Loading";
    }

    switch (purchase.status) {
      case "payment-pending":
        return "Waiting for payment";
      case "paid":
        return "Payment received";
      case "fulfilled":
        return "Ready";
      case "activation-failed":
        return "Needs manual follow-up";
      case "cancelled":
        return "Cancelled";
      default:
        return "Draft";
    }
  })();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (error || !purchase) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Purchase Not Available</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {error ?? "This purchase link could not be loaded."}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-6 py-14">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.22em] text-muted-foreground">
            Curb Purchase
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {purchase.businessName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Status: {statusLabel}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              {purchase.mode === "handoff"
                ? "Website File Delivery"
                : "Managed Launch"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {purchase.mode === "handoff" ? (
              <p className="text-muted-foreground">
                This purchase delivers a downloadable ZIP of the website files.
              </p>
            ) : (
              <p className="text-muted-foreground">
                This purchase includes managed hosting and launch automation. If
                the live site URL is available below, deployment has already
                completed.
              </p>
            )}

            {purchase.downloadUrl ? (
              <a href={purchase.downloadUrl}>
                <Button>
                  <Download className="size-4" />
                  Download Website ZIP
                </Button>
              </a>
            ) : null}

            {purchase.customerSiteUrl ? (
              <a
                href={purchase.customerSiteUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Button variant="outline">
                  <ExternalLink className="size-4" />
                  Open Live Site
                </Button>
              </a>
            ) : null}

            {!purchase.downloadUrl && !purchase.customerSiteUrl ? (
              <p className="text-muted-foreground">
                The post-payment workflow is still completing. This page will
                update automatically when the purchase is ready.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

