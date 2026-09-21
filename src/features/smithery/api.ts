import type { CustomMcp, RegistryServer } from "@/features/mcp";
import { invoke } from "@tauri-apps/api/core";
import { smitheryKey, smitheryReady } from "./store";

/** A skill listed on Smithery (see `commands/smithery.rs`). */
export type SmitherySkill = {
  qualifiedName: string;
  name: string;
  description: string;
  /** The repository folder it lives in — this is what gets installed. */
  gitUrl: string;
  categories: string[];
  verified: boolean;
  stars: number;
};

/** An MCP server listed on Smithery. */
export type SmitheryServer = {
  qualifiedName: string;
  name: string;
  description: string;
  iconUrl?: string;
  homepage?: string;
  verified: boolean;
  useCount: number;
};

/** One setting a server takes before it will connect. */
export type SmitheryConfigField = {
  name: string;
  description: string;
  required: boolean;
  secret: boolean;
  default?: string;
};

export type SmitheryServerDetail = {
  qualifiedName: string;
  name: string;
  description: string;
  iconUrl?: string;
  /** The MCP endpoint. */
  url: string;
  config: SmitheryConfigField[];
  tools: string[];
};

export type SmitheryPage<T> = {
  items: T[];
  page: number;
  totalPages: number;
  totalCount: number;
};

const EMPTY = { items: [], page: 1, totalPages: 1, totalCount: 0 };

/**
 * Search Smithery, or answer with nothing when it isn't connected.
 *
 * Callers merge these results with the ones they already have, so "not
 * connected" has to be an empty answer rather than an error.
 */
async function search<T>(kind: "skills" | "servers", query: string, page: number): Promise<SmitheryPage<T>> {
  const key = smitheryKey();
  if (!smitheryReady() || !key) return EMPTY;
  const command = kind === "skills" ? "smithery_search_skills" : "smithery_search_servers";
  return invoke<SmitheryPage<T>>(command, { key, query: query.trim(), page });
}

export function searchSmitherySkills(query: string, page = 1) {
  return search<SmitherySkill>("skills", query, page);
}

export function searchSmitheryServers(query: string, page = 1) {
  return search<SmitheryServer>("servers", query, page);
}

/** Look up one server's connection details, for installing it. */
export function smitheryServerDetail(qualifiedName: string) {
  const key = smitheryKey();
  if (!key) throw new Error("Connect Smithery first");
  return invoke<SmitheryServerDetail>("smithery_server", { key, qualifiedName });
}

/** How a Smithery install is remembered, so it shows as added next time. */
export function smitheryRegistryName(qualifiedName: string) {
  return `smithery:${qualifiedName}`;
}

/** Whether a connector was installed through Smithery. */
export function isSmitheryInstall(custom?: Pick<CustomMcp, "registry">) {
  return !!custom?.registry?.name?.startsWith("smithery:");
}

/**
 * Describe a Smithery server the way the MCP Registry describes one, so it
 * goes through the install dialog already built for the registry — with the
 * same URL checks and the same editable settings afterwards.
 *
 * Settings the server asks for become `{NAME}` placeholders in the URL's
 * query, which is how Smithery passes them on.
 */
export function asRegistryServer(detail: SmitheryServerDetail): RegistryServer {
  const query = detail.config.map((f) => `${encodeURIComponent(f.name)}={${f.name}}`).join("&");
  const url = query ? `${detail.url}${detail.url.includes("?") ? "&" : "?"}${query}` : detail.url;

  return {
    name: smitheryRegistryName(detail.qualifiedName),
    title: detail.name,
    description: detail.description,
    version: "",
    websiteUrl: `https://smithery.ai/server/${detail.qualifiedName}`,
    icons: detail.iconUrl ? [detail.iconUrl] : [],
    packages: [],
    remotes: [
      {
        type: "streamable-http",
        url,
        variables: Object.fromEntries(
          detail.config.map((f) => [
            f.name,
            {
              description: f.description || f.name,
              isRequired: f.required,
              isSecret: f.secret,
              default: f.default,
            },
          ]),
        ),
      },
    ],
  };
}
