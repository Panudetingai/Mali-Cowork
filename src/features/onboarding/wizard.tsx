"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { setMcpConnected } from "@/features/mcp/store";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderIcon,
  TerminalIcon,
  WandSparklesIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { setupApi, isInstalled, type SetupPlan, type SetupScan, type ToolId } from "./api";
import { AGENTS, RECOMMENDED_MCP, type AgentChoice } from "./catalog";
import { useWizard, WizardContext, type InstallRow } from "./context";
import { finishOnboarding, FORCE_ONBOARDING, openOnboarding, useOnboarding } from "./store";
import { AgentIcon, Stagger, StepHeading, Terminal, ToolIcon } from "./ui";
import { CoworkBot } from "@/components/anim/cowork-bot";

type Step = "welcome" | "agents" | "plan" | "install" | "mcp" | "done";

/** In order, for the progress rail and for Back. */
const STEPS: { id: Step; label: string }[] = [
  { id: "welcome", label: "Check" },
  { id: "agents", label: "Agent" },
  { id: "plan", label: "Review" },
  { id: "install", label: "Install" },
  { id: "mcp", label: "Tools" },
  { id: "done", label: "Done" },
];

export function OnboardingDialog() {
  const { done, open } = useOnboarding();
  const [visible, setVisible] = useState(open || (!done && import.meta.env.DEV) || FORCE_ONBOARDING);

  useEffect(() => {
    if (open) setVisible(true);
  }, [open]);

  if (!visible && done) return null;
  return (
    <Dialog open={visible} onOpenChange={(v) => !v && setVisible(false)}>
      <DialogContent className="sm:max-w-xl" showCloseButton={false}>
        <OnboardingWizard onClose={() => setVisible(false)} />
      </DialogContent>
    </Dialog>
  );
}

function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [scan, setScan] = useState<SetupScan>();
  const [selected, setSelected] = useState<ToolId[]>(["opencode"]);
  const [plan, setPlan] = useState<SetupPlan>();
  const [installs, setInstalls] = useState<Partial<Record<ToolId, InstallRow>>>({});
  const [mcp, setMcp] = useState<string[]>(RECOMMENDED_MCP.filter((r) => r.recommended).map((r) => r.id));
  const [busy, setBusy] = useState(false);

  const rescan = useCallback(async () => {
    setBusy(true);
    try {
      const next = await setupApi.scan();
      setScan(next);
      return next;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void rescan();
  }, [rescan]);

  const goTo = useCallback((next: Step) => setStep(next), []);

  const runPlan = useCallback(async () => {
    const ids = selected.filter((id) => (scan ? !isInstalled(scan, id) : true));
    if (ids.length === 0) {
      setPlan({ steps: [], blocked: [] });
      return;
    }
    setBusy(true);
    try {
      const p = await setupApi.plan(ids);
      setPlan(p);
    } finally {
      setBusy(false);
    }
  }, [selected, scan]);

  const startInstall = useCallback(async () => {
    if (!plan) return;
    const initial: Partial<Record<ToolId, InstallRow>> = {};
    for (const s of plan.steps) initial[s.tool as ToolId] = { status: "waiting", log: [] };
    setInstalls(initial);

    for (const recipe of plan.steps) {
      const tool = recipe.tool as ToolId;
      setInstalls((prev) => ({ ...prev, [tool]: { ...prev[tool]!, status: "running", log: [] } }));
      try {
        await setupApi.install(tool, (line) => {
          setInstalls((prev) => {
            const row = prev[tool];
            return { ...prev, [tool]: { ...row!, log: [...row!.log, line] } };
          });
        });
        setInstalls((prev) => ({ ...prev, [tool]: { ...prev[tool]!, status: "done" } }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setInstalls((prev) => ({ ...prev, [tool]: { ...prev[tool]!, status: "failed", error: message } }));
      }
    }
    await rescan();
  }, [plan, rescan]);

  const enableMcp = useCallback(() => {
    for (const id of mcp) setMcpConnected(id, true);
  }, [mcp]);

  const finish = useCallback(() => {
    enableMcp();
    finishOnboarding();
    onClose();
  }, [enableMcp, onClose]);

  const canContinue = useMemo(() => {
    if (step === "welcome") return !busy && !!scan;
    if (step === "agents") return selected.length > 0;
    if (step === "plan") return !!plan;
    if (step === "install") {
      const rows = Object.values(installs);
      if (rows.length === 0) return true;
      return rows.every((i) => i?.status === "done" || i?.status === "failed" || i?.status === "skipped");
    }
    return true;
  }, [step, busy, scan, selected, plan, installs]);

  const next = useCallback(async () => {
    if (step === "welcome") goTo("agents");
    else if (step === "agents") {
      await runPlan();
      goTo("plan");
    } else if (step === "plan") {
      goTo("install");
      void startInstall();
    } else if (step === "install") goTo("mcp");
    else if (step === "mcp") goTo("done");
  }, [step, goTo, runPlan, startInstall]);

  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.id === step));
  // Installing writes to the machine, and "done" is past the point of return.
  const canGoBack = step === "agents" || step === "plan";
  const back = useCallback(() => {
    if (step === "plan") goTo("agents");
    else if (step === "agents") goTo("welcome");
  }, [step, goTo]);

  const wizard = useMemo(
    () => ({
      scan,
      rescan,
      selected,
      setSelected,
      plan,
      setPlan,
      installs,
      setInstalls,
      mcp,
      setMcp,
      setCanContinue: () => {},
      next,
    }),
    [scan, rescan, selected, plan, installs, mcp, next],
  );

  return (
    <WizardContext.Provider value={wizard}>
      <div className="flex min-h-[420px] flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <CoworkBot state={step === "done" ? "done" : "welcome"} size={56} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Setup · step {stepIndex + 1} of {STEPS.length} · {STEPS[stepIndex]!.label}
              </span>
              <StepRail index={stepIndex} />
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 py-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
            >
              {step === "welcome" && <WelcomeStep />}
              {step === "agents" && <AgentsStep />}
              {step === "plan" && <PlanStep />}
              {step === "install" && <InstallStep />}
              {step === "mcp" && <McpStep />}
              {step === "done" && <DoneStep />}
            </motion.div>
          </AnimatePresence>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {canGoBack && (
              <Button type="button" variant="ghost" onClick={back} className="gap-1 text-muted-foreground">
                <ChevronLeftIcon className="size-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step !== "done" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  finishOnboarding();
                  onClose();
                }}
                title="You can run this again from Settings"
              >
                Skip setup
              </Button>
            )}
            {step === "done" ? (
              <Button type="button" onClick={finish}>
                Start chatting
              </Button>
            ) : (
              <Button type="button" disabled={!canContinue || busy} onClick={next} className="gap-1">
                Continue
                <ChevronRightIcon className="size-4" />
              </Button>
            )}
          </div>
        </DialogFooter>
      </div>
    </WizardContext.Provider>
  );
}

/** Segments that fill as the wizard advances — cheaper to read than dots. */
function StepRail({ index }: { index: number }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {STEPS.map((item, i) => (
        <span
          key={item.id}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors duration-300",
            i < index ? "bg-primary/60" : i === index ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function WelcomeStep() {
  const { scan } = useWizard();
  const simulated = scan?.simulated;

  const tools = scan?.tools ?? [];
  const readyCount = tools.filter((t) => t.installed && !t.outdated).length;
  const progress = tools.length ? Math.round((readyCount / tools.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Welcome to Mali Cowork">
        An AI chat and coding agent that works on files in folders you allow.
      </StepHeading>

      {!scan ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" />
          Checking your system…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">System readiness</span>
              <span className="font-medium">{readyCount}/{tools.length}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className={cn(
                  "h-full rounded-full",
                  progress === 100 ? "bg-emerald-500" : "bg-primary",
                )}
              />
            </div>
          </div>

          <Stagger className="flex flex-col gap-2" delay={0.05}>
            {scan.tools.slice(0, 6).map((tool) => {
              const ok = tool.installed && !tool.outdated;
              return (
                <motion.div
                  key={tool.id}
                  layout
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                    ok
                      ? "border-emerald-200/60 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                      : "border-border bg-card hover:border-foreground/20",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg",
                      ok
                        ? "bg-white/80 dark:bg-black/20"
                        : "bg-muted/60",
                    )}
                  >
                    <ToolIcon id={tool.id as ToolId} size={18} />
                  </div>
                  <div className="flex min-w-0 flex-col leading-tight">
                    <span className="font-medium">{tool.name}</span>
                    {tool.version && (
                      <span className="text-xs text-muted-foreground">{tool.version}</span>
                    )}
                  </div>
                  <span className="flex-1" />
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      ok
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400"
                        : tool.outdated
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {ok ? "Installed" : tool.outdated ? "Update needed" : "Not found"}
                  </span>
                </motion.div>
              );
            })}
          </Stagger>

          {simulated && (
            <p className="rounded-lg border border-amber-200/60 bg-amber-50/40 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
              Simulated new-user mode (MALI_SIMULATE_NEW_USER=1). Nothing is really installed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AgentsStep() {
  const { scan, selected, setSelected } = useWizard();
  const toggle = (id: ToolId) => {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <div className="flex flex-col gap-4">
      <StepHeading title="Choose a local agent">
        Local agents can read and edit files in allowed folders. You can add more later in Settings.
      </StepHeading>
      <Stagger className="grid gap-3" delay={0.05}>
        {AGENTS.map((agent) => {
          const checked = selected.includes(agent.id);
          const installed = scan ? isInstalled(scan, agent.id) : false;
          return (
            <div
              key={agent.id}
              onClick={() => toggle(agent.id)}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                checked
                  ? "border-primary bg-primary/10 dark:border-primary/20 dark:bg-primary/20"
                  : "border-border bg-card hover:border-primary/20",
              )}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60">
                <AgentIcon id={agent.id} size={26} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{agent.name}</span>
                  {agent.recommended && (
                    <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                      Recommended
                    </span>
                  )}
                  {installed && (
                    <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                      Installed
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{agent.tagline}</p>
                <p className="text-xs text-muted-foreground/80">{agent.account}</p>
              </div>
              <span onClick={(e) => e.stopPropagation()}>
                <Switch checked={checked} onCheckedChange={() => toggle(agent.id)} aria-label={`Select ${agent.name}`} />
              </span>
            </div>
          );
        })}
      </Stagger>
    </div>
  );
}

function PlanStep() {
  const { plan } = useWizard();
  if (!plan) return null;

  return (
    <div className="flex flex-col gap-4">
      <StepHeading title="Review what will run">
        We install missing pieces only. Each line is a command that runs in a terminal on your machine.
      </StepHeading>

      <div className="flex max-h-64 flex-col gap-2 overflow-auto rounded-xl border border-border/70 bg-muted/20 p-3">
        {plan.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Everything you picked is already installed. Continue to enable recommended tools.
          </p>
        ) : (
          plan.steps.map((step) => (
            <div key={step.tool} className="rounded-lg border border-border/60 bg-background p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <TerminalIcon className="size-3.5 text-muted-foreground" />
                {step.display}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">via {step.via}</p>
            </div>
          ))
        )}
        {plan.blocked.map((b) => (
          <div
            key={b.tool}
            className="rounded-lg border border-red-200/60 bg-red-50/40 p-3 dark:border-red-900/50 dark:bg-red-950/20"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
              <XCircleIcon className="size-4" />
              {b.tool}
            </div>
            <p className="text-xs text-red-700/80 dark:text-red-400/80">{b.reason}</p>
            {b.helpUrl && (
              <a href={b.helpUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                Help
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function InstallStep() {
  const { installs, plan } = useWizard();
  const steps = plan?.steps ?? [];

  return (
    <div className="flex flex-col gap-4">
      <StepHeading title="Installing…">
        Please keep the app open. You may be asked for your password by the terminal if a command needs admin rights.
      </StepHeading>

      <Stagger className="grid gap-3" delay={0.05}>
        {steps.map((step) => {
          const state = installs[step.tool as ToolId];
          const status = state?.status ?? "waiting";
          return (
            <div key={step.tool} className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AgentIcon id={step.tool as AgentChoice["id"]} size={18} />
                  {step.display}
                </div>
                <StatusBadge status={status} />
              </div>
              {status === "running" && state && <Terminal lines={state.log} className="mt-2" />}
              {status === "failed" && state?.error && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{state.error}</p>
              )}
            </div>
          );
        })}
      </Stagger>
    </div>
  );
}

function StatusBadge({ status }: { status: InstallRow["status"] }) {
  if (status === "done") return <CheckCircleIcon className="size-4 text-emerald-600 dark:text-emerald-400" />;
  if (status === "failed") return <XCircleIcon className="size-4 text-red-500" />;
  if (status === "running") return <LoaderIcon className="size-4 animate-spin text-amber-500" />;
  if (status === "skipped") return <span className="text-xs text-muted-foreground">Skipped</span>;
  return <span className="text-xs text-muted-foreground">Waiting</span>;
}

function McpStep() {
  const { mcp, setMcp } = useWizard();
  const toggle = (id: string) => {
    setMcp(mcp.includes(id) ? mcp.filter((x) => x !== id) : [...mcp, id]);
  };

  return (
    <div className="flex flex-col gap-4">
      <StepHeading title="Recommended tools">
        MCP servers add skills to the agent. They're optional and you can turn them on or off later.
      </StepHeading>
      <Stagger className="grid gap-2" delay={0.05}>
        {RECOMMENDED_MCP.map((m) => {
          const checked = mcp.includes(m.id);
          return (
            <label
              key={m.id}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                checked
                  ? "border-primary bg-primary/10 dark:border-primary/20 dark:bg-primary/20"
                  : "border-border bg-card hover:border-primary/20",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium capitalize">{m.id.replace(/-/g, " ")}</span>
                  {m.recommended && (
                    <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                      Recommended
                    </span>
                  )}
                  <span
                    title={`Runs through ${m.needs}, installed in the previous step`}
                    className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    needs {m.needs}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{m.pitch}</p>
              </div>
              <span onClick={(e) => e.stopPropagation()}>
                <Switch checked={checked} onCheckedChange={() => toggle(m.id)} aria-label={`Enable ${m.id}`} />
              </span>
            </label>
          );
        })}
      </Stagger>
    </div>
  );
}

function DoneStep() {
  const { scan, selected, mcp } = useWizard();
  // The rescan after installing is the only honest answer to "can I use it
  // now?" — a step that says "all set" over a failed install is worse than no
  // step at all.
  const ready = selected.filter((id) => isInstalled(scan, id));
  const missing = selected.filter((id) => !isInstalled(scan, id));
  const allGood = missing.length === 0;

  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className={cn(
          "flex size-16 items-center justify-center rounded-full",
          allGood
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400",
        )}
      >
        {allGood ? <CheckCircleIcon className="size-8" /> : <XCircleIcon className="size-8" />}
      </motion.div>

      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold">
          {allGood ? "You're all set" : "Almost there"}
        </h3>
        <p className="text-sm text-muted-foreground">
          {allGood
            ? "Pick a folder in Cowork mode to let the agent work on your files, or just start chatting."
            : "Some pieces didn't install. You can finish them from Settings → Agents whenever you like."}
        </p>
      </div>

      <div className="flex w-full flex-col gap-1.5 text-left">
        {ready.map((id) => (
          <div
            key={id}
            className="flex items-center gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50/40 px-3 py-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20"
          >
            <ToolIcon id={id} size={16} />
            <span className="min-w-0 flex-1 truncate">{scan?.tools.find((t) => t.id === id)?.name ?? id}</span>
            <CheckCircleIcon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          </div>
        ))}
        {missing.map((id) => (
          <div
            key={id}
            className="flex items-center gap-2 rounded-lg border border-amber-200/60 bg-amber-50/40 px-3 py-2 text-sm dark:border-amber-900/50 dark:bg-amber-950/20"
          >
            <ToolIcon id={id} size={16} />
            <span className="min-w-0 flex-1 truncate">{scan?.tools.find((t) => t.id === id)?.name ?? id}</span>
            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">Not installed</span>
          </div>
        ))}
        {mcp.length > 0 && (
          <p className="px-1 pt-1 text-xs text-muted-foreground">
            {mcp.length} tool{mcp.length === 1 ? "" : "s"} will be switched on: {mcp.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

/** Button to reopen onboarding from Settings. */
export function OnboardingButton({ className }: { className?: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => openOnboarding()} className={cn("gap-1.5", className)}>
      <WandSparklesIcon className="size-4" />
      Run setup wizard
    </Button>
  );
}
