import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  checkCustomCli,
  CLI_PRESETS,
  cliArgs,
  cliModels,
  getCustomCli,
  removeCustomCli,
  saveCustomCli,
  type CliCheck,
  type CustomCliInput,
} from "@/features/custom-cli";
import { ProviderLogo } from "@/features/providers";
import { cn } from "@/lib/utils";
import { cliGenerateStream } from "@/pages/chat/api/cli";
import { CheckIcon, LoaderIcon, PlayIcon, SearchIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { CopyCommand, Field, Notice, PageHeader, SectionLabel, StatusPill } from "./ui";

const EMPTY: CustomCliInput = { name: "", command: "", args: "{prompt}", models: "" };

/** Shown in the form: what Mali will actually run. */
function preview(draft: CustomCliInput, model?: string) {
  const quote = (a: string) => (/[\s"']/.test(a) ? JSON.stringify(a) : a);
  const args = cliArgs(draft, model);
  const withPrompt = draft.args.includes("{prompt}") ? args : [...args, "{prompt}"];
  return [draft.command.trim() || "<command>", ...withPrompt.map((a) => (a.includes("{prompt}") ? a.replace("{prompt}", "“your message”") : quote(a)))].join(" ");
}

/**
 * Settings → Models → CLI agents → Add CLI (`cli/new`) or one already added
 * (`cli/<id>`): a program installed on this computer that takes a prompt and
 * prints an answer. Find it, say how it takes the prompt, try it.
 */
export function CustomCliPage({ id, onDone }: { id: string; onDone: () => void }) {
  const existing = id === "new" ? undefined : getCustomCli(id);
  const [draft, setDraft] = useState<CustomCliInput>(existing ?? EMPTY);
  const [attempted, setAttempted] = useState(false);
  const [check, setCheck] = useState<(CliCheck & { command: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [install, setInstall] = useState<string>();
  const ids = { name: useId(), command: useId(), args: useId(), models: useId() };
  const set = (patch: Partial<CustomCliInput>) => setDraft((prev) => ({ ...prev, ...patch }));

  const name = draft.name.trim();
  const command = draft.command.trim();
  const canSave = !!name && !!command;
  const models = cliModels(draft);

  async function detect(cmd = command) {
    if (!cmd) return;
    setChecking(true);
    try {
      setCheck({ ...(await checkCustomCli(cmd)), command: cmd });
    } catch (e) {
      setCheck({ available: false, error: String(e), command: cmd });
    } finally {
      setChecking(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!canSave) return;
    saveCustomCli(draft, existing?.id);
    toast.success(`${name} is in the model picker`, {
      description: models.length ? `${models.length} model${models.length === 1 ? "" : "s"}` : "With its own default model.",
    });
    onDone();
  }

  function remove() {
    if (!existing) return;
    removeCustomCli(existing.id);
    toast(`${existing.name} removed`);
    onDone();
  }

  if (id !== "new" && !existing) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader back={{ label: "Models", onClick: onDone }} title="CLI not found" description="It may have been removed." />
      </div>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-8">
      <PageHeader
        back={{ label: "Models", onClick: onDone }}
        icon={<ProviderLogo logo="terminal" name={name || "CLI"} className="size-7" />}
        title={existing ? existing.name : "Add a CLI agent"}
        description="A program on this computer that takes a prompt and prints its answer. Mali runs it in the chat’s folder and shows what it prints — sign in to it once in a terminal first, if it asks."
      />

      {!existing && (
        <section className="flex max-w-3xl flex-col gap-3">
          <SectionLabel>Start from</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {CLI_PRESETS.map((preset) => {
              const on = draft.command === preset.command && draft.name === preset.name;
              return (
                <button
                  key={preset.name}
                  type="button"
                  title={preset.hint}
                  onClick={() => {
                    setDraft({ name: preset.name, command: preset.command, args: preset.args, models: preset.models });
                    setInstall(preset.install);
                    void detect(preset.command);
                  }}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors",
                    on ? "border-violet-500 bg-violet-500/10 text-foreground" : "border-border/70 text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                  )}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>
          {install && (
            <p className="text-[12px] text-muted-foreground">
              {CLI_PRESETS.find((p) => p.install === install)?.hint}
            </p>
          )}
        </section>
      )}

      <div className="flex max-w-xl flex-col gap-5">
        <Field label="Name" htmlFor={ids.name} error={attempted && !name ? "Give it a name" : null}>
          <Input id={ids.name} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Claude Code" className="h-10" />
        </Field>

        <Field
          label="Command"
          htmlFor={ids.command}
          error={attempted && !command ? "Which program to run" : null}
          hint="Its name on PATH, or the full path to it."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={ids.command}
              value={draft.command}
              onChange={(e) => {
                set({ command: e.target.value });
                setCheck(null);
              }}
              onBlur={() => command && command !== check?.command && void detect()}
              placeholder="e.g. claude"
              spellCheck={false}
              className="h-10 font-mono text-[13px]"
            />
            <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => void detect()} disabled={!command || checking}>
              {checking ? <LoaderIcon className="size-4 animate-spin" /> : <SearchIcon className="size-4" />}
              Find it
            </Button>
          </div>
        </Field>
        {check && check.command === command && (
          <div className="-mt-2 flex flex-col gap-2">
            <StatusPill tone={check.available ? "success" : "danger"} className="w-fit">
              {check.available ? `Found${check.version ? ` · ${check.version.split("\n")[0]}` : ""}` : "Not found on this computer"}
            </StatusPill>
            {check.path && <p className="font-mono text-[12px] text-muted-foreground wrap-anywhere">{check.path}</p>}
            {!check.available && install && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[12px] text-muted-foreground">Install it, then press Find it again:</p>
                <CopyCommand command={install} />
              </div>
            )}
          </div>
        )}

        <Field
          label="Arguments"
          htmlFor={ids.args}
          hint={
            <>
              <code className="font-mono">{"{prompt}"}</code> is your message (it goes last if left out);{" "}
              <code className="font-mono">{"{model}"}</code> the model picked — dropped with its flag when none is.
            </>
          }
        >
          <Input
            id={ids.args}
            value={draft.args}
            onChange={(e) => set({ args: e.target.value })}
            placeholder="-p {prompt}"
            spellCheck={false}
            className="h-10 font-mono text-[13px]"
          />
        </Field>

        <Field
          label="Models"
          htmlFor={ids.models}
          optional
          hint="Comma-separated; each shows in the model picker. Empty: one entry that uses the CLI’s own default."
        >
          <Input
            id={ids.models}
            value={draft.models}
            onChange={(e) => set({ models: e.target.value })}
            placeholder="e.g. sonnet, opus"
            spellCheck={false}
            className="h-10 font-mono text-[13px]"
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Mali will run</p>
          <code className="rounded-lg bg-muted/60 px-3 py-2 font-mono text-[12px] wrap-anywhere">{preview(draft, models[0])}</code>
        </div>

        {canSave && <TryCli draft={draft} model={models[0]} />}
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-2 border-t border-border/60 bg-background/90 px-1 py-3 backdrop-blur">
        {existing ? (
          <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={remove}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={attempted && !canSave} className="h-10 gap-1.5 px-5">
            <CheckIcon className="size-4" />
            {existing ? "Save" : "Add to model picker"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Run the CLI once with a short prompt, the way a chat would, and show what came back. */
function TryCli({ draft, model }: { draft: CustomCliInput; model?: string }) {
  const [state, setState] = useState<{ running?: boolean; output?: string; error?: string }>({});
  const run = async () => {
    let output = "";
    setState({ running: true });
    try {
      await cliGenerateStream(
        {
          prompt: "Reply with the single word: OK",
          agent: "custom-try",
          custom: { command: draft.command.trim(), args: cliArgs(draft, model) },
        },
        {
          onChunk: (text) => {
            output += text;
          },
          onDone: () => setState({ output: output.trim() }),
          onError: (message) => setState({ error: message, output: output.trim() || undefined }),
        },
      );
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Notice tone={state.error ? "warning" : "info"} title="Check it works">
      <div className="flex flex-col gap-2">
        <span>Sends one short message — some CLIs take a while to start.</span>
        <Button type="button" variant="outline" size="sm" className="h-8 w-fit gap-1.5" onClick={() => void run()} disabled={state.running}>
          {state.running ? <LoaderIcon className="size-3.5 animate-spin" /> : <PlayIcon className="size-3.5" />}
          {state.running ? "Waiting for an answer…" : "Try it"}
        </Button>
        {state.output && <p className="rounded-md bg-muted/60 px-2 py-1 font-mono text-[12px] wrap-anywhere">{state.output.slice(0, 400)}</p>}
        {state.error && <p className="text-[12px] whitespace-pre-wrap wrap-anywhere">{state.error.slice(0, 800)}</p>}
      </div>
    </Notice>
  );
}
