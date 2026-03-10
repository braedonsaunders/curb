"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SiteFileEditor } from "@/components/site-file-editor";

type SiteEditorDialogProps = {
  businessId: string;
  siteSlug: string;
  siteVersion: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function SiteEditorDialog({
  businessId,
  siteSlug,
  siteVersion,
  open,
  onOpenChange,
  onSaved,
}: SiteEditorDialogProps) {
  function handleOpenChange(
    nextOpen: boolean,
    eventDetails?: { reason?: string }
  ) {
    if (!nextOpen && eventDetails) {
      return;
    }

    onOpenChange(nextOpen);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal
    >
      <DialogContent
        className="h-[88vh] w-[96vw] max-w-[min(96vw,1400px)] gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1400px)]"
        showCloseButton={false}
      >
        <SiteFileEditor
          filesApiPath={`/api/businesses/${businessId}/site-editor`}
          siteSlug={siteSlug}
          active={open}
          initialSiteVersion={siteVersion}
          className="h-full"
          onSaved={onSaved}
          onClose={() => handleOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
