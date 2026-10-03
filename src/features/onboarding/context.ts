import { createContext, useContext } from "react";
import type { SetupPlan, SetupScan, ToolId } from "./api";

export type InstallStatus = "waiting" | "running" | "done" | "failed" | "skipped";
export type InstallRow = { status: InstallStatus; log: string[]; error?: string };

export type Wizard = {
  scan?: SetupScan;
  /** The last scan failed (e.g. outside the desktop app). */
  scanError?: string;
  scanning: boolean;
  rescan: () => Promise<SetupScan | undefined>;
  /** Agents the user picked to install. */
  selected: ToolId[];
  setSelected: (ids: ToolId[]) => void;
  /** MCP servers to switch on once installed. */
  mcp: string[];
  setMcp: (ids: string[]) => void;
  plan?: SetupPlan;
  planError?: string;
  planning: boolean;
  replan: () => Promise<boolean>;
  installs: Partial<Record<ToolId, InstallRow>>;
  installing: boolean;
  retry: (tool: ToolId) => void;
  cancel: (tool: ToolId) => void;
  /** Close setup and open a page of the app. */
  leaveTo: (path: string) => void;
};

export const WizardContext = createContext<Wizard | null>(null);

export function useWizard() {
  const wizard = useContext(WizardContext);
  if (!wizard) throw new Error("useWizard outside the onboarding wizard");
  return wizard;
}
