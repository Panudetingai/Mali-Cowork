"use client";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_TIME_SAVED_RATES,
  resetTimeSavedRates,
  setTimeSavedRate,
  useTimeSavedRates,
} from "@/features/work-receipt";
import type { TimeSavedRates } from "@/features/work-receipt";
import { SectionHeader, SettingRow, SettingsGroup, SettingsPage } from "@/pages/settings/ui";
import { FilePenLineIcon, FilePlusIcon, PlugIcon, RotateCcwIcon, SquareTerminalIcon } from "lucide-react";
import type { ReactNode } from "react";

const RATES: { key: keyof TimeSavedRates; label: string; hint: string; icon: ReactNode; unit: string; sample: number }[] = [
  { key: "perFileCreated", label: "A file created", hint: "A brand-new file an agent writes for you.", icon: <FilePlusIcon />, unit: "file", sample: 3 },
  { key: "perFileModified", label: "A file edited", hint: "An existing file the agent changes.", icon: <FilePenLineIcon />, unit: "edit", sample: 5 },
  { key: "perCommand", label: "A command run", hint: "A shell command or script run on your behalf.", icon: <SquareTerminalIcon />, unit: "command", sample: 8 },
  { key: "perConnectorCall", label: "A connector call", hint: "One call to an MCP connector (Notion, Slack…).", icon: <PlugIcon />, unit: "call", sample: 4 },
];

function minutes(total: number) {
  if (total < 60) return `${Math.round(total * 10) / 10} min`;
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function ReceiptSettings() {
  const rates = useTimeSavedRates();
  const changed = RATES.some((r) => rates[r.key] !== DEFAULT_TIME_SAVED_RATES[r.key]);

  const setValue = (key: keyof TimeSavedRates, raw: string) => {
    const value = parseFloat(raw);
    if (Number.isFinite(value) && value >= 0) setTimeSavedRate(key, Number(value.toFixed(2)));
  };

  const total = RATES.reduce((sum, r) => sum + r.sample * rates[r.key], 0);

  return (
    <SettingsPage>
      <SectionHeader
        title="Work receipt"
        description="How the time-saved estimate on work receipts and weekly recaps is worked out. It’s always shown as an estimate, never an exact claim."
      />

      <SettingsGroup
        title="Minutes saved"
        description="What each thing the agent does is worth, in minutes of your time."
        actions={
          changed && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => resetTimeSavedRates()}>
              <RotateCcwIcon className="size-3.5" />
              Reset to defaults
            </Button>
          )
        }
      >
        {RATES.map((r) => (
          <SettingRow
            key={r.key}
            icon={r.icon}
            label={r.label}
            description={`${r.hint} Default ${DEFAULT_TIME_SAVED_RATES[r.key]}.`}
            control={
              <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={rates[r.key]}
                  onChange={(e) => setValue(r.key, e.target.value)}
                  aria-label={`Minutes saved per ${r.unit}`}
                  className="h-full w-16 bg-transparent px-2.5 text-right text-sm tabular-nums outline-none"
                />
                <span className="flex h-full items-center border-l border-border/70 bg-muted/50 px-2.5 text-xs text-muted-foreground">
                  min
                </span>
              </label>
            }
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="How it adds up" description="A sample session with these numbers, the way a receipt shows it.">
        <div className="py-3.5">
          {/* A paper receipt: dashed rules, figures on the right. */}
          <div className="max-w-sm rounded-xl border border-border/70 bg-card px-5 py-4 font-mono text-[12.5px] shadow-[0_8px_24px_-16px_rgb(0_0_0/0.35)]">
            <p className="text-center text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Work receipt · sample</p>
            <div className="my-3 border-t border-dashed border-border" />
            <ul className="flex flex-col gap-1.5">
              {RATES.map((r) => (
                <li key={r.key} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {r.sample} {r.unit}
                    {r.sample === 1 ? "" : "s"} × {rates[r.key]}
                  </span>
                  <span className="tabular-nums">{minutes(r.sample * rates[r.key])}</span>
                </li>
              ))}
            </ul>
            <div className="my-3 border-t border-dashed border-border" />
            <p className="flex items-baseline justify-between font-sans text-sm font-semibold">
              <span>Time saved (estimate)</span>
              <span className="tabular-nums">≈ {minutes(total)}</span>
            </p>
          </div>
        </div>
      </SettingsGroup>
    </SettingsPage>
  );
}
