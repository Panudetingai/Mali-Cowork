import { createContext, useContext } from "react";
import type { SetupPlan, SetupScan, ToolId } from "./api";

export type InstallStatus = "waiting" | "running" | "done" | "failed" | "skipped";
export type InstallRow = { status: InstallStatus; log: string[]; error?: string };

export type Wizard = {
  scan?: SetupScan;
  rescan: () => Promise<SetupScan | undefined>;
  /** Agents the user picked to install. */
  selected: ToolId[];
  setSelected: (ids: ToolId[]) => void;
  plan?: SetupPlan;
  setPlan: (plan: SetupPlan | undefined) => void;
  installs: Partial<Record<ToolId, InstallRow>>;
  setInstalls: (fn: (prev: Wizard["installs"]) => Wizard["installs"]) => void;
  /** MCP servers to switch on at the end. */
  mcp: string[];
  setMcp: (ids: string[]) => void;
  /** Whether "Continue" is allowed on the current step. */
  setCanContinue: (ok: boolean) => void;
  next: () => void;
};

export const WizardContext = createContext<Wizard | null>(null);

export function useWizard() {
  const wizard = useContext(WizardContext);
  if (!wizard) throw new Error("useWizard outside the onboarding wizard");
  return wizard;
}
