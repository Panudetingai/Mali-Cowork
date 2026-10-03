"use client";

import { Button } from "@/components/ui/button";
import { mergeMcpLive, syncMcpHub, syncMcpServers, useMcpLive } from "@/features/mcp";
import { setMcpConnected } from "@/features/mcp/store";
import { refreshOpencode, useOpencode } from "@/features/opencode";
import { listConfiguredProviders, useEnvKeys, useProviderConfigs } from "@/features/providers";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import {
  BellRingIcon,
  CpuIcon,
  FolderOpenIcon,
  KeyRoundIcon,
  LoaderIcon,
  MessageSquareTextIcon,
  PlugZapIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SquareIcon,
  TerminalIcon,
  WandSparklesIcon,
  WifiIcon,
  WifiOffIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { isInstalled, setupApi, type Recipe, type SetupPlan, type SetupScan, type ToolId } from "./api";
import { AGENTS, RECOMMENDED_MCP, runtimesFor, TOOL_WHY } from "./catalog";
import { useWizard, WizardContext, type InstallRow, type Wizard } from "./context";
import {
  clearNotchSetup,
  notifyNotchSetupDone,
  notifyNotchSetupInstall,
  notifyNotchSetupScan,
} from "./notch-setup";
import {
  BackButton,
  CheckGroup,
  CheckRow,
  EASE,
  MiniBadge,
  Note,
  OnboardingFrame,
  PrimaryButton,
  ProgressBar,
  ReadinessRing,
  GuideFeatureCard,
  SelectCard,
  StatusChip,
  STEPS,
  TextButton,
  type CheckState,
  type OnboardingStepId,
} from "./onboarding-ui";
import { dismissOnboarding, finishOnboarding, isOnboardingDone, openOnboarding } from "./store";
import { AgentIcon, Terminal, ToolIcon } from "./ui";

const AGENT_IDS = new Set<ToolId>(AGENTS.map((a) => a.id));

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Switch the picked MCP servers on and start them in Mali's hub. */
async function enableTools(ids: string[]) {
  if (ids.length === 0) return;
  for (const id of ids) setMcpConnected(id, true);
  try {
    await syncMcpServers();
    const result = await syncMcpHub(ids);
    if (result) mergeMcpLive(result.servers);
  } catch (error) {
    console.warn("[onboarding] couldn't start tools", error);
  }
}

export function OnboardingWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStepId>("check");
  const [dir, setDir] = useState(1);
  const [scan, setScan] = useState<SetupScan>();
  const [scanError, setScanError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<ToolId[]>(["opencode"]);
  const [mcp, setMcp] = useState<string[]>(RECOMMENDED_MCP.filter((r) => r.recommended).map((r) => r.id));
  const [plan, setPlan] = useState<SetupPlan>();
  const [planError, setPlanError] = useState<string>();
  const [planning, setPlanning] = useState(false);
  const [installs, setInstalls] = useState<Partial<Record<ToolId, InstallRow>>>({});
  const [installing, setInstalling] = useState(false);
  const cancelled = useRef(new Set<ToolId>());
  const toolsApplied = useRef(false);

  const leaveTo = useCallback(
    (path: string) => {
      if (isOnboardingDone()) dismissOnboarding();
      else finishOnboarding();
      clearNotchSetup();
      navigate(path, { replace: true });
    },
    [navigate],
  );

  /** `quiet` skips the notch (rescans after installing). */
  const rescan = useCallback(async (quiet = false) => {
    setScanning(true);
    setScanError(undefined);
    if (!quiet) notifyNotchSetupScan();
    try {
      const next = await setupApi.scan();
      setScan(next);
      return next;
    } catch (error) {
      setScanError(errorText(error));
      return undefined;
    } finally {
      setScanning(false);
      if (!quiet) clearNotchSetup();
    }
  }, []);

  useEffect(() => {
    void rescan();
    return () => clearNotchSetup();
  }, [rescan]);

  /** Agents plus the runtimes the picked tools run on, minus what's there. */
  const wanted = useMemo(() => {
    const ids = [...runtimesFor(mcp), ...selected];
    return [...new Set(ids)].filter((id) => !isInstalled(scan, id));
  }, [mcp, selected, scan]);

  const replan = useCallback(async () => {
    setPlanError(undefined);
    setPlan(undefined);
    if (wanted.length === 0) {
      setPlan({ steps: [], blocked: [] });
      return true;
    }
    setPlanning(true);
    try {
      setPlan(await setupApi.plan(wanted));
      return true;
    } catch (error) {
      setPlan(undefined);
      setPlanError(errorText(error));
      return false;
    } finally {
      setPlanning(false);
    }
  }, [wanted]);

  const installOne = useCallback(async (recipe: Recipe, progress: number) => {
    const tool = recipe.tool;
    cancelled.current.delete(tool);
    notifyNotchSetupInstall(recipe.display, "Downloading and installing…", progress);
    setInstalls((prev) => ({ ...prev, [tool]: { status: "running", log: [] } }));
    try {
      const next = await setupApi.install(tool, (line) => {
        const clipped = line.trim().slice(0, 120);
        if (clipped) notifyNotchSetupInstall(recipe.display, clipped, progress);
        setInstalls((prev) => {
          const row = prev[tool] ?? { status: "running" as const, log: [] };
          return { ...prev, [tool]: { ...row, log: [...row.log.slice(-200), line] } };
        });
      });
      setScan(next);
      setInstalls((prev) => ({ ...prev, [tool]: { ...prev[tool]!, status: "done" } }));
      return true;
    } catch (error) {
      const skipped = cancelled.current.has(tool);
      setInstalls((prev) => ({
        ...prev,
        [tool]: { ...prev[tool]!, status: skipped ? "skipped" : "failed", error: skipped ? undefined : errorText(error) },
      }));
      return false;
    }
  }, []);

  const afterInstall = useCallback(async () => {
    notifyNotchSetupInstall("Almost done", "Checking that everything works…", 100);
    await rescan(true);
    void refreshOpencode(true);
  }, [rescan]);

  const startInstall = useCallback(
    async (steps: Recipe[]) => {
      setInstalling(true);
      const waiting: InstallRow = { status: "waiting", log: [] };
      setInstalls(Object.fromEntries(steps.map((s) => [s.tool, waiting])) as Wizard["installs"]);
      for (const [i, recipe] of steps.entries()) {
        await installOne(recipe, Math.round(((i + 0.15) / steps.length) * 100));
      }
      await afterInstall();
      setInstalling(false);
    },
    [installOne, afterInstall],
  );

  const retry = useCallback(
    (tool: ToolId) => {
      const recipe = plan?.steps.find((s) => s.tool === tool);
      if (!recipe || installing) return;
      setInstalling(true);
      void installOne(recipe, 50)
        .then(afterInstall)
        .finally(() => setInstalling(false));
    },
    [plan, installing, installOne, afterInstall],
  );

  const cancel = useCallback((tool: ToolId) => {
    cancelled.current.add(tool);
    void setupApi.cancel(tool).catch(() => undefined);
  }, []);

  const goTo = useCallback((next: OnboardingStepId) => {
    setStep((current) => {
      const from = STEPS.findIndex((s) => s.id === current);
      const to = STEPS.findIndex((s) => s.id === next);
      setDir(to >= from ? 1 : -1);
      return next;
    });
  }, []);

  // Tools are switched on once their runtimes had the chance to install.
  useEffect(() => {
    if (step !== "verify" || toolsApplied.current) return;
    toolsApplied.current = true;
    clearNotchSetup();
    void enableTools(mcp);
    void refreshOpencode(true);
  }, [step, mcp]);

  const finish = useCallback(() => {
    notifyNotchSetupDone();
    leaveTo("/");
  }, [leaveTo]);

  const next = useCallback(async () => {
    if (step === "check") goTo("agents");
    else if (step === "agents") goTo("tools");
    else if (step === "tools") {
      goTo("plan");
      await replan();
    } else if (step === "plan") {
      if (plan && plan.steps.length > 0) {
        goTo("install");
        void startInstall(plan.steps);
      } else goTo("verify");
    } else if (step === "install") goTo("verify");
    else if (step === "verify") goTo("guide");
    else finish();
  }, [step, goTo, replan, plan, startInstall, finish]);

  const back = useCallback(() => {
    if (step === "agents") goTo("check");
    else if (step === "tools") goTo("agents");
    else if (step === "plan") goTo("tools");
    else if (step === "guide") goTo("verify");
  }, [step, goTo]);

  // Installing writes to the machine: no way back past it.
  const canGoBack = step === "agents" || step === "tools" || step === "plan" || step === "guide";

  const primary: { label: string; onClick?: () => void; disabled?: boolean; loading?: boolean } = (() => {
    switch (step) {
      case "check":
        if (scanError) return { label: "Check again", onClick: () => void rescan(), disabled: scanning };
        return { label: "Continue", disabled: !scan || scanning };
      case "agents":
        return { label: "Continue", disabled: selected.length === 0 };
      case "tools":
        return { label: "Review plan" };
      case "plan": {
        const n = plan?.steps.length ?? 0;
        return {
          label: n > 0 ? `Install ${n} item${n === 1 ? "" : "s"}` : "Continue",
          disabled: planning || !plan,
          loading: planning,
        };
      }
      case "install":
        return { label: installing ? "Installing…" : "Continue", loading: installing };
      case "verify":
        return { label: "Continue" };
      case "guide":
        return { label: "Start chatting" };
    }
  })();

  const wizard: Wizard = useMemo(
    () => ({
      scan,
      scanError,
      scanning,
      rescan: () => rescan(),
      selected,
      setSelected,
      mcp,
      setMcp,
      plan,
      planError,
      planning,
      replan,
      installs,
      installing,
      retry,
      cancel,
      leaveTo,
    }),
    [scan, scanError, scanning, rescan, selected, mcp, plan, planError, planning, replan, installs, installing, retry, cancel, leaveTo],
  );

  const footer = (
    <>
      <BackButton onClick={back} disabled={!canGoBack} />
      {step !== "guide" && step !== "install" && <TextButton onClick={() => leaveTo("/")}>Skip for now</TextButton>}
      <span className="flex-1" />
      <PrimaryButton
        onClick={primary.onClick ?? (() => void next())}
        disabled={primary.disabled}
        loading={primary.loading}
      >
        {primary.label}
      </PrimaryButton>
    </>
  );

  return (
    <WizardContext.Provider value={wizard}>
      <OnboardingFrame step={step} dir={dir} footer={footer}>
        {step === "check" && <CheckStep />}
        {step === "agents" && <AgentsStep />}
        {step === "tools" && <ToolsStep />}
        {step === "plan" && <PlanStep />}
        {step === "install" && <InstallStep />}
        {step === "verify" && <VerifyStep />}
        {step === "guide" && <GuideStep />}
      </OnboardingFrame>
    </WizardContext.Provider>
  );
}

/* ---------------------------------------------------------------- check */

type CheckItem = { id: string; group: "system" | "runtimes" | "agents"; title: string; icon: ReactNode } & (
  | { state: CheckState; detail?: string; label?: string }
  | { pending: true }
);

const PLATFORM_NAME = { macos: "macOS", windows: "Windows", linux: "Linux" } as const;

function CheckStep() {
  const { scan, scanError, scanning, rescan } = useWizard();
  const online = useOnline();
  const [revealed, setRevealed] = useState(0);

  const items = useMemo<CheckItem[]>(() => {
    const system: CheckItem[] = [
      {
        id: "platform",
        group: "system",
        title: "This computer",
        icon: <CpuIcon className="size-4 text-neutral-700" />,
        ...(scan ? { state: "ok" as const, detail: PLATFORM_NAME[scan.platform], label: "Supported" } : { pending: true as const }),
      },
      {
        id: "internet",
        group: "system",
        title: "Internet",
        icon: online ? <WifiIcon className="size-4 text-neutral-700" /> : <WifiOffIcon className="size-4 text-red-500" />,
        state: online ? "ok" : "error",
        detail: online ? "Needed to download agents and models" : "Offline — connect to download agents",
        label: online ? "Online" : "Offline",
      },
    ];
    if (!scan) {
      const placeholder = (id: ToolId, group: "runtimes" | "agents"): CheckItem => ({
        id,
        group,
        title: AGENTS.find((a) => a.id === id)?.name ?? TOOL_WHY[id],
        icon: <ToolIcon id={id} size={18} />,
        pending: true,
      });
      return [
        ...system,
        ...(["node", "git", "uv"] as ToolId[]).map((id) => placeholder(id, "runtimes")),
        ...AGENTS.map((a) => placeholder(a.id, "agents")),
      ];
    }
    const tools: CheckItem[] = scan.tools.map((tool) => {
      const agent = AGENT_IDS.has(tool.id);
      const ok = tool.installed && !tool.outdated;
      const state: CheckState = ok ? "ok" : tool.outdated ? "warn" : "missing";
      return {
        id: tool.id,
        group: agent ? "agents" : "runtimes",
        title: tool.name,
        icon: <ToolIcon id={tool.id} size={18} />,
        state,
        detail: ok
          ? [tool.version, TOOL_WHY[tool.id]].filter(Boolean).join(" · ")
          : tool.outdated
            ? `${tool.version ?? "Too old"} — needs version 20 or newer`
            : TOOL_WHY[tool.id],
        label: ok ? "Ready" : tool.outdated ? "Update" : agent ? "Not installed" : "Missing",
      };
    });
    return [...system, ...tools];
  }, [scan, online]);

  // Tick the rows off one after another, like a real check.
  useEffect(() => {
    if (!scan) {
      setRevealed(0);
      return;
    }
    setRevealed(0);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setRevealed(n);
      if (n >= items.length) clearInterval(id);
    }, 110);
    return () => clearInterval(id);
    // Re-run only for a fresh scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  const resolved = items.map((item, i) =>
    "pending" in item || (scan && i >= revealed) ? { ...item, shown: "checking" as CheckState } : { ...item, shown: item.state },
  );
  const done = !!scan && revealed >= items.length;
  const okCount = resolved.filter((r) => r.shown === "ok").length;
  const hasAgent = scan?.tools.some((t) => AGENT_IDS.has(t.id) && t.installed);

  const groups: { id: CheckItem["group"]; title: string }[] = [
    { id: "system", title: "System" },
    { id: "runtimes", title: "Runtimes" },
    { id: "agents", title: "Agents" },
  ];
  let index = -1;

  return (
    <div className="flex flex-col gap-5">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-5 rounded-3xl border border-neutral-200/80 bg-white/80 p-4 shadow-sm backdrop-blur-sm"
      >
        <ReadinessRing value={okCount} max={items.length} checking={!done && !scanError} />
        <div className="flex min-w-0 flex-col gap-1">
          <AnimatePresence mode="wait">
            <motion.p
              key={scanError ? "error" : done ? "done" : "checking"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="text-base font-semibold text-neutral-900"
            >
              {scanError ? "Couldn't check this computer" : done ? "Check complete" : "Looking around…"}
            </motion.p>
          </AnimatePresence>
          <p className="text-sm leading-relaxed text-neutral-600">
            {scanError
              ? "Setup only works in the Mali desktop app. Try again, or skip and set things up later in Settings."
              : !done
                ? "Finding runtimes and agents on this computer."
                : hasAgent
                  ? "You already have an agent, so setup will be quick."
                  : "No agent yet — Mali will install one for you in the next steps."}
          </p>
          {done && (
            <button
              type="button"
              onClick={() => void rescan()}
              disabled={scanning}
              className="mt-1 inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-neutral-700 hover:text-neutral-900 disabled:opacity-50"
            >
              <RefreshCwIcon className={cn("size-3.5", scanning && "animate-spin")} />
              Check again
            </button>
          )}
        </div>
      </motion.div>

      {scanError && (
        <Note tone="error" icon={<XCircleIcon className="size-4" />}>
          {scanError}
        </Note>
      )}
      {scan?.simulated && (
        <Note tone="warn">Simulated new-user mode (MALI_SIMULATE_NEW_USER=1) — nothing is really installed.</Note>
      )}

      {groups.map((group) => {
        const rows = resolved.filter((r) => r.group === group.id);
        if (rows.length === 0) return null;
        return (
          <CheckGroup key={group.id} title={group.title}>
            {rows.map((row) => {
              index += 1;
              const pending = row.shown === "checking";
              return (
                <motion.div
                  key={row.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03, duration: 0.3, ease: EASE }}
                >
                  <CheckRow
                    icon={row.icon}
                    title={row.title}
                    detail={pending ? "Checking…" : "pending" in row ? undefined : row.detail}
                    state={row.shown}
                    label={pending || "pending" in row ? undefined : row.label}
                  />
                </motion.div>
              );
            })}
          </CheckGroup>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- agents */

function AgentsStep() {
  const { scan, selected, setSelected } = useWizard();
  const toggle = (id: ToolId) =>
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {AGENTS.map((agent, i) => {
          const installed = isInstalled(scan, agent.id);
          return (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.35, ease: EASE }}
            >
              <SelectCard
                active={selected.includes(agent.id)}
                onClick={() => toggle(agent.id)}
                icon={<AgentIcon id={agent.id} size={22} />}
                title={agent.name}
                detail={agent.tagline}
                badge={
                  installed ? (
                    <StatusChip tone="ok">Installed</StatusChip>
                  ) : agent.recommended ? (
                    <MiniBadge>Recommended</MiniBadge>
                  ) : null
                }
                meta={agent.account}
              />
            </motion.div>
          );
        })}
      </div>
      <Note>Pick one or more. You can add or remove agents later in Settings → Agents.</Note>
    </div>
  );
}

/* ---------------------------------------------------------------- tools */

function ToolsStep() {
  const { scan, mcp, setMcp } = useWizard();
  const toggle = (id: string) => setMcp(mcp.includes(id) ? mcp.filter((x) => x !== id) : [...mcp, id]);
  const extra = runtimesFor(mcp).filter((id) => !isInstalled(scan, id));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {RECOMMENDED_MCP.map((m, i) => {
          const Icon = m.icon;
          const ready = isInstalled(scan, m.needs);
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.35, ease: EASE }}
            >
              <SelectCard
                active={mcp.includes(m.id)}
                onClick={() => toggle(m.id)}
                icon={<Icon className="size-[18px] text-neutral-800" />}
                title={m.name}
                detail={m.pitch}
                badge={m.recommended ? <MiniBadge>Pick</MiniBadge> : null}
                meta={
                  <span className="inline-flex items-center gap-1">
                    <span className={cn("size-1.5 rounded-full", ready ? "bg-emerald-500" : "bg-amber-400")} />
                    Runs on {m.needs === "uv" ? "uv" : "Node.js"}
                    {ready ? "" : " — installed for you"}
                  </span>
                }
              />
            </motion.div>
          );
        })}
      </div>
      <AnimatePresence>
        {extra.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Note tone="warn" icon={<PlugZapIcon className="size-4" />}>
              These tools need {extra.map((id) => (id === "uv" ? "uv" : "Node.js")).join(" and ")}, which will be added to the
              install plan.
            </Note>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- plan */

function PlanStep() {
  const { plan, planError, planning, replan, scan } = useWizard();

  if (planning || (!plan && !planError)) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-sm text-neutral-500">
        <LoaderIcon className="size-6 animate-spin text-neutral-900" />
        Working out what to install…
      </div>
    );
  }
  if (planError || !plan) {
    return (
      <Note
        tone="error"
        icon={<XCircleIcon className="size-4" />}
        action={
          <Button size="sm" variant="outline" onClick={() => void replan()}>
            Try again
          </Button>
        }
      >
        Couldn't make an install plan: {planError}
      </Note>
    );
  }

  const nameOf = (id: ToolId) => scan?.tools.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-3">
      {plan.steps.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-2 rounded-3xl border border-emerald-200/70 bg-emerald-50/60 px-6 py-8 text-center"
        >
          <ShieldCheckIcon className="size-8 text-emerald-600" />
          <p className="text-sm font-semibold text-neutral-900">Nothing to install</p>
          <p className="text-xs text-neutral-600">Everything you picked is already on this computer.</p>
        </motion.div>
      ) : (
        <ol className="relative flex flex-col gap-2.5">
          <span className="absolute bottom-6 left-[19px] top-6 w-px bg-neutral-200" aria-hidden />
          {plan.steps.map((step, i) => (
            <motion.li
              key={step.tool}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.07, duration: 0.35, ease: EASE }}
              className="relative flex items-start gap-3"
            >
              <span className="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-neutral-200">
                <ToolIcon id={step.tool} size={18} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-2xl border border-neutral-200/90 bg-neutral-50/80 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-neutral-900">
                    {i + 1}. {nameOf(step.tool)}
                  </span>
                  <StatusChip tone="muted">via {step.via}</StatusChip>
                </div>
                <code className="block select-text overflow-x-auto whitespace-pre rounded-lg bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-300">
                  <span className="select-none text-zinc-500">$ </span>
                  {step.display}
                </code>
              </div>
            </motion.li>
          ))}
        </ol>
      )}

      {plan.blocked.map((b) => (
        <Note
          key={b.tool}
          tone="error"
          icon={<XCircleIcon className="size-4" />}
          action={
            b.helpUrl ? (
              <a href={b.helpUrl} target="_blank" rel="noreferrer" className="shrink-0 font-semibold underline">
                Get it
              </a>
            ) : undefined
          }
        >
          <span className="font-semibold">{nameOf(b.tool)}:</span> {b.reason}
        </Note>
      ))}

      {plan.steps.length > 0 && (
        <Note icon={<TerminalIcon className="size-4" />}>
          Installs go to your user folder where possible, so no password is needed. You can stop any of them.
        </Note>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- install */

function InstallStep() {
  const { installs, plan, installing, retry, cancel, scan } = useWizard();
  const steps = plan?.steps ?? [];
  const rows = steps.map((s) => installs[s.tool]?.status ?? "waiting");
  const finished = rows.filter((s) => s === "done" || s === "failed" || s === "skipped").length;
  const failed = rows.filter((s) => s === "failed").length;
  const pct = steps.length ? Math.round((finished / steps.length) * 100) : 100;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-3xl border border-neutral-200/80 bg-white/80 p-4 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-neutral-900">
            {installing ? "Installing…" : failed ? `${failed} didn't install` : "All installed"}
          </span>
          <span className="tabular-nums text-neutral-500">
            {finished}/{steps.length}
          </span>
        </div>
        <ProgressBar value={pct} tone={failed && !installing ? "primary" : "dark"} />
      </div>

      <div className="flex flex-col gap-2">
        {steps.map((step, i) => {
          const row = installs[step.tool];
          const status = row?.status ?? "waiting";
          const name = scan?.tools.find((t) => t.id === step.tool)?.name ?? step.tool;
          return (
            <motion.div
              key={step.tool}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3, ease: EASE }}
              className={cn(
                "overflow-hidden rounded-2xl border p-3 transition-colors",
                status === "running" && "border-neutral-300 bg-white shadow-sm",
                status === "done" && "border-emerald-200/70 bg-emerald-50/50",
                status === "failed" && "border-red-200/70 bg-red-50/40",
                (status === "waiting" || status === "skipped") && "border-neutral-200/90 bg-neutral-50/80",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-neutral-200/80">
                  <ToolIcon id={step.tool} size={18} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-sm font-semibold text-neutral-900">{name}</span>
                  <span className="truncate font-mono text-[11px] text-neutral-500">{step.display}</span>
                </div>
                {status === "running" && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => cancel(step.tool)}>
                    <SquareIcon className="size-3" />
                    Stop
                  </Button>
                )}
                {(status === "failed" || status === "skipped") && !installing && (
                  <Button size="sm" variant="outline" className="h-7 gap-1 bg-white text-xs" onClick={() => retry(step.tool)}>
                    <RotateCcwIcon className="size-3" />
                    Retry
                  </Button>
                )}
                <InstallMark status={status} />
              </div>
              <AnimatePresence initial={false}>
                {status === "running" && row && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                  >
                    <Terminal lines={row.log} className="mt-3 max-h-36 text-[10.5px]" />
                  </motion.div>
                )}
              </AnimatePresence>
              {status === "failed" && row?.error && <p className="mt-2 text-xs leading-relaxed text-red-600">{row.error}</p>}
            </motion.div>
          );
        })}
      </div>

      {!installing && failed > 0 && (
        <Note tone="warn">You can continue anyway and finish these later from Settings → Agents.</Note>
      )}
    </div>
  );
}

function InstallMark({ status }: { status: InstallRow["status"] }) {
  const state: CheckState =
    status === "done" ? "ok" : status === "failed" ? "error" : status === "running" ? "checking" : "missing";
  const label = { done: "Done", failed: "Failed", running: "Installing", skipped: "Stopped", waiting: "Waiting" }[status];
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-neutral-500">
      <span className="hidden sm:inline">{label}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 26 }}
          className={cn(
            "flex size-5 items-center justify-center rounded-full",
            state === "ok" && "bg-emerald-500 text-white",
            state === "error" && "bg-red-500 text-white",
            state === "missing" && "bg-neutral-200",
          )}
        >
          {state === "checking" && <LoaderIcon className="size-4 animate-spin text-neutral-900" />}
          {state === "ok" && <ShieldCheckIcon className="size-3" />}
          {state === "error" && <XCircleIcon className="size-3" />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ---------------------------------------------------------------- verify */

function VerifyStep() {
  const { scan, scanning, selected, mcp, leaveTo } = useWizard();
  const opencode = useOpencode();
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const live = useMcpLive();
  const [codex, setCodex] = useState<{ state: "idle" | "busy" | "done" | "error"; text?: string }>({ state: "idle" });

  const agents = AGENTS.filter((a) => selected.includes(a.id));
  const anyAgent = AGENTS.some((a) => isInstalled(scan, a.id));
  const modelCount =
    listConfiguredProviders(configs, envKeys).reduce((n, p) => n + p.models.length, 0) +
    (opencode.models?.models.length ?? 0);
  const modelsChecking = opencode.loading;
  const ready = anyAgent && (modelCount > 0 || opencode.check?.available === true);

  const signInCodex = async () => {
    setCodex({ state: "busy" });
    try {
      const result = await setupApi.codexLogin();
      setCodex(result.loggedIn ? { state: "done", text: result.account } : { state: "error", text: "Not signed in yet." });
    } catch (error) {
      setCodex({ state: "error", text: errorText(error) });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={cn(
          "relative flex items-center gap-4 overflow-hidden rounded-3xl border p-4",
          modelsChecking || scanning
            ? "border-neutral-200/80 bg-white/80"
            : ready
              ? "border-emerald-200/70 bg-emerald-50/60"
              : "border-amber-200/70 bg-amber-50/60",
        )}
      >
        <motion.div
          key={String(ready)}
          initial={{ scale: 0.4, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 16 }}
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-md",
            modelsChecking || scanning ? "bg-neutral-900" : ready ? "bg-emerald-500" : "bg-amber-400",
          )}
        >
          {modelsChecking || scanning ? (
            <LoaderIcon className="size-5 animate-spin" />
          ) : (
            <ShieldCheckIcon className="size-6" />
          )}
        </motion.div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-base font-semibold text-neutral-900">
            {modelsChecking || scanning ? "Checking…" : ready ? "Mali is ready" : "Almost there"}
          </p>
          <p className="text-sm text-neutral-600">
            {modelsChecking || scanning
              ? "Starting the agent and listing models."
              : ready
                ? "Everything you need to chat is in place."
                : "Fix the items marked below, or continue and finish later in Settings."}
          </p>
        </div>
      </motion.div>

      <CheckGroup title="Agents">
        {agents.map((agent) => {
          const ok = isInstalled(scan, agent.id);
          const isCodex = agent.id === "codex";
          return (
            <CheckRow
              key={agent.id}
              icon={<AgentIcon id={agent.id} size={20} />}
              title={agent.name}
              detail={
                !ok
                  ? "Didn't install — try again from Settings → Agents"
                  : isCodex && codex.state === "done"
                    ? `Signed in${codex.text ? ` as ${codex.text}` : ""}`
                    : isCodex && codex.state === "error"
                      ? codex.text
                      : agent.account
              }
              state={scanning ? "checking" : ok ? "ok" : "warn"}
              label={ok ? "Installed" : "Missing"}
              action={
                ok && isCodex && codex.state !== "done" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 bg-white text-xs"
                    disabled={codex.state === "busy"}
                    onClick={() => void signInCodex()}
                  >
                    {codex.state === "busy" ? <LoaderIcon className="size-3 animate-spin" /> : null}
                    Sign in
                  </Button>
                ) : undefined
              }
            />
          );
        })}
      </CheckGroup>

      <CheckGroup title="Models">
        <CheckRow
          icon={<KeyRoundIcon className="size-4 text-neutral-700" />}
          title="AI models"
          detail={
            modelsChecking
              ? "Asking the agent which models it can use…"
              : modelCount > 0
                ? `${modelCount} model${modelCount === 1 ? "" : "s"} ready in the picker`
                : "No models yet — add an API key (OpenAI, Anthropic, Google, Groq, Ollama…)"
          }
          state={modelsChecking ? "checking" : modelCount > 0 ? "ok" : "warn"}
          label={modelsChecking ? undefined : modelCount > 0 ? "Ready" : "Needed"}
          action={
            !modelsChecking && modelCount === 0 ? (
              <Button size="sm" variant="outline" className="h-7 bg-white text-xs" onClick={() => leaveTo("/settings?tab=models")}>
                Add a key
              </Button>
            ) : undefined
          }
        />
      </CheckGroup>

      {mcp.length > 0 && (
        <CheckGroup title="Tools">
          {RECOMMENDED_MCP.filter((m) => mcp.includes(m.id)).map((m) => {
            const Icon = m.icon;
            const status = live[m.id];
            const error = status?.error || (status && /error|fail/i.test(status.status));
            const runtime = isInstalled(scan, m.needs);
            const state: CheckState = !status ? (runtime ? "ok" : "warn") : error ? "warn" : "ok";
            return (
              <CheckRow
                key={m.id}
                icon={<Icon className="size-4 text-neutral-700" />}
                title={m.name}
                detail={
                  error
                    ? (status?.error ?? "Couldn't start — check it in Settings → Connectors")
                    : !runtime
                      ? `Needs ${m.needs === "uv" ? "uv" : "Node.js"}, which isn't installed yet`
                      : m.pitch
                }
                state={state}
                label={state === "ok" ? "On" : "Check"}
              />
            );
          })}
        </CheckGroup>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- guide */

const GUIDE = [
  {
    icon: FolderOpenIcon,
    title: "Pick a folder",
    text: "Cowork mode works inside a folder you choose. The agent can't touch anything outside it.",
    accent: {
      icon: "from-sky-100/95 to-violet-100/95 text-sky-700",
      hoverBorder: "hover:ring-1 hover:ring-sky-200/80",
      hoverGlow: "from-sky-50/90 via-white/40 to-transparent",
    },
  },
  {
    icon: MessageSquareTextIcon,
    title: "Ask in plain words",
    text: "“Summarise these PDFs”, “turn this into a Word report”. Mali plans the steps and does them.",
    accent: {
      icon: "from-pink-100/95 to-violet-100/95 text-violet-700",
      hoverBorder: "hover:ring-1 hover:ring-violet-200/80",
      hoverGlow: "from-violet-50/90 via-white/40 to-transparent",
    },
  },
  {
    icon: ShieldCheckIcon,
    title: "You approve changes",
    text: "Before editing files or running commands, Mali asks. Allow once, always, or say no.",
    accent: {
      icon: "from-emerald-100/95 to-sky-100/95 text-emerald-700",
      hoverBorder: "hover:ring-1 hover:ring-emerald-200/80",
      hoverGlow: "from-emerald-50/90 via-white/40 to-transparent",
    },
  },
  {
    icon: BellRingIcon,
    title: "Watch from the notch",
    text: "Progress and approvals show at the top of your screen, so you can keep working elsewhere.",
    accent: {
      icon: "from-amber-100/95 to-pink-100/95 text-amber-800",
      hoverBorder: "hover:ring-1 hover:ring-amber-200/80",
      hoverGlow: "from-amber-50/90 via-white/40 to-transparent",
    },
  },
] as const;

function GuideStep() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((n) => (n + 1) % GUIDE.length), 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5">
        {GUIDE.map((item, i) => (
          <GuideFeatureCard
            key={item.title}
            index={i}
            icon={item.icon}
            title={item.title}
            text={item.text}
            accent={item.accent}
            active={i === active}
            onActivate={() => setActive(i)}
            delay={i * 0.07}
          />
        ))}
      </div>
      <Note tone="ok" icon={<WandSparklesIcon className="size-4" />}>
        Tip: you can replay this setup any time from Settings → Agents → Run setup wizard.
      </Note>
    </div>
  );
}

/** Button to reopen onboarding from Settings. */
export function OnboardingButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        openOnboarding();
        navigate("/onboarding");
      }}
      className={cn("gap-1.5", className)}
    >
      <WandSparklesIcon className="size-4" />
      Run setup wizard
    </Button>
  );
}

/** @deprecated Setup is a full page now; kept for imports that expected a dialog shell. */
export function OnboardingDialog() {
  return null;
}
