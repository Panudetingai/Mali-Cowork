"use client";

import { CoworkBot } from "@/components/anim/cowork-bot";
import { Button } from "@/components/ui/button";
import { useMcpConnections } from "@/features/mcp";
import { useOpencode, WorkMode } from "@/features/opencode";
import { listConfiguredProviders, useEnvKeys, useProviderConfigs } from "@/features/providers";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckIcon,
  ChevronRightIcon,
  KeyRoundIcon,
  LoaderIcon,
  PlugZapIcon,
  TerminalIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { openOnboarding } from "./store";

type StepState = {
  id: string;
  title: string;
  /** What this step buys the user, in their words. */
  detail: string;
  icon: typeof TerminalIcon;
  done: boolean;
  /** Skipping it still leaves a working app. */
  optional?: boolean;
  actionLabel: string;
  onAction: () => void;
};

/**
 * What the app still needs before it can answer anything. Either an agent
 * (OpenCode, which brings free models) or a provider key is enough — the
 * checklist is only shown while neither is there.
 */
export function useSetupSteps(): { steps: StepState[]; ready: boolean; checking: boolean } {
  const navigate = useNavigate();
  const opencode = useOpencode();
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const mcp = useMcpConnections();

  const hasAgent = opencode.check?.available === true;
  const providers = listConfiguredProviders(configs, envKeys);
  const modelCount =
    providers.reduce((total, entry) => total + entry.models.length, 0) +
    (opencode.models?.models.length ?? 0);

  const steps: StepState[] = [
    {
      id: "agent",
      title: "Install the OpenCode agent",
      detail: hasAgent
        ? `Ready${opencode.check?.version ? ` · ${opencode.check.version}` : ""}`
        : "The agent that reads and edits files in folders you allow. Free models included.",
      icon: TerminalIcon,
      done: hasAgent,
      actionLabel: hasAgent ? "Run setup again" : "Run setup",
      onAction: () => openOnboarding(),
    },
    {
      id: "model",
      title: "Pick a model to talk to",
      detail:
        modelCount > 0
          ? `${modelCount} model${modelCount === 1 ? "" : "s"} ready in the picker`
          : "Add your own API key — OpenAI, Anthropic, Google, Groq, Ollama and more.",
      icon: KeyRoundIcon,
      done: modelCount > 0,
      actionLabel: modelCount > 0 ? "Manage keys" : "Add a key",
      onAction: () => navigate("/settings?tab=models"),
    },
    {
      id: "tools",
      title: "Turn on tools",
      detail: "MCP servers let the agent browse the web, write documents and more.",
      icon: PlugZapIcon,
      done: Object.values(mcp).some((connection) => connection.enabled),
      optional: true,
      actionLabel: "Browse tools",
      onAction: () => navigate("/settings?tab=mcp"),
    },
  ];

  return {
    steps,
    ready: hasAgent || modelCount > 0,
    checking: opencode.loading && !opencode.check,
  };
}

export function useIsOnboarding() {
  return !useSetupSteps().ready;
}

/**
 * The first thing a new install shows above the composer: what is still
 * missing, in order, each with the one button that fixes it. It disappears on
 * its own as soon as the app can answer.
 */
export function FirstRunWizard({ className }: { className?: string }) {
  const { steps, ready, checking } = useSetupSteps();
  if (ready) return null;

  const required = steps.filter((step) => !step.optional);
  const doneCount = required.filter((step) => step.done).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "mx-auto flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <CoworkBot state="welcome" size={52} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-base font-semibold tracking-tight">Two steps and you're chatting</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Mali Cowork needs an agent or an API key before it can answer.
          </p>
        </div>
        {checking ? (
          <LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
            {doneCount}/{required.length}
          </span>
        )}
      </div>

      <ol className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {steps.map((step, index) => (
            <motion.li
              key={step.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.25, ease: "easeOut" }}
            >
              <SetupRow step={step} index={index} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={() => openOnboarding()} className="gap-1.5">
          <WandSparklesIcon className="size-4" />
          Run the setup wizard
        </Button>
        <p className="text-xs text-muted-foreground">Installs everything in one pass.</p>
      </div>
    </motion.div>
  );
}

function SetupRow({ step, index }: { step: StepState; index: number }) {
  const Icon = step.icon;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
        step.done
          ? "border-emerald-200/60 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20"
          : "border-border bg-background/60",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums",
          step.done
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
            : "bg-muted text-muted-foreground",
        )}
      >
        {step.done ? <CheckIcon className="size-4" /> : index + 1}
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{step.title}</span>
          {step.optional && (
            <span className="shrink-0 rounded-full border px-1.5 text-[10px] font-normal text-muted-foreground">
              optional
            </span>
          )}
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">{step.detail}</span>
      </div>

      <Button
        type="button"
        size="sm"
        variant={step.done ? "ghost" : "outline"}
        onClick={step.onAction}
        className="shrink-0 gap-1"
      >
        {step.actionLabel}
        <ChevronRightIcon className="size-3.5" />
      </Button>
    </div>
  );
}
