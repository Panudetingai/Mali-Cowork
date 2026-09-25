"use client";

import { Button } from "@/components/ui/button";
import { OutputsList, requestWeeklyRecapOpen } from "@/features/work-receipt";
import { EmptyState, SectionHeader, SettingsSection } from "@/pages/settings/ui";
import { CalendarDaysIcon, FilesIcon } from "lucide-react";

export default function OutputsPage() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10">
      <SectionHeader
        title="Outputs"
        description="Files and documents your agents created, all in one place. Preview, reveal in Finder, or jump back to the chat that made them."
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

      <SettingsSection className="flex-1 min-h-0">
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
      </SettingsSection>
    </div>
  );
}
