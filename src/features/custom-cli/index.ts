/**
 * CLI agents the user adds in Settings → Models: a program already installed
 * on this computer (Claude Code, Gemini CLI, Qwen Code, Aider, or one that
 * comes out next month) that takes a prompt and prints its answer. Mali runs
 * it like the built-in agents (`cli_generate`, as `cli:<id>`), reading its
 * output as text.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { createStore } from "@/lib/local-store";

export type CustomCliInput = {
  name: string;
  /** Optional logo: HTTPS URL or a data URL from an uploaded image. */
  icon?: string;
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

export type CustomCli = CustomCliInput & {
  id: string;
  /** 2: model ids are kept whole (`kilo/poolside/…`), not stripped of their provider. */
  v?: 2;
};

export const CLI_ID_PREFIX = "custom-";

const MAX_ICON_BYTES = 256 * 1024;

/** Keeps only safe icon values for storage and display. */
export function normalizeCustomCliIcon(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (v.startsWith("data:image/")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return undefined;
}

/** Read a small PNG/JPEG/WebP/GIF as a data URL for the agent tile. */
export function customCliIconFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Choose a PNG, JPEG, WebP, or GIF image."));
  }
  if (file.size > MAX_ICON_BYTES) {
    return Promise.reject(new Error("Image must be 256 KB or smaller."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? normalizeCustomCliIcon(reader.result) : undefined;
      if (url) resolve(url);
      else reject(new Error("Could not read that image."));
    };
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

/** Well-known CLIs — one click fills the form; setup copy lives on the Add CLI page. */
export type CliPreset = CustomCliInput & {
  install: string;
  /** Short note under the preset card. */
  hint: string;
  /** What to do after install (shown as step 3). */
  signIn: string;
  /** Optional command to copy for sign-in / provider setup. */
  signInCommand?: string;
  /** Used when the CLI cannot list models until the user signs in. */
  fallbackModels?: string;
  /** Mali can install it and open its sign-in itself (`setup_install_cli`). */
  oneClick?: boolean;
};

export type CustomCliModel = { id: string; name: string };

export const CLI_PRESETS: CliPreset[] = [
  {
    name: "Claude Code",
    command: "claude",
    args: "-p {prompt} --model {model}",
    models: "",
    install: "npm i -g @anthropic-ai/claude-code",
    hint: "Anthropic subscription or API — runs in the chat folder.",
    oneClick: true,
    signIn: "Press Sign in: a Terminal window opens — sign in there, then come back here.",
    signInCommand: "claude",
    fallbackModels: "sonnet,opus,haiku",
  },
  {
    name: "Kilo CLI",
    command: "kilo",
    args: "run {prompt} --format json --auto --model {model}",
    models: "",
    install: "npm i -g @kilocode/cli",
    hint: "Free models included — sign in with a free Kilo account.",
    signIn: "Press Sign in: a Terminal window opens, follow its steps, then come back here.",
    signInCommand: "kilo auth login",
    oneClick: true,
  },
  {
    name: "Gemini CLI",
    command: "gemini",
    args: "-p {prompt} -m {model}",
    models: "",
    install: "npm i -g @google/gemini-cli",
    hint: "Free with a Google account.",
    oneClick: true,
    signIn: "Press Sign in: a Terminal window opens — choose Login with Google, then come back here.",
    signInCommand: "gemini",
    fallbackModels: "gemini-2.5-pro,gemini-2.5-flash",
  },
  {
    name: "Qwen Code",
    command: "qwen",
    args: "-p {prompt}",
    models: "",
    install: "npm i -g @qwen-code/qwen-code",
    hint: "Qwen coding agent from Alibaba — free tier with a Qwen account.",
    oneClick: true,
    signIn: "Press Sign in: a Terminal window opens — sign in there, then come back here.",
    signInCommand: "qwen",
  },
  {
    name: "Aider",
    command: "aider",
    args: "--message {prompt} --yes-always --no-pretty --model {model}",
    models: "",
    install: "python -m pip install aider-install && aider-install",
    hint: "Uses API keys from your environment (OpenAI, Anthropic, …).",
    signIn: "Set an API key in your shell profile, or export OPENAI_API_KEY / ANTHROPIC_API_KEY before using Mali.",
  },
];

export function presetForDraft(draft: Pick<CustomCliInput, "name" | "command">): CliPreset | undefined {
  return CLI_PRESETS.find((p) => p.name === draft.name && p.command === draft.command);
}

function commandStem(command: string) {
  return (command.trim().split(/[\\/]/).pop() ?? "").replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

/**
 * A model id as listed before v2, which dropped the CLI's own provider:
 * `poolside/laguna` for Kilo's `kilo/poolside/laguna`, `gpt-5` for OpenCode's
 * `opencode/gpt-5`. The CLI rejects those ("Model not found").
 */
function legacyModelFix(command: string, model: string) {
  const stem = commandStem(command);
  if (stem === "kilo" && !model.startsWith("kilo/")) return `kilo/${model}`;
  if (stem === "opencode" && !model.includes("/")) return `opencode/${model}`;
  return model;
}

/**
 * Old Kilo preset used `--prompt`, which starts the TUI and feels hung — use
 * `run` + JSON. Model lists from before v2 get their provider back.
 */
function upgradeLegacyCli(c: CustomCli): CustomCli {
  let cli = c;
  const cmd = c.command.trim();
  const args = c.args.trim();
  if (cmd === "kilo" && args.includes("--prompt") && !/\brun\b/.test(args)) {
    cli = { ...cli, args: "run {prompt} --format json --auto --model {model}" };
  }
  if (cli.v !== 2) {
    const models = cliModels(cli).map((m) => legacyModelFix(cli.command, m));
    cli = { ...cli, models: models.join(", "), v: 2 };
  }
  return cli;
}

/**
 * The model to run: a chat may still name one picked before v2, without
 * the CLI's provider in front — use the fixed id when that's what's listed.
 */
export function resolveCliModel(cli: Pick<CustomCli, "command" | "models">, model?: string) {
  if (!model) return model;
  const listed = cliModels(cli);
  if (listed.includes(model)) return model;
  const fixed = legacyModelFix(cli.command, model);
  return listed.includes(fixed) ? fixed : model;
}

const store = createStore<CustomCli[]>([], {
  key: "mali.custom-clis",
  revive: (list) =>
    Array.isArray(list)
      ? list.filter((c) => c?.id?.startsWith(CLI_ID_PREFIX) && c.command).map((c) => upgradeLegacyCli(c as CustomCli))
      : [],
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
  const icon = normalizeCustomCliIcon(input.icon);
  const clean = {
    name: input.name.trim(),
    command: input.command.trim(),
    args: input.args.trim(),
    models: input.models.trim(),
    v: 2 as const,
    ...(icon ? { icon } : {}),
  };
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

/** Models the CLI reports (`kilo models`, etc.). */
export function fetchCustomCliModels(command: string): Promise<CustomCliModel[]> {
  return invoke<CustomCliModel[]>("custom_cli_list_models", { command });
}

export function modelsFromList(list: CustomCliModel[]): string {
  return [...new Set(list.map((m) => m.id.trim()).filter(Boolean))].join(", ");
}

/** Fetch from the CLI, or preset fallbacks when listing fails. */
export async function discoverCustomCliModels(
  command: string,
  preset?: CliPreset,
): Promise<{ models: CustomCliModel[]; fromFallback: boolean }> {
  try {
    const models = await fetchCustomCliModels(command);
    if (models.length > 0) return { models, fromFallback: false };
  } catch {
    /* try fallback */
  }
  const fallback = preset?.fallbackModels?.trim();
  if (fallback) {
    return {
      models: cliModels({ models: fallback }).map((id) => ({ id, name: id })),
      fromFallback: true,
    };
  }
  return { models: [], fromFallback: false };
}

/** Whether Mali can install this preset and open its sign-in by itself. */
export function canInstallForUser(preset: CliPreset | undefined): boolean {
  return !!preset?.oneClick;
}

/** Install a preset CLI (Node.js first when missing); `onLog` gets the installer's output. */
export function installCustomCli(command: string, onLog: (line: string) => void): Promise<void> {
  const channel = new Channel<{ event: "log"; line: string }>();
  channel.onmessage = (message) => onLog(message.line);
  return invoke<void>("setup_install_cli", { command, onEvent: channel });
}

/** Open a Terminal window running the CLI's sign-in. */
export function openCliSignIn(command: string): Promise<void> {
  return invoke<void>("setup_cli_sign_in", { command });
}
