"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Search,
  MapPin,
  Loader2,
  Star,
  Globe,
  ChevronDown,
  ChevronUp,
  Clock,
} from "lucide-react";

const CATEGORIES = [
  { id: "restaurants", label: "Restaurants & cafes" },
  { id: "trades", label: "Trades & contractors" },
  { id: "salons", label: "Salons & barbers" },
  { id: "auto", label: "Auto repair & detailing" },
  { id: "retail", label: "Retail & boutiques" },
  { id: "professional", label: "Professional services" },
  { id: "health", label: "Health & wellness" },
  { id: "fitness", label: "Fitness & gyms" },
  { id: "pets", label: "Pet services" },
  { id: "cleaning", label: "Cleaning services" },
];

interface DiscoveredBusiness {
  id: string;
  name: string;
  category: string;
  address: string;
  hasWebsite: boolean;
  rating: number;
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

export default function DiscoverPage() {
  const [location, setLocation] = useState("Hamilton, ON");
  const [radius, setRadius] = useState(15);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DiscoveredBusiness[] | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [pastRuns, setPastRuns] = useState<DiscoveryRun[]>([]);
  const [showPastRuns, setShowPastRuns] = useState(false);

  function toggleCategory(id: string) {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function selectAll() {
    setSelectedCategories(CATEGORIES.map((c) => c.id));
  }

  function clearAll() {
    setSelectedCategories([]);
  }

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

      if (!res.ok) throw new Error("Discovery failed");

      const data = await res.json();
      setResults(data.businesses ?? []);
      setNewCount(data.newCount ?? 0);

      if (data.run) {
        setPastRuns((prev) => [data.run, ...prev]);
      }

      toast.success(
        `Found ${data.businesses?.length ?? 0} businesses (${data.newCount ?? 0} new)`
      );
    } catch {
      toast.error("Discovery failed. Check your API keys in Settings.");
    } finally {
      setSearching(false);
    }
  }

  function renderStars(rating: number) {
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
                  {CATEGORIES.map((cat) => {
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
                          {new Date(run.timestamp).toLocaleString()}
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
                            {biz.category}
                          </Badge>
                        </div>
                        {biz.isNew && (
                          <Badge className="shrink-0 bg-green-600 text-white">
                            NEW
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {biz.address}
                      </p>
                      <div className="flex items-center justify-between">
                        {renderStars(biz.rating)}
                        {biz.hasWebsite ? (
                          <Badge variant="outline" className="gap-1">
                            <Globe className="size-3" />
                            Has website
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1 text-orange-600">
                            No website
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
