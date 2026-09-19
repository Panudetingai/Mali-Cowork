"use client";

import { Button } from "@/components/ui/button";
import { listConfiguredProviders, useEnvKeys, useProviderConfigs } from "@/features/providers";
import { SparklesIcon, TerminalIcon, WandSparklesIcon } from "lucide-react";
import { openOnboarding } from "./store";

export function useIsOnboarding() {
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const configured = listConfiguredProviders(configs, envKeys).length > 0;
  return !configured;
}

export function FirstRunWizard() {
  const needsSetup = useIsOnboarding();
  if (!needsSetup) return null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Welcome to Mali Cowork</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Chat with AI, or let an agent work on files in allowed folders. Run the setup wizard to get started.
        </p>
      </div>

      <div className="grid gap-3">
        <Button
          type="button"
          onClick={() => openOnboarding()}
          className="h-auto justify-start gap-3 px-4 py-3 text-left"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
            <WandSparklesIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">Run setup wizard</span>
            <span className="text-xs text-muted-foreground">Install an agent and add an API key</span>
          </div>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto justify-start gap-3 px-4 py-3 text-left"
          onClick={() => openOnboarding()}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
            <SparklesIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">Add an API key</span>
            <span className="text-xs text-muted-foreground">OpenAI, Anthropic, Google, Groq, Ollama…</span>
          </div>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto justify-start gap-3 px-4 py-3 text-left"
          onClick={() => openOnboarding()}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            <TerminalIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">Install OpenCode</span>
            <span className="text-xs text-muted-foreground">The local agent for Cowork mode</span>
          </div>
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        You can switch between Chat and Cowork anytime from the composer.
      </p>
    </div>
  );
}
