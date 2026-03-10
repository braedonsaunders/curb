"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
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
  Upload,
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

type SiteEditorBinaryAsset = {
  name: string;
  path: string;
  size: number;
  modifiedAt: string | null;
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

function findFileNodeByPath(
  nodes: SiteEditorTreeNode[],
  targetPath: string | null
): Extract<SiteEditorTreeNode, { type: "file" }> | null {
  if (!targetPath) {
    return null;
  }

  for (const node of nodes) {
    if (node.type === "file" && node.path === targetPath) {
      return node;
    }

    if (node.type === "directory") {
      const childNode = findFileNodeByPath(node.children, targetPath);
      if (childNode) {
        return childNode;
      }
    }
  }

  return null;
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

function getFileExtension(filePath: string): string {
  const normalizedPath = filePath.toLowerCase();
  const slashIndex = normalizedPath.lastIndexOf("/");
  const dotIndex = normalizedPath.lastIndexOf(".");

  if (dotIndex === -1 || dotIndex < slashIndex) {
    return "";
  }

  return normalizedPath.slice(dotIndex);
}

function getCanonicalBinaryExtension(extension: string): string {
  if (extension === ".jpeg") {
    return ".jpg";
  }

  return extension;
}

function getBinaryUploadRules(filePath: string): {
  accept?: string;
  extensions: string[];
  label: string;
} {
  const extension = getCanonicalBinaryExtension(getFileExtension(filePath));

  if (extension === ".jpg") {
    return {
      accept: ".jpg,.jpeg",
      extensions: [".jpg"],
      label: ".jpg or .jpeg",
    };
  }

  if (!extension) {
    return {
      extensions: [],
      label: "a matching file",
    };
  }

  return {
    accept: extension,
    extensions: [extension],
    label: extension,
  };
}

function isPreviewableImageAsset(filePath: string): boolean {
  const extension = getCanonicalBinaryExtension(getFileExtension(filePath));

  return new Set([".avif", ".gif", ".jpg", ".png", ".webp"]).has(extension);
}

function buildSiteAssetUrl(
  siteSlug: string,
  relativePath: string,
  cacheKey: string | number
): string {
  const encodedPath = relativePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/sites/${encodeURIComponent(siteSlug)}/${encodedPath}?v=${encodeURIComponent(
    String(cacheKey)
  )}`;
}

function createBinaryAssetState(
  node: Extract<SiteEditorTreeNode, { type: "file" }>
): SiteEditorBinaryAsset {
  return {
    name: node.name,
    path: node.path,
    size: node.size,
    modifiedAt: null,
  };
}

function updateTreeFileSize(
  nodes: SiteEditorTreeNode[],
  targetPath: string,
  nextSize: number
): SiteEditorTreeNode[] {
  return nodes.map((node) => {
    if (node.type === "directory") {
      return {
        ...node,
        children: updateTreeFileSize(node.children, targetPath, nextSize),
      };
    }

    if (node.path !== targetPath) {
      return node;
    }

    return {
      ...node,
      size: nextSize,
    };
  });
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
  const [uploadingBinary, setUploadingBinary] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<SiteEditorFilePayload | null>(null);
  const [binaryFile, setBinaryFile] = useState<SiteEditorBinaryAsset | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    new Set()
  );
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [binaryPreviewNonce, setBinaryPreviewNonce] = useState(0);
  const selectedPathRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const dirty = file !== null && editorValue !== savedValue;
  const busy = saving || uploadingBinary;
  const binaryUploadRules = binaryFile
    ? getBinaryUploadRules(binaryFile.path)
    : null;
  const binaryPreviewUrl =
    binaryFile && isPreviewableImageAsset(binaryFile.path)
      ? buildSiteAssetUrl(
          siteSlug,
          binaryFile.path,
          `${binaryFile.modifiedAt ?? "current"}-${binaryPreviewNonce}`
        )
      : null;

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  const loadFile = useCallback(async (filePath: string) => {
    setLoadingFile(true);
    setEditorError(null);
    setBinaryFile(null);

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

      const preservedFile = findFileNodeByPath(payload.tree, selectedPathRef.current);
      if (preservedFile && !preservedFile.isText) {
        setSelectedPath(preservedFile.path);
        setBinaryFile(createBinaryAssetState(preservedFile));
        setFile(null);
        setEditorValue("");
        setSavedValue("");
        return;
      }

      const defaultPath =
        (preservedFile?.isText ? preservedFile.path : null) ||
        findFirstEditablePath(payload.tree);

      if (defaultPath) {
        await loadFile(defaultPath);
      } else {
        setSelectedPath(null);
        setFile(null);
        setBinaryFile(null);
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
      setSaving(false);
      setUploadingBinary(false);
      setSelectedPath(null);
      setFile(null);
      setBinaryFile(null);
      setEditorValue("");
      setSavedValue("");
      setExpandedDirectories(new Set());
      setBackupMessage(null);
      setEditorError(null);
      setBinaryPreviewNonce(0);
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
    if (!nextOpen && busy) {
      return;
    }

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
      setFile(null);
      setBinaryFile(createBinaryAssetState(node));
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

  function openBinaryUploadPicker() {
    uploadInputRef.current?.click();
  }

  async function handleBinaryUploadChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const uploadedFile = event.target.files?.[0];
    const currentBinaryFile = binaryFile;

    if (!uploadedFile || !currentBinaryFile) {
      return;
    }

    const uploadExtension = getCanonicalBinaryExtension(
      getFileExtension(uploadedFile.name)
    );
    if (
      binaryUploadRules &&
      binaryUploadRules.extensions.length > 0 &&
      !binaryUploadRules.extensions.includes(uploadExtension)
    ) {
      toast.error(
        `Choose ${binaryUploadRules.label} to replace this asset.`
      );
      event.target.value = "";
      return;
    }

    setUploadingBinary(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);

      const response = await fetch(
        `/api/businesses/${businessId}/site-editor?path=${encodeURIComponent(
          currentBinaryFile.path
        )}`,
        {
          method: "PUT",
          body: formData,
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
        throw new Error(payload.error || "Failed to replace asset.");
      }

      const nextBinaryFile = payload.file;

      setBinaryFile((previous) =>
        previous && previous.path === currentBinaryFile.path
          ? {
              ...previous,
              modifiedAt: nextBinaryFile.modifiedAt || previous.modifiedAt,
              size: nextBinaryFile.size || previous.size,
            }
          : previous
      );
      setTree((previous) =>
        updateTreeFileSize(previous, currentBinaryFile.path, nextBinaryFile.size)
      );
      setBinaryPreviewNonce((previous) => previous + 1);

      if (payload.backupPath) {
        setBackupMessage(
          payload.backupCreated
            ? `Backup created at ${payload.backupPath}`
            : `Backup available at ${payload.backupPath}`
        );
      }

      toast.success("Asset replaced");
      onSaved();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to replace asset.";
      toast.error(message);
    } finally {
      setUploadingBinary(false);
      event.target.value = "";
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
            disabled={busy}
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
        showCloseButton={!busy}
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
                Text files open in the editor. Binary assets can be replaced by upload.
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
                    : binaryFile
                      ? `${formatBytes(binaryFile.size)}${
                          binaryFile.modifiedAt
                            ? ` • Updated ${new Date(
                                binaryFile.modifiedAt
                              ).toLocaleString()}`
                            : ""
                        }`
                      : "Choose a text file from the tree to start editing."}
                </p>
              </div>
              {file ? (
                <Badge variant="outline">{file.language}</Badge>
              ) : binaryFile ? (
                <Badge variant="outline">Asset</Badge>
              ) : null}
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
              ) : binaryFile ? (
                <div className="flex h-full flex-col overflow-y-auto">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Replace asset</p>
                      <p className="text-xs text-muted-foreground">
                        Upload {binaryUploadRules?.label ?? "a matching file"} to
                        replace `{binaryFile.name}` in place.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={openBinaryUploadPicker}
                      disabled={uploadingBinary}
                    >
                      {uploadingBinary ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Upload className="size-4" />
                      )}
                      Replace file
                    </Button>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      className="hidden"
                      accept={binaryUploadRules?.accept}
                      onChange={handleBinaryUploadChange}
                    />
                  </div>

                  <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                    {binaryPreviewUrl ? (
                      <div className="relative h-[55vh] w-full max-w-4xl overflow-hidden rounded-xl border bg-muted/10 shadow-sm">
                        <Image
                          src={binaryPreviewUrl}
                          alt={binaryFile.name}
                          fill
                          unoptimized
                          sizes="(max-width: 1400px) 100vw, 896px"
                          className="object-contain bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.18),_transparent_56%),linear-gradient(180deg,rgba(248,250,252,0.95),rgba(241,245,249,0.9))]"
                        />
                      </div>
                    ) : (
                      <div className="max-w-md space-y-3 rounded-xl border bg-muted/10 p-6 text-center">
                        <ImageIcon className="mx-auto size-10 text-muted-foreground" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{binaryFile.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Preview is not available for this asset type, but you can
                            still replace the file in place.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
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
              disabled={busy}
            >
              Close
            </Button>
            <Button onClick={() => void handleSave()} disabled={!dirty || !file || busy}>
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
