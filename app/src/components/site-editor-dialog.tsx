"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  ImageIcon,
  Loader2,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading editor...
    </div>
  ),
});

type SiteEditorTreeNode =
  | {
      type: "directory";
      name: string;
      path: string;
      children: SiteEditorTreeNode[];
    }
  | {
      type: "file";
      name: string;
      path: string;
      size: number;
      isText: boolean;
      language: string;
    };

type SiteEditorFilePayload = {
  path: string;
  content: string;
  language: string;
  size: number;
  modifiedAt: string;
};

type SiteEditorDialogProps = {
  businessId: string;
  siteSlug: string;
  siteVersion: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

function findFirstEditablePath(nodes: SiteEditorTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file" && node.isText) {
      return node.path;
    }

    if (node.type === "directory") {
      const childPath = findFirstEditablePath(node.children);
      if (childPath) {
        return childPath;
      }
    }
  }

  return null;
}

function treeContainsPath(
  nodes: SiteEditorTreeNode[],
  targetPath: string | null
): boolean {
  if (!targetPath) {
    return false;
  }

  for (const node of nodes) {
    if (node.path === targetPath) {
      return true;
    }

    if (node.type === "directory" && treeContainsPath(node.children, targetPath)) {
      return true;
    }
  }

  return false;
}

function collectDirectoryAncestors(filePath: string): string[] {
  const segments = filePath.split("/").filter(Boolean);
  const expanded: string[] = [];

  for (let index = 1; index < segments.length; index += 1) {
    expanded.push(segments.slice(0, index).join("/"));
  }

  return expanded;
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(node: Extract<SiteEditorTreeNode, { type: "file" }>) {
  if (!node.isText) {
    return <ImageIcon className="size-4 shrink-0 text-muted-foreground" />;
  }

  if (node.language === "json") {
    return <FileJson className="size-4 shrink-0 text-muted-foreground" />;
  }

  if (node.language === "html" || node.language === "css" || node.language === "javascript" || node.language === "typescript" || node.language === "xml") {
    return <FileCode2 className="size-4 shrink-0 text-muted-foreground" />;
  }

  return <FileText className="size-4 shrink-0 text-muted-foreground" />;
}

export function SiteEditorDialog({
  businessId,
  siteSlug,
  siteVersion,
  open,
  onOpenChange,
  onSaved,
}: SiteEditorDialogProps) {
  const [tree, setTree] = useState<SiteEditorTreeNode[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<SiteEditorFilePayload | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    new Set()
  );
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [binaryFilePath, setBinaryFilePath] = useState<string | null>(null);
  const selectedPathRef = useRef<string | null>(null);

  const dirty = file !== null && editorValue !== savedValue;

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  const loadFile = useCallback(async (filePath: string) => {
    setLoadingFile(true);
    setEditorError(null);
    setBinaryFilePath(null);

    try {
      const response = await fetch(
        `/api/businesses/${businessId}/site-editor?path=${encodeURIComponent(filePath)}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        error?: string;
        file?: SiteEditorFilePayload;
      };

      if (!response.ok || !payload.file) {
        throw new Error(payload.error || "Failed to load file.");
      }

      const nextFile = payload.file;

      setSelectedPath(nextFile.path);
      setFile(nextFile);
      setEditorValue(nextFile.content);
      setSavedValue(nextFile.content);
      setExpandedDirectories((previous) => {
        const next = new Set(previous);
        for (const directoryPath of collectDirectoryAncestors(nextFile.path)) {
          next.add(directoryPath);
        }
        return next;
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load file.";
      setEditorError(message);
      toast.error(message);
    } finally {
      setLoadingFile(false);
    }
  }, [businessId]);

  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    setEditorError(null);

    try {
      const response = await fetch(`/api/businesses/${businessId}/site-editor`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        error?: string;
        tree?: SiteEditorTreeNode[];
      };

      if (!response.ok || !payload.tree) {
        throw new Error(payload.error || "Failed to load site files.");
      }

      setTree(payload.tree);
      setExpandedDirectories(
        new Set(
          payload.tree
            .filter((node) => node.type === "directory")
            .map((node) => node.path)
        )
      );

      const defaultPath =
        (treeContainsPath(payload.tree, selectedPathRef.current)
          ? selectedPathRef.current
          : null) ||
        findFirstEditablePath(payload.tree);

      if (defaultPath) {
        await loadFile(defaultPath);
      } else {
        setSelectedPath(null);
        setFile(null);
        setEditorValue("");
        setSavedValue("");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load site files.";
      setEditorError(message);
      toast.error(message);
    } finally {
      setLoadingTree(false);
    }
  }, [businessId, loadFile]);

  useEffect(() => {
    if (!open) {
      setTree([]);
      setSelectedPath(null);
      setFile(null);
      setEditorValue("");
      setSavedValue("");
      setExpandedDirectories(new Set());
      setBackupMessage(null);
      setEditorError(null);
      setBinaryFilePath(null);
      return;
    }

    void loadTree();
  }, [businessId, loadTree, open]);

  function canDiscardChanges(nextAction: string): boolean {
    if (!dirty) {
      return true;
    }

    return window.confirm(
      `You have unsaved changes. Discard them and ${nextAction}?`
    );
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !canDiscardChanges("close the editor")) {
      return;
    }

    onOpenChange(nextOpen);
  }

  async function handleFileSelection(node: SiteEditorTreeNode) {
    if (node.type === "directory") {
      setExpandedDirectories((previous) => {
        const next = new Set(previous);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });
      return;
    }

    if (!canDiscardChanges(`open ${node.name}`)) {
      return;
    }

    if (!node.isText) {
      setSelectedPath(node.path);
      setBinaryFilePath(node.path);
      setFile(null);
      setEditorValue("");
      setSavedValue("");
      return;
    }

    await loadFile(node.path);
  }

  async function handleSave() {
    if (!file || !dirty) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        `/api/businesses/${businessId}/site-editor?path=${encodeURIComponent(file.path)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: editorValue }),
        }
      );
      const payload = (await response.json()) as {
        error?: string;
        backupCreated?: boolean;
        backupPath?: string;
        file?: {
          modifiedAt: string;
          size: number;
        };
      };

      if (!response.ok || !payload.file) {
        throw new Error(payload.error || "Failed to save file.");
      }

      setSavedValue(editorValue);
      setFile((previous) =>
        previous
          ? {
              ...previous,
              content: editorValue,
              modifiedAt: payload.file?.modifiedAt || previous.modifiedAt,
              size: payload.file?.size || previous.size,
            }
          : previous
      );

      if (payload.backupPath) {
        setBackupMessage(
          payload.backupCreated
            ? `Backup created at ${payload.backupPath}`
            : `Backup available at ${payload.backupPath}`
        );
      }

      toast.success("File saved");
      onSaved();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save file.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function renderTree(nodes: SiteEditorTreeNode[], depth = 0): ReactNode {
    return nodes.map((node) => {
      const isExpanded =
        node.type === "directory" && expandedDirectories.has(node.path);
      const isSelected = selectedPath === node.path;

      return (
        <div key={node.path || node.name}>
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              isSelected
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-muted"
            }`}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            onClick={() => void handleFileSelection(node)}
          >
            {node.type === "directory" ? (
              <>
                {isExpanded ? (
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{node.name}</span>
              </>
            ) : (
              <>
                <span className="w-4 shrink-0" />
                {fileIcon(node)}
                <span className="truncate">{node.name}</span>
                {!node.isText ? (
                  <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Binary
                  </span>
                ) : null}
              </>
            )}
          </button>
          {node.type === "directory" && isExpanded ? (
            <div>{renderTree(node.children, depth + 1)}</div>
          ) : null}
        </div>
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="h-[88vh] w-[96vw] max-w-[min(96vw,1400px)] gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1400px)]"
        showCloseButton={!saving}
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4 pr-14">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium">Edit Site Files</h2>
              <Badge variant="secondary">Version {siteVersion}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Editing `{siteSlug}` in place. A backup is created automatically on
              the first save.
            </p>
          </div>
          {dirty ? <Badge variant="outline">Unsaved changes</Badge> : null}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r bg-muted/20">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-medium">Files</p>
              <p className="text-xs text-muted-foreground">
                Text files are editable. Binary assets are read-only.
              </p>
            </div>
            <div className="min-h-0 overflow-y-auto p-2">
              {loadingTree ? (
                <div className="flex h-full items-center justify-center py-12 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Loading files...
                </div>
              ) : tree.length > 0 ? (
                renderTree(tree)
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No site files found.
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {selectedPath || "Select a file"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {file
                    ? `${file.language} • ${formatBytes(file.size)} • Updated ${new Date(
                        file.modifiedAt
                      ).toLocaleString()}`
                    : binaryFilePath
                      ? "Binary file preview is not supported."
                      : "Choose a text file from the tree to start editing."}
                </p>
              </div>
              {file ? <Badge variant="outline">{file.language}</Badge> : null}
            </div>

            <div className="min-h-0 flex-1 bg-background">
              {loadingFile ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Loading file...
                </div>
              ) : editorError ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
                  {editorError}
                </div>
              ) : binaryFilePath ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  `{binaryFilePath}` is a binary asset. It can stay in the tree,
                  but edits here are limited to text files.
                </div>
              ) : file ? (
                <MonacoEditor
                  key={file.path}
                  path={file.path}
                  language={file.language}
                  value={editorValue}
                  onChange={(value) => setEditorValue(value ?? "")}
                  options={{
                    automaticLayout: true,
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    tabSize: 2,
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  Select a text file from the tree to open it in the editor.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-6 py-4">
          <p className="text-xs text-muted-foreground">
            {backupMessage || "Saving updates the live generated site preview."}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Close
            </Button>
            <Button onClick={() => void handleSave()} disabled={!dirty || !file || saving}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
