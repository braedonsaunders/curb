"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Key,
  MapPin,
  User,
  DollarSign,
  Loader2,
  Save,
  Eye,
  EyeOff,
} from "lucide-react";

interface SettingsData {
  apiKeys: {
    googlePlaces: string;
    pageSpeed: string;
    anthropic: string;
  };
  defaults: {
    location: string;
    radius: number;
    categories: string[];
  };
  outreach: {
    yourName: string;
    businessName: string;
    address: string;
    email: string;
  };
  pricing: {
    text: string;
  };
}

const DEFAULT_SETTINGS: SettingsData = {
  apiKeys: { googlePlaces: "", pageSpeed: "", anthropic: "" },
  defaults: { location: "Hamilton, ON", radius: 15, categories: [] },
  outreach: { yourName: "", businessName: "", address: "", email: "" },
  pricing: { text: "" },
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({
    googlePlaces: false,
    pageSpeed: false,
    anthropic: false,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setSettings({ ...DEFAULT_SETTINGS, ...data });
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  async function saveSection(section: string) {
    setSaving(section);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, data: (settings as unknown as Record<string, unknown>)[section] }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(null);
    }
  }

  function updateApiKey(key: keyof SettingsData["apiKeys"], value: string) {
    setSettings((prev) => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [key]: value },
    }));
  }

  function updateDefaults(key: keyof SettingsData["defaults"], value: string | number | string[]) {
    setSettings((prev) => ({
      ...prev,
      defaults: { ...prev.defaults, [key]: value },
    }));
  }

  function updateOutreach(key: keyof SettingsData["outreach"], value: string) {
    setSettings((prev) => ({
      ...prev,
      outreach: { ...prev.outreach, [key]: value },
    }));
  }

  function toggleKeyVisibility(key: string) {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function maskValue(value: string, visible: boolean) {
    if (visible || !value) return value;
    if (value.length <= 8) return "*".repeat(value.length);
    return value.slice(0, 4) + "*".repeat(value.length - 8) + value.slice(-4);
  }

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
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your API keys, defaults, and outreach information
        </p>
      </div>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="size-4" />
            API Keys
          </CardTitle>
          <CardDescription>
            API keys are stored locally and never shared
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(
            [
              { key: "googlePlaces" as const, label: "Google Places API Key" },
              { key: "pageSpeed" as const, label: "PageSpeed Insights API Key" },
              { key: "anthropic" as const, label: "Anthropic API Key" },
            ] as const
          ).map(({ key, label }) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={key}>{label}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id={key}
                    type={showKeys[key] ? "text" : "password"}
                    value={settings.apiKeys[key]}
                    onChange={(e) => updateApiKey(key, e.target.value)}
                    placeholder={`Enter your ${label.toLowerCase()}`}
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => toggleKeyVisibility(key)}
                >
                  {showKeys[key] ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => saveSection("apiKeys")}
              disabled={saving === "apiKeys"}
            >
              {saving === "apiKeys" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save API Keys
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="size-4" />
            Defaults
          </CardTitle>
          <CardDescription>
            Default values for discovery searches
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultLocation">Default Location</Label>
              <Input
                id="defaultLocation"
                value={settings.defaults.location}
                onChange={(e) => updateDefaults("location", e.target.value)}
                placeholder="City, Province"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultRadius">Default Radius (km)</Label>
              <Input
                id="defaultRadius"
                type="number"
                min={1}
                max={50}
                value={settings.defaults.radius}
                onChange={(e) => updateDefaults("radius", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="defaultCategories">Default Categories</Label>
            <p className="text-xs text-muted-foreground">
              Comma-separated list of default category IDs
            </p>
            <Input
              id="defaultCategories"
              value={settings.defaults.categories.join(", ")}
              onChange={(e) =>
                updateDefaults(
                  "categories",
                  e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
              placeholder="restaurants, trades, salons"
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => saveSection("defaults")}
              disabled={saving === "defaults"}
            >
              {saving === "defaults" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save Defaults
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Outreach Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="size-4" />
            Outreach Information
          </CardTitle>
          <CardDescription>
            Your contact details used in outreach emails (required for CASL compliance)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="yourName">Your Name</Label>
              <Input
                id="yourName"
                value={settings.outreach.yourName}
                onChange={(e) => updateOutreach("yourName", e.target.value)}
                placeholder="John Smith"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bizName">Business Name</Label>
              <Input
                id="bizName"
                value={settings.outreach.businessName}
                onChange={(e) => updateOutreach("businessName", e.target.value)}
                placeholder="Curb Digital"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="outreachAddress">Address</Label>
              <Input
                id="outreachAddress"
                value={settings.outreach.address}
                onChange={(e) => updateOutreach("address", e.target.value)}
                placeholder="123 Main St, Hamilton, ON"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="outreachEmail">Email</Label>
              <Input
                id="outreachEmail"
                type="email"
                value={settings.outreach.email}
                onChange={(e) => updateOutreach("email", e.target.value)}
                placeholder="hello@curb.digital"
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => saveSection("outreach")}
              disabled={saving === "outreach"}
            >
              {saving === "outreach" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save Outreach Info
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pricing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="size-4" />
            Pricing
          </CardTitle>
          <CardDescription>
            Pricing information included in outreach emails
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pricingText">Pricing Text</Label>
            <Textarea
              id="pricingText"
              value={settings.pricing.text}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  pricing: { text: e.target.value },
                }))
              }
              placeholder="e.g., Starting at $49/month for a professionally designed website with hosting, SSL, and ongoing updates."
              rows={4}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => saveSection("pricing")}
              disabled={saving === "pricing"}
            >
              {saving === "pricing" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save Pricing
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
