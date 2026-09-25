"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_TIME_SAVED_RATES,
  resetTimeSavedRates,
  setTimeSavedRate,
  useTimeSavedRates,
} from "@/features/work-receipt";
import type { TimeSavedRates } from "@/features/work-receipt";
import {
  Field,
  GroupLabel,
  Notice,
  SectionHeader,
  SettingsSection,
} from "@/pages/settings/ui";
import { RotateCcwIcon } from "lucide-react";

const LABELS: Record<keyof TimeSavedRates, string> = {
  perFileCreated: "Minutes saved per file created",
  perFileModified: "Minutes saved per file modified",
  perCommand: "Minutes saved per command run",
  perConnectorCall: "Minutes saved per connector call",
};

const HINTS: Record<keyof TimeSavedRates, string> = {
  perFileCreated: "A brand-new file an agent writes for you.",
  perFileModified: "An existing file the agent edits.",
  perCommand: "A shell command or script the agent runs on your behalf.",
  perConnectorCall: "One call to an MCP connector (Notion, Slack, etc.).",
};

export function ReceiptSettings() {
  const rates = useTimeSavedRates();

  const setValue = (key: keyof TimeSavedRates, raw: string) => {
    const value = parseFloat(raw);
    if (Number.isFinite(value) && value >= 0) {
      setTimeSavedRate(key, Number(value.toFixed(2)));
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <SectionHeader
        title="Work receipt"
        description="How the time-saved estimate in work receipts and weekly recaps is calculated. These numbers are always shown as estimates, never exact claims."
      />

      <SettingsSection>
        <GroupLabel>Time-saved formula</GroupLabel>
        <Notice tone="info">
          The estimate is the sum of (created files × rate) + (modified files × rate) + (commands × rate) +
          (connector calls × rate). It is labeled “estimate” everywhere it appears.
        </Notice>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {(Object.keys(LABELS) as (keyof TimeSavedRates)[]).map((key) => (
            <Field key={key} label={LABELS[key]} hint={HINTS[key]}>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={rates[key]}
                onChange={(e) => setValue(key, e.target.value)}
                className="h-9"
              />
            </Field>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => resetTimeSavedRates()}
          >
            <RotateCcwIcon className="size-3.5" />
            Reset to defaults
          </Button>
          <span className="text-xs text-muted-foreground">
            Defaults: created {DEFAULT_TIME_SAVED_RATES.perFileCreated} · modified{" "}
            {DEFAULT_TIME_SAVED_RATES.perFileModified} · command{" "}
            {DEFAULT_TIME_SAVED_RATES.perCommand} · connector{" "}
            {DEFAULT_TIME_SAVED_RATES.perConnectorCall}
          </span>
        </div>
      </SettingsSection>
    </div>
  );
}
