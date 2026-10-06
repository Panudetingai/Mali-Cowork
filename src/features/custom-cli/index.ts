/**
 * CLI agents the user adds in Settings → Models: a program already installed
 * on this computer (Claude Code, Gemini CLI, Qwen Code, Aider, or one that
 * comes out next month) that takes a prompt and prints its answer. Mali runs
 * it like the built-in agents (`cli_generate`, as `cli:<id>`), reading its
 * output as text.
 */
import { invoke } from "@tauri-apps/api/core";
import { createStore } from "@/lib/local-store";

export type CustomCliInput = {
  name: string;
  /** The program, by name on PATH or by full path. */
  command: string;
  /**
   * Arguments as typed, quotes allowed. `{prompt}` is where the prompt goes
   * (last when absent); `{model}` the picked model, dropped with the flag
   * before it when none is picked.
   */
  args: string;
  /** Comma-separated model ids offered in the picker; empty for the CLI's own default. */
  models: string;
};

export type CustomCli = CustomCliInput & { id: string };

export const CLI_ID_PREFIX = "custom-";

/** Well-known CLIs, to fill the form with one click. */
export const CLI_PRESETS: (CustomCliInput & { install: string; hint: string })[] = [
  {
    name: "Claude Code",
    command: "claude",
    args: "-p {prompt} --model {model}",
    models: "",
    install: "npm i -g @anthropic-ai/claude-code",
    hint: "Sign in once by running `claude` in a terminal. Models: sonnet, opus, haiku.",
  },
  {
    name: "Gemini CLI",
    command: "gemini",
    args: "-p {prompt} -m {model}",
    models: "",
    install: "npm i -g @google/gemini-cli",
    hint: "Sign in once by running `gemini` in a terminal.",
  },
  {
    name: "Qwen Code",
    command: "qwen",
    args: "-p {prompt}",
    models: "",
    install: "npm i -g @qwen-code/qwen-code",
    hint: "Sign in once by running `qwen` in a terminal.",
  },
  {
    name: "Aider",
    command: "aider",
    args: "--message {prompt} --yes-always --no-pretty --model {model}",
    models: "",
    install: "python -m pip install aider-install && aider-install",
    hint: "Uses the API keys in your environment; works on the chat's folder.",
  },
];

const store = createStore<CustomCli[]>([], {
  key: "mali.custom-clis",
  revive: (list) => (Array.isArray(list) ? list.filter((c) => c?.id?.startsWith(CLI_ID_PREFIX) && c.command) : []),
});

export const useCustomClis = store.use;
export const getCustomClis = store.get;

export function getCustomCli(id: string) {
  return store.get().find((c) => c.id === id);
}

function newId(name: string, taken: Set<string>) {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "cli";
  let id = `${CLI_ID_PREFIX}${slug}`;
  for (let n = 2; taken.has(id); n++) id = `${CLI_ID_PREFIX}${slug}-${n}`;
  return id;
}

export function saveCustomCli(input: CustomCliInput, id?: string): CustomCli {
  const clean = { name: input.name.trim(), command: input.command.trim(), args: input.args.trim(), models: input.models.trim() };
  if (id && store.get().some((c) => c.id === id)) {
    const cli = { ...clean, id };
    store.set((list) => list.map((c) => (c.id === id ? cli : c)));
    return cli;
  }
  const cli = { ...clean, id: newId(clean.name, new Set(store.get().map((c) => c.id))) };
  store.set((list) => [...list, cli]);
  return cli;
}

export function removeCustomCli(id: string) {
  store.set((list) => list.filter((c) => c.id !== id));
}

/** `-p "two words" --x` → `["-p", "two words", "--x"]`. */
export function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || current) out.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
    }
  }
  if (started || current) out.push(current);
  return out;
}

/**
 * The arguments to run with, `{prompt}` left for the backend to fill in.
 * Without a model, `{model}` goes away along with the flag in front of it,
 * so the CLI keeps its own default.
 */
export function cliArgs(cli: Pick<CustomCli, "args">, model?: string): string[] {
  const parts = splitArgs(cli.args);
  const out: string[] = [];
  for (const part of parts) {
    if (!part.includes("{model}")) {
      out.push(part);
    } else if (model) {
      out.push(part.replaceAll("{model}", model));
    } else if (part === "{model}" && out.length > 0 && out[out.length - 1]!.startsWith("-")) {
      out.pop();
    }
  }
  return out;
}

export function cliModels(cli: Pick<CustomCli, "models">) {
  return [...new Set(cli.models.split(",").map((m) => m.trim()).filter(Boolean))];
}

export type CliCheck = { available: boolean; version?: string; path?: string; error?: string };

/** Whether the command is installed: where it is, and its version when it says. */
export function checkCustomCli(command: string): Promise<CliCheck> {
  return invoke<CliCheck>("check_cli", { agent: "custom", command });
}
