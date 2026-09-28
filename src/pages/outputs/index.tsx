"use client";

import { Button } from "@/components/ui/button";
import { OutputsList, requestWeeklyRecapOpen } from "@/features/work-receipt";
import { EmptyState, SectionHeader } from "@/pages/settings/ui";
import { CalendarDaysIcon, FilesIcon } from "lucide-react";

export default function OutputsPage() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10">
      <SectionHeader
        title="Outputs"
        description="Every file your agents created. Click one to preview it, double-click to open it, or select several to tidy up — removing from the list keeps the file; Move to Trash can be put back."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => requestWeeklyRecapOpen()}
          >
            <CalendarDaysIcon className="size-4" />
            Weekly recap
          </Button>
        }
      />

      <OutputsList
        className="flex-1"
        empty={
          <EmptyState
            icon={<FilesIcon />}
            title="No outputs yet"
            description="Ask Cowork to create a file, slide deck, spreadsheet, or picture. When the turn finishes, it will show up here."
          />
        }
      />
    </div>
  );
}
