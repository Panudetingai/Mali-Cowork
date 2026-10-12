/**
 * The workspace: one folder per bot under `BOT_FORGE_HOME` (default
 * `./bots`), each one a plugin folder ready to install as it is.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { unzipFiles, zipFiles, safePath } from "./archive";
import { fromFiles, literalSecrets, toFiles, type Files } from "./plugin";
import { parseSpec, uniqueSlug, now, type BotSpec } from "./schema";
import type { SavedChoice } from "./generate";
import type { CheckResult } from "./summary";

/** Bot folders hold a handful of small files; skip anything else when reading one. */
const MAX_FILE = 2 * 1024 * 1024;

export class Workspace {
  readonly root: string;

  constructor(root = process.env.BOT_FORGE_HOME || "bots") {
    this.root = resolve(root);
  }

  private dir(slug: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Not a bot name: ${slug}`);
    return join(this.root, slug);
  }

  list(): BotSpec[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root)
      .filter((name) => existsSync(join(this.root, name, "bot.json")))
      .flatMap((name) => {
        try {
          return [this.get(name)];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  has(slug: string) {
    return existsSync(join(this.dir(slug), "bot.json"));
  }

  get(slug: string): BotSpec {
    const file = join(this.dir(slug), "bot.json");
    if (!existsSync(file)) throw new Error(`There's no bot called ${slug}. See \`bot-forge list\`.`);
    return parseSpec(JSON.parse(readFileSync(file, "utf8")));
  }

  /** Write the bot's folder; files bot-forge no longer makes (a removed skill) go. */
  save(spec: BotSpec, { touch = true } = {}): BotSpec {
    const saved = parseSpec({ ...spec, ...(touch ? { updatedAt: now() } : {}) });
    const dir = this.dir(saved.slug);
    const files = toFiles(saved);
    const before = existsSync(dir) ? readTree(dir) : new Map<string, string>();
    for (const old of before.keys()) {
      const ours = old === ".mcp.json" || old.startsWith("skills/") || old.startsWith("agents/");
      if (ours && !files.has(old)) rmSync(join(dir, old), { force: true });
    }
    for (const [path, text] of files) {
      const file = join(dir, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    pruneEmpty(join(dir, "skills"));
    return saved;
  }

  remove(slug: string) {
    rmSync(this.dir(slug), { recursive: true, force: true });
    this.setChecks(slug, {});
  }

  /** Live check results are this computer's, not the bot's: they stay out of its folder. */
  private get checksFile() {
    return join(this.root, ".bot-forge", "checks.json");
  }

  private allChecks(): Record<string, Record<string, CheckResult>> {
    try {
      return JSON.parse(readFileSync(this.checksFile, "utf8"));
    } catch {
      return {};
    }
  }

  private get settingsFile() {
    return join(this.root, ".bot-forge", "settings.json");
  }

  /** The provider and model picked with `bot-forge use` or the web page. Keys are never stored. */
  choice(): SavedChoice {
    try {
      const saved = JSON.parse(readFileSync(this.settingsFile, "utf8")) as SavedChoice;
      return { provider: saved.provider, model: saved.model, baseUrl: saved.baseUrl };
    } catch {
      return {};
    }
  }

  saveChoice(choice: SavedChoice) {
    mkdirSync(dirname(this.settingsFile), { recursive: true });
    const clean = Object.fromEntries(Object.entries(choice).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, (v as string).trim()]));
    writeFileSync(this.settingsFile, JSON.stringify(clean, null, 2));
  }

  checks(slug: string): Record<string, CheckResult> {
    return this.allChecks()[slug] ?? {};
  }

  setChecks(slug: string, checks: Record<string, CheckResult>) {
    const all = this.allChecks();
    if (Object.keys(checks).length) all[slug] = checks;
    else delete all[slug];
    mkdirSync(dirname(this.checksFile), { recursive: true });
    writeFileSync(this.checksFile, JSON.stringify(all, null, 2));
  }

  /** A free slug for a new bot. */
  freeSlug(base: string) {
    return uniqueSlug(base, existsSync(this.root) ? readdirSync(this.root) : []);
  }

  exportZip(slug: string): Uint8Array {
    return zipFiles(toFiles(this.get(slug)), slug);
  }

  /** Copy the bot's folder to `out` (a plugin folder to hand over as it is). */
  exportFolder(slug: string, out: string): string {
    const target = resolve(out);
    for (const [path, text] of toFiles(this.get(slug))) {
      const file = join(target, safePath(path));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    return target;
  }

  /**
   * Bring a bot in from a folder, a .zip, or a bot.json. Nothing it contains
   * runs. A name already taken gets a new one unless `replace`.
   */
  importFrom(path: string, { replace = false } = {}): { spec: BotSpec; dropped: string[] } {
    const source = resolve(path);
    if (!existsSync(source)) throw new Error(`No such file or folder: ${path}`);
    const files = statSync(source).isDirectory()
      ? readTree(source)
      : source.toLowerCase().endsWith(".zip")
        ? unzipFiles(new Uint8Array(readFileSync(source)))
        : new Map([["bot.json", readFileSync(source, "utf8")]]);
    return this.importFiles(files, { replace });
  }

  importFiles(files: Files, { replace = false } = {}): { spec: BotSpec; dropped: string[] } {
    const dropped = literalSecrets(files);
    const spec = fromFiles(files);
    const slug = replace ? spec.slug : this.freeSlug(spec.slug);
    return { spec: this.save({ ...spec, slug }, { touch: false }), dropped };
  }
}

/** Every small text file under `dir`, by relative path. */
export function readTree(dir: string): Files {
  const files: Files = new Map();
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      if (name === "node_modules" || name === ".git" || name === ".DS_Store") continue;
      const full = join(at, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.size <= MAX_FILE) files.set(relative(dir, full).split("\\").join("/"), readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return files;
}

function pruneEmpty(dir: string) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory() && readdirSync(full).length === 0) rmSync(full, { recursive: true });
  }
}
