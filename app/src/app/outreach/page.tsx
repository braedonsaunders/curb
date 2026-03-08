"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatStoredDate } from "@/lib/datetime";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Mail,
  Loader2,
  Check,
  Send,
  ChevronDown,
  ChevronUp,
  Edit,
  CheckSquare,
} from "lucide-react";
import { buildMailtoUrl } from "@/lib/mailto";

interface EmailEntry {
  id: number;
  businessId: number;
  businessName: string;
  subject: string;
  body: string;
  toAddress: string | null;
  status: string;
  createdAt: string;
  sentAt: string | null;
}

const STATUS_FILTER_OPTIONS = ["all", "draft", "approved", "sent", "bounced"];
type EmailUpdate = Partial<Pick<EmailEntry, "subject" | "body" | "status" | "toAddress">>;

export default function OutreachPage() {
  const [emails, setEmails] = useState<EmailEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [editingEmail, setEditingEmail] = useState<EmailEntry | null>(null);
  const [editToAddress, setEditToAddress] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/emails?${params}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setEmails(data.emails ?? []);
    } catch {
      toast.error("Failed to load emails");
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchEmails();
  }, [fetchEmails]);

  function toggleExpand(id: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === emails.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(emails.map((e) => e.id)));
    }
  }

  async function updateEmail(
    emailId: number,
    updates: EmailUpdate,
    successMessage = "Email updated"
  ) {
    try {
      const res = await fetch(`/api/emails/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(successMessage);
      void fetchEmails();
    } catch {
      toast.error("Failed to update email");
    }
  }

  function openInMailApp(email: EmailEntry) {
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
    await updateEmail(emailId, { status: "sent" }, "Email marked as sent");
  }

  async function bulkApprove() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast.error("No emails selected");
      return;
    }

    try {
      const res = await fetch("/api/emails/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: ids }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(`${ids.length} email(s) approved`);
      setSelectedIds(new Set());
      void fetchEmails();
    } catch {
      toast.error("Bulk approve failed");
    }
  }

  const statusBadgeColor = (status: string) => {
    switch (status) {
      case "sent":
        return "bg-green-100 text-green-700 border-green-200";
      case "approved":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "bounced":
        return "bg-red-100 text-red-700 border-red-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Outreach</h1>
        <p className="text-muted-foreground">
          Review drafts and open them in your default desktop mail app
        </p>
      </div>

      {/* Filters + Bulk Actions */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={statusFilter} onValueChange={(val: string | null) => setStatusFilter(val ?? "all")}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            {selectedIds.size > 0 && (
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={bulkApprove}
              disabled={selectedIds.size === 0}
            >
              <CheckSquare className="size-4" />
              Bulk Approve
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Email Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : emails.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Mail className="size-8" />
              <p>No email drafts found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === emails.length && emails.length > 0}
                      onChange={toggleSelectAll}
                      className="size-4 rounded border-gray-300 accent-primary"
                    />
                  </TableHead>
                  <TableHead className="w-8" />
                  <TableHead>Business</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-52">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emails.map((email) => {
                  const isExpanded = expandedRows.has(email.id);
                  return (
                    <TableRow key={email.id} className="group">
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(email.id)}
                          onChange={() => toggleSelect(email.id)}
                          className="size-4 rounded border-gray-300 accent-primary"
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => toggleExpand(email.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{email.businessName}</TableCell>
                      <TableCell>
                        <div>
                          <p className="truncate max-w-xs">{email.subject}</p>
                          <p className="mt-1 truncate max-w-xs text-xs text-muted-foreground">
                            {email.toAddress ? `To: ${email.toAddress}` : "Add a recipient email"}
                          </p>
                          {isExpanded && (
                            <div className="mt-3 space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
                              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {email.toAddress ? `To: ${email.toAddress}` : "Recipient missing"}
                              </p>
                              <div className="whitespace-pre-wrap">{email.body}</div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeColor(
                            email.status
                          )}`}
                        >
                          {email.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatStoredDate(email.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                              setEditingEmail(email);
                              setEditToAddress(email.toAddress ?? "");
                              setEditSubject(email.subject);
                              setEditBody(email.body);
                              setEditOpen(true);
                            }}
                            aria-label="Edit email draft"
                          >
                            <Edit className="size-3.5" />
                          </Button>
                          {email.status === "draft" && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                updateEmail(email.id, { status: "approved" }, "Email approved")
                              }
                              aria-label="Approve email draft"
                            >
                              <Check className="size-3.5 text-blue-600" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => openInMailApp(email)}
                            disabled={!email.toAddress}
                            aria-label="Open draft in mail app"
                          >
                            <Mail className="size-3.5 text-slate-700" />
                          </Button>
                          {(email.status === "draft" || email.status === "approved") && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => markSent(email.id)}
                              aria-label="Mark email as sent"
                            >
                              <Send className="size-3.5 text-green-600" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
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
                rows={12}
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
                  setEditOpen(false);
                }
              }}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
