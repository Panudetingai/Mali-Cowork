import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { McpEnvVar } from "./catalog";
import { customMcpId, type CustomMcp } from "./custom";
import { oauthLimitFor } from "./oauth-limits";

/**
 * The official MCP Registry (registry.modelcontextprotocol.io), read through
 * the backend (`commands/mcp_registry.rs`). Entries are published by anyone,
 * so everything that ends up in a command is checked here, and the user sees
 * the exact command before it is installed.
 */

type Input = {
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  format?: string;
  default?: string;
  value?: string;
  choices?: string[];
  placeholder?: string;
  variables?: Record<string, Input>;
};

type Argument = Input & { type?: "positional" | "named"; name?: string; valueHint?: string; isRepeated?: boolean };

export type RegistryPackage = {
  registryType: "npm" | "pypi" | "oci";
  identifier: string;
  version?: string;
  runtimeHint?: string;
  transport?: { type: string };
  runtimeArguments?: Argument[];
  packageArguments?: Argument[];
  environmentVariables?: (Input & { name: string })[];
};

export type RegistryRemote = {
  type: "streamable-http" | "sse";
  url: string;
  headers?: (Input & { name: string })[];
  variables?: Record<string, Input>;
};

export type RegistryServer = {
  name: string;
  title: string;
  description: string;
  version: string;
  websiteUrl?: string | null;
  repositoryUrl?: string | null;
  icons: string[];
  packages: RegistryPackage[];
  remotes: RegistryRemote[];
};

export type RegistryPage = { servers: RegistryServer[]; nextCursor?: string | null };

/** Well-known services, shown as "Popular" before any search. */
export const FEATURED_REGISTRY = [
  "com.notion/mcp",
  "io.github.github/github-mcp-server",
  "app.linear/linear",
  "com.atlassian/atlassian-mcp-server",
  "com.figma.mcp/mcp",
  "com.supabase/mcp",
  "com.stripe/mcp",
  "com.vercel/vercel-mcp",
  "com.zapier/mcp",
  "com.monday/monday.com",
  "com.gitlab/mcp",
  "com.neon/mcp",
];

export function searchRegistry(query: string, cursor?: string | null, limit = 30) {
  return invoke<RegistryPage>("mcp_registry_search", { query, cursor: cursor ?? null, limit });
}

export function getRegistryServers(names: string[]) {
  return invoke<RegistryServer[]>("mcp_registry_get", { names });
}

/** `com.notion/mcp` → `com.notion`: who published the entry. */
export function registryPublisher(name: string) {
  return name.split("/")[0] ?? name;
}

// ---------------------------------------------------------------- Icons

const iconCache = new Map<string, Promise<string | null>>();

/** A registry server's icon as a data URL (fetched by the backend), or null. */
export function useRegistryIcon(urls: string[] | undefined) {
  const key = urls?.join("\n") ?? "";
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!key) {
      setSrc(null);
      return;
    }
    let live = true;
    let pending = iconCache.get(key);
    if (!pending) {
      pending = invoke<string | null>("mcp_registry_icon", { urls: key.split("\n") }).catch(() => null);
      iconCache.set(key, pending);
    }
    void pending.then((data) => live && setSrc(data));
    return () => {
      live = false;
    };
  }, [key]);
  return src;
}

// ---------------------------------------------------------------- Install options

type Built = {
  command?: string;
  /** The command as argv, checked before install. */
  argv?: string[];
  url?: string;
  env: Record<string, string>;
  headers: Record<string, string>;
};

/** One field the user fills in before installing. */
export type InstallField = {
  key: string;
  /** Where the value goes: an env var, a header, or into the command / URL. */
  target: "env" | "header" | "arg" | "url";
  label: string;
  description?: string;
  required: boolean;
  secret: boolean;
  choices?: string[];
  defaultValue?: string;
};

export type InstallOption = {
  id: string;
  kind: "local" | "remote";
  /** e.g. "npx · npm", "Docker", "Remote (HTTP)". */
  label: string;
  /** Binary it needs on this machine, if any. */
  needs?: "npx" | "uvx" | "docker";
  fields: InstallField[];
  /** Why it can't be used, if it can't. */
  unsupported?: string;
  /** Setup the user does outside the app first (e.g. turn on a desktop server). */
  note?: string;
  build: (values: Record<string, string>) => Built;
};

const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
const PYPI_NAME = /^[A-Za-z0-9][\w.-]*$/;
const OCI_REF = /^[a-z0-9][a-z0-9._\-/:@]*$/i;
const VERSION = /^[\w.+-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/**
 * Characters allowed in a command argument. No quotes, spaces or shell
 * characters: on Windows `npx` is a batch file, where `&|<>^%` would run
 * other commands.
 */
const SAFE_ARG = /^[\w@+=:,./~[\]-]*$/;

function quote(arg: string) {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

function fillVariables(text: string, vars: Record<string, Input> | undefined, values: Record<string, string>, prefix: string) {
  return text.replace(/\{([\w-]+)\}/g, (_, name: string) => values[`${prefix}${name}`] ?? vars?.[name]?.default ?? "");
}

/** Fields for `{variables}` inside an argument or URL. */
function variableFields(vars: Record<string, Input> | undefined, prefix: string, target: InstallField["target"]): InstallField[] {
  return Object.entries(vars ?? {}).map(([name, v]) => ({
    key: `${prefix}${name}`,
    target,
    label: name,
    description: v.description,
    required: !!v.isRequired,
    secret: !!v.isSecret,
    choices: v.choices,
    defaultValue: v.default,
  }));
}

type ArgPlan = { fields: InstallField[]; render: (values: Record<string, string>) => string[]; secretInArgs: boolean; env: string[] };

/**
 * Turn registry arguments into argv. Docker `-e NAME={secret}` becomes
 * `-e NAME` plus an environment variable, so secrets never sit in the command.
 */
function planArgs(args: Argument[] | undefined, prefix: string, docker: boolean): ArgPlan {
  const fields: InstallField[] = [];
  const envNames: string[] = [];
  let secretInArgs = false;
  const steps: ((values: Record<string, string>) => string[])[] = [];

  (args ?? []).forEach((arg, index) => {
    const key = `${prefix}${index}.`;
    const dockerEnv = docker && arg.type === "named" && arg.name === "-e" && /^([A-Za-z_]\w*)=(.*)$/.exec(arg.value ?? "");
    if (dockerEnv) {
      const [, envName, raw] = dockerEnv;
      const vars = arg.variables ?? {};
      const secret = Object.values(vars).some((v) => v.isSecret) || !!arg.isSecret;
      if (/\{[\w-]+\}/.test(raw) || secret) {
        const onlyVar = /^\{([\w-]+)\}$/.exec(raw);
        const v = onlyVar ? vars[onlyVar[1]] : undefined;
        fields.push({
          key: `env:${envName}`,
          target: "env",
          label: envName,
          description: v?.description ?? arg.description,
          required: !!(arg.isRequired || v?.isRequired),
          secret,
          choices: v?.choices,
          defaultValue: v?.default,
        });
        envNames.push(envName);
        steps.push((values) => (values[`env:${envName}`]?.trim() ? ["-e", envName] : []));
        return;
      }
    }

    const vars = arg.variables;
    fields.push(...variableFields(vars, key, "arg"));
    if (Object.values(vars ?? {}).some((v) => v.isSecret) || arg.isSecret) secretInArgs = true;

    const hasValue = arg.value !== undefined && arg.value !== "";
    if (!hasValue) {
      // The user supplies it (e.g. a path or an account id).
      fields.push({
        key: `${key}value`,
        target: "arg",
        label: arg.valueHint || arg.name || `Argument ${index + 1}`,
        description: arg.description,
        required: !!arg.isRequired,
        secret: !!arg.isSecret,
        choices: arg.choices,
        defaultValue: arg.default,
      });
    }
    steps.push((values) => {
      const value = hasValue ? fillVariables(arg.value ?? "", vars, values, key) : (values[`${key}value`] ?? arg.default ?? "");
      if (!value.trim()) return [];
      if (arg.type === "named" && arg.name) return [arg.name, value];
      return [value];
    });
  });

  return { fields, render: (values) => steps.flatMap((step) => step(values)), secretInArgs, env: envNames };
}

function envFields(pkg: RegistryPackage): InstallField[] {
  return (pkg.environmentVariables ?? [])
    .filter((e) => ENV_NAME.test(e.name))
    .map((e) => ({
      key: `env:${e.name}`,
      target: "env",
      label: e.name,
      description: e.description,
      required: !!e.isRequired,
      secret: !!e.isSecret,
      choices: e.choices,
      defaultValue: e.default,
    }));
}

function packageOption(pkg: RegistryPackage, index: number): InstallOption {
  const version = pkg.version && VERSION.test(pkg.version) ? pkg.version : undefined;
  const docker = pkg.registryType === "oci";
  const runtime = planArgs(pkg.runtimeArguments, `rt${index}.`, docker);
  const packageArgs = planArgs(pkg.packageArguments, `pk${index}.`, docker);
  const fields = dedupe([...envFields(pkg), ...runtime.fields, ...packageArgs.fields]);

  let unsupported: string | undefined;
  let base: string[] = [];
  let label = "";
  let needs: InstallOption["needs"];
  if (pkg.registryType === "npm") {
    if (!NPM_NAME.test(pkg.identifier)) unsupported = "Package name looks unsafe";
    base = ["npx", "-y", version ? `${pkg.identifier}@${version}` : pkg.identifier];
    label = "npx · npm";
    needs = "npx";
  } else if (pkg.registryType === "pypi") {
    if (!PYPI_NAME.test(pkg.identifier)) unsupported = "Package name looks unsafe";
    base = ["uvx", version ? `${pkg.identifier}==${version}` : pkg.identifier];
    label = "uvx · PyPI";
    needs = "uvx";
  } else {
    if (!OCI_REF.test(pkg.identifier)) unsupported = "Image name looks unsafe";
    base = ["docker", "run", "-i", "--rm"];
    label = "Docker";
    needs = "docker";
  }
  if (runtime.secretInArgs || packageArgs.secretInArgs) {
    unsupported ??= "Needs a secret on the command line; use another method";
  }

  return {
    id: `pkg-${index}`,
    kind: "local",
    label,
    needs,
    fields,
    unsupported,
    build: (values) => {
      const env: Record<string, string> = {};
      for (const f of fields) if (f.target === "env" && values[f.key]?.trim()) env[f.key.slice(4)] = values[f.key].trim();
      const envFlags = docker
        ? Object.keys(env)
            .filter((name) => !runtime.env.includes(name) && !packageArgs.env.includes(name))
            .flatMap((name) => ["-e", name])
        : [];
      const argv = docker
        ? [...base, ...runtime.render(values), ...envFlags, pkg.identifier, ...packageArgs.render(values)]
        : [...base.slice(0, 1), ...runtime.render(values), ...base.slice(1), ...packageArgs.render(values)];
      return { command: argv.map(quote).join(" "), argv, env, headers: {} };
    },
  };
}

function remoteOption(remote: RegistryRemote, index: number): InstallOption {
  const urlFields = variableFields(remote.variables, "url:", "url");
  const headerFields: InstallField[] = (remote.headers ?? [])
    .filter((h) => HEADER_NAME.test(h.name))
    .map((h) => ({
      key: `header:${h.name}`,
      target: "header",
      label: h.name,
      description: h.description,
      required: !!h.isRequired,
      secret: !!h.isSecret,
      choices: h.choices,
      defaultValue: h.default,
    }));
  return {
    id: `remote-${index}`,
    kind: "remote",
    label: remote.type === "sse" ? "Remote (SSE)" : "Remote (HTTP)",
    fields: [...urlFields, ...headerFields],
    build: (values) => {
      const headers: Record<string, string> = {};
      for (const f of headerFields) if (values[f.key]?.trim()) headers[f.label] = values[f.key].trim();
      return { url: fillVariables(remote.url, remote.variables, values, "url:"), env: {}, headers };
    },
  };
}

function dedupe(fields: InstallField[]) {
  const seen = new Set<string>();
  return fields.filter((f) => !seen.has(f.key) && seen.add(f.key));
}

/** A fixed local URL the vendor offers when its remote sign-in is closed to this app. */
function alternativeOption(alt: { label: string; url: string; setup: string }, index: number): InstallOption {
  return {
    id: `alt-${index}`,
    kind: "remote",
    label: alt.label,
    fields: [],
    note: alt.setup,
    build: () => ({ url: alt.url, env: {}, headers: {} }),
  };
}

/** Every way a registry server can be installed: remotes first (nothing to run locally). */
export function installOptions(server: RegistryServer): InstallOption[] {
  const alternatives: InstallOption[] = [];
  const remotes = server.remotes.map((remote, index) => {
    const option = remoteOption(remote, index);
    const limit = oauthLimitFor(remote.url);
    if (!limit) return option;
    if (limit.alternative && !alternatives.some((a) => a.label === limit.alternative!.label)) {
      alternatives.push(alternativeOption(limit.alternative, alternatives.length));
    }
    return { ...option, unsupported: `${limit.service} doesn’t allow this app to sign in` };
  });
  return [...alternatives, ...remotes, ...server.packages.map(packageOption)];
}

/** Problems with the values, or with what they build, before anything is saved. */
export function checkInstall(option: InstallOption, values: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const f of option.fields) {
    const value = values[f.key]?.trim() ?? "";
    if (f.required && !value && !f.defaultValue) problems.push(`${f.label} is required`);
    if (/[\u0000-\u001f]/.test(value)) problems.push(`${f.label} has invalid characters`);
    if (f.target === "arg" && value && !SAFE_ARG.test(value)) {
      problems.push(`${f.label} may only use letters, numbers and - _ . / : @ = + , [ ]`);
    }
  }
  const built = option.build(values);
  // Registry-provided parts too: nothing in the command may reach a shell.
  const unsafe = built.argv?.find((arg) => !SAFE_ARG.test(arg));
  if (unsafe !== undefined) problems.push(`The command has an unsafe part: ${unsafe}`);
  if (built.url !== undefined) {
    try {
      const url = new URL(built.url);
      const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
        problems.push("The server URL must use https://");
      }
    } catch {
      problems.push("The server URL is incomplete");
    }
  }
  return problems;
}

/** The connector saved for a registry install (a custom MCP remembering where it came from). */
export function registryConnector(
  server: RegistryServer,
  option: InstallOption,
  values: Record<string, string>,
  existing?: CustomMcp,
): { connector: CustomMcp; env: Record<string, string> } {
  const built = option.build(values);
  const envVars: McpEnvVar[] = option.fields
    .filter((f) => f.target === "env")
    .map((f) => ({ var: f.key.slice(4), label: f.description || f.label, required: f.required, secret: f.secret }));
  return {
    connector: {
      id: existing?.id ?? customMcpId(server.title || server.name),
      name: server.title,
      description: server.description,
      kind: option.kind,
      command: built.command,
      url: built.url,
      headers: option.kind === "remote" ? built.headers : undefined,
      // First runs download the package.
      timeoutMs: option.kind === "local" ? 180_000 : undefined,
      createdAt: existing?.createdAt ?? Date.now(),
      registry: {
        name: server.name,
        version: server.version,
        icons: server.icons,
        websiteUrl: server.websiteUrl ?? undefined,
        repositoryUrl: server.repositoryUrl ?? undefined,
        method: option.label,
      },
      envVars: envVars.length ? envVars : undefined,
    },
    env: built.env,
  };
}
