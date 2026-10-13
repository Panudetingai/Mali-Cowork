import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useInstructions } from "@/features/instructions";
import {
  catalogConnectorsSuggested,
  McpToolIcon,
  MCP_SERVERS,
  searchRegistry,
  useInstalledConnectors,
  type RegistryServer,
} from "@/features/mcp";
import { hasRecommendedSkill, RECOMMENDED_SKILLS, recommendedSkillsFor, searchSkillRepos, type SkillRepo } from "@/features/skills";
import { ownerOf, useTeam } from "@/features/team";
import { cn } from "@/lib/utils";
import { RegistryIcon } from "@/pages/settings/mcp/connector-icon";
import { settingsPath } from "@/pages/settings/route";
import { CheckIcon, DownloadIcon, FileTextIcon, LightbulbIcon, LoaderIcon, PlusIcon, SearchIcon, StarIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { EnvFields, useConnectorInstall, useSkillInstall } from "./bot-maker-install";

type PickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botName: string;
  /** The bot's duty and steps: what's suggested comes from them. */
  duty: { role: string; instructions: string };
  picked: string[];
  onChange: (picked: string[]) => void;
  /** Ids to show as suggested even when the duty doesn't name them (the writer's picks). */
  suggested: Set<string>;
  /** Start with this search (from "More like this" on a recommendation). */
  initialQuery?: string;
};

/**
 * The connectors a bot can use: tick the user's, connect a built-in one in
 * place (keys asked here), or install one from the MCP Registry. What's
 * connected from here is added to the bot.
 */
export function ConnectorPickerDialog({ open, onOpenChange, botName, duty, picked, onChange, suggested, initialQuery }: PickerProps) {
  const navigate = useNavigate();
  const { mates } = useTeam();
  const installed = useInstalledConnectors();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery(initialQuery ?? "");
  }, [open, initialQuery]);
  const connector = useConnectorInstall((ids) => {
    onChange([...new Set([...picked, ...ids])]);
    toast.success(`Connected and added to ${botName}.`);
  });
  const q = query.trim().toLowerCase();
  const matches = (...text: string[]) => !q || text.some((t) => t.toLowerCase().includes(q));

  const installedIds = useMemo(() => new Set(installed.map((c) => c.id)), [installed]);
  const named = useMemo(() => new Set(catalogConnectorsSuggested(duty.role, duty.instructions, new Set()).map((s) => s.id)), [duty]);
  const isSuggested = (id: string) => suggested.has(id) || named.has(id);
  const bySuggested = <T extends { id: string; name: string }>(a: T, b: T) =>
    Number(isSuggested(b.id)) - Number(isSuggested(a.id)) || a.name.localeCompare(b.name);
  const yours = installed.filter((c) => matches(c.name)).sort(bySuggested);
  const builtIn = MCP_SERVERS.filter((s) => !installedIds.has(s.id) && matches(s.name, s.description)).sort(bySuggested);
  const registry = useRegistrySearch(open ? q : "");

  const toggle = (id: string, enabled: boolean) => {
    if (picked.includes(id)) return onChange(picked.filter((x) => x !== id));
    // A connector that's off is turned on: the bot can't use it otherwise.
    if (!enabled) connector.turnOn(id);
    onChange([...picked, id]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-4rem)] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connectors for {botName}</DialogTitle>
          <DialogDescription>
            Apps and tools (MCP) this bot can use. Tick yours, or connect a new one right here. A connector belongs to one bot only.
          </DialogDescription>
        </DialogHeader>
        <SearchBox value={query} onChange={setQuery} placeholder="Search connectors, or the MCP Registry…" />

        <div className="-mx-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-1">
          <PickerSection title="Your connectors" empty={installed.length ? "None match." : "You haven't connected any yet — connect one below."}>
            {yours.map((c) => {
              const owner = ownerOf(mates, "connectors", c.id)?.name;
              return (
                <PickRow
                  key={c.id}
                  icon={<McpToolIcon mcp={c.ref} size={20} />}
                  title={c.name}
                  meta={owner ? `${owner} has it` : c.enabled ? "Connected" : "Off — turns on when ticked"}
                  suggested={isSuggested(c.id)}
                  on={picked.includes(c.id)}
                  disabled={!!owner}
                  onToggle={() => toggle(c.id, c.enabled)}
                />
              );
            })}
          </PickerSection>

          <PickerSection title="Connect a new one" empty={q ? "No built-in connector matches." : undefined}>
            {builtIn.map((s) => (
              <li key={s.id} className={cn("flex flex-col gap-3 rounded-lg px-2.5 py-2", connector.setup === s.id ? "bg-muted/50" : "hover:bg-muted/40")}>
                <div className="flex min-w-0 items-center gap-3">
                  <McpToolIcon mcp={{ serverId: s.id, serverName: s.name, tool: "", def: s }} size={20} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{s.name}</span>
                      {isSuggested(s.id) && <SuggestedTag />}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{s.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={isSuggested(s.id) ? "default" : "outline"}
                    className="h-7 shrink-0"
                    disabled={!!connector.connecting}
                    onClick={() => void connector.connect(s)}
                  >
                    {connector.connecting === s.id ? (
                      <LoaderIcon className="size-3.5 animate-spin" />
                    ) : connector.setup !== s.id && (s.envVars ?? []).length > 0 ? (
                      "Set up"
                    ) : (
                      "Connect"
                    )}
                  </Button>
                </div>
                {connector.setup === s.id && (
                  <div className="ml-8">
                    <EnvFields server={s} env={connector.env} onChange={connector.setEnv} />
                  </div>
                )}
              </li>
            ))}
          </PickerSection>

          {q.length >= 2 && (
            <PickerSection title="From the MCP Registry" empty={registry.loading ? undefined : (registry.error ?? "Nothing found.")} busy={registry.loading}>
              {registry.servers.map((server) => (
                <li key={server.name} className="flex min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted/40">
                  <RegistryIcon icons={server.icons} size={22} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{server.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{server.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1"
                    onClick={() => {
                      onOpenChange(false);
                      connector.installFromRegistry(server);
                    }}
                  >
                    <DownloadIcon className="size-3.5" /> Install
                  </Button>
                </li>
              ))}
            </PickerSection>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border/60 pt-4 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => {
              onOpenChange(false);
              navigate(settingsPath("mcp", "new"));
            }}
          >
            <PlusIcon className="size-3.5" /> Add your own (URL or command)
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The skills a bot uses: tick the library's, install a well-known one in a
 * click, find more on GitHub, or paste a link. What's installed from here is
 * added to the bot.
 */
export function SkillPickerDialog({ open, onOpenChange, botName, duty, picked, onChange, suggested, initialQuery }: PickerProps) {
  const navigate = useNavigate();
  const { mates } = useTeam();
  const { skills } = useInstructions();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  useEffect(() => {
    if (open) setQuery(initialQuery ?? "");
  }, [open, initialQuery]);
  const skill = useSkillInstall((ids) => {
    onChange([...new Set([...picked, ...ids])]);
    toast.success(`Installed and added to ${botName}.`);
  });
  const q = query.trim().toLowerCase();
  const matches = (...text: string[]) => !q || text.some((t) => t.toLowerCase().includes(q));

  const fits = useMemo(() => new Set(recommendedSkillsFor(`${duty.role}\n${duty.instructions}`, []).map((s) => s.id)), [duty]);
  const recommended = (id: string) => fits.has(id) || suggested.has(id);
  const library = skills
    .filter((k) => k.enabled && matches(k.name, k.description))
    .sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)) || a.name.localeCompare(b.name));
  const popular = RECOMMENDED_SKILLS.filter((s) => !hasRecommendedSkill(s, skills) && matches(s.name, s.description, s.id)).sort(
    (a, b) => Number(recommended(b.id)) - Number(recommended(a.id)),
  );
  const github = useSkillRepoSearch(open ? q : "");

  const install = (url: string) => {
    onOpenChange(false);
    skill.install(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-4rem)] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Skills for {botName}</DialogTitle>
          <DialogDescription>
            Know-how the bot follows for a kind of work. Tick yours, or install one — you read it before anything is saved. A skill belongs to one bot only.
          </DialogDescription>
        </DialogHeader>
        <SearchBox value={query} onChange={setQuery} placeholder="Search skills, or GitHub…" />

        <div className="-mx-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-1">
          <PickerSection title="Your skills" empty={skills.length ? "None match." : "Your library is empty — install one below."}>
            {library.map((k) => {
              const owner = ownerOf(mates, "skills", k.id)?.name;
              return (
                <PickRow
                  key={k.id}
                  icon={<SkillIcon />}
                  title={k.name}
                  meta={owner ? `${owner} has it` : k.description}
                  suggested={suggested.has(k.id)}
                  on={picked.includes(k.id)}
                  disabled={!!owner}
                  onToggle={() => onChange(picked.includes(k.id) ? picked.filter((x) => x !== k.id) : [...picked, k.id])}
                />
              );
            })}
          </PickerSection>

          <PickerSection title="Install in one click" empty={q ? "No ready-made skill matches." : undefined}>
            {popular.map((s) => (
              <li key={s.id} className="flex min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted/40">
                <SkillIcon />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{s.name}</span>
                    {recommended(s.id) && <SuggestedTag />}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.description} <span className="text-muted-foreground/60">· {s.repo}</span>
                  </p>
                </div>
                <Button size="sm" variant={recommended(s.id) ? "default" : "outline"} className="h-7 shrink-0 gap-1" onClick={() => install(s.url)}>
                  <DownloadIcon className="size-3.5" /> Install
                </Button>
              </li>
            ))}
          </PickerSection>

          {q.length >= 2 && (
            <PickerSection title="Skill collections on GitHub" empty={github.loading ? undefined : (github.note ?? "Nothing found.")} busy={github.loading}>
              {github.repos.map((repo) => (
                <li key={repo.name} className="flex min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted/40">
                  {repo.avatar ? <img src={repo.avatar} alt="" className="size-5 shrink-0 rounded-md" /> : <SkillIcon />}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{repo.name}</span>
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-normal text-muted-foreground">
                        <StarIcon className="size-3" /> {repo.stars}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{repo.description}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => install(repo.url)}>
                    Browse
                  </Button>
                </li>
              ))}
            </PickerSection>
          )}

          <PickerSection title="Or paste a link">
            <li className="flex gap-2 px-2.5">
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && source.trim()) install(source.trim());
                }}
                placeholder="GitHub link, or npx skills add owner/repo"
                className="h-9 font-mono text-xs"
              />
              <Button size="sm" className="h-9 shrink-0 gap-1" disabled={!source.trim()} onClick={() => install(source.trim())}>
                <DownloadIcon className="size-3.5" /> Install
              </Button>
            </li>
          </PickerSection>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border/60 pt-4 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => {
              onOpenChange(false);
              navigate(settingsPath("skills"));
            }}
          >
            <PlusIcon className="size-3.5" /> Write your own in Settings
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The best Registry matches for some words, looked up once typing settles. */
export function useRegistrySearch(query: string, limit = 6) {
  const [state, setState] = useState<{ servers: RegistryServer[]; loading: boolean; error?: string }>({ servers: [], loading: false });
  useEffect(() => {
    if (query.length < 2) {
      setState({ servers: [], loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    const timer = setTimeout(() => {
      searchRegistry(query, null, limit)
        .then((page) => live && setState({ servers: page.servers, loading: false }))
        .catch((e) => live && setState({ servers: [], loading: false, error: String(e) }));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, limit]);
  return state;
}

/** GitHub skill collections for some words, within GitHub's search limit (see `searchSkillRepos`). */
function useSkillRepoSearch(query: string) {
  const [state, setState] = useState<{ repos: SkillRepo[]; loading: boolean; note?: string }>({ repos: [], loading: false });
  useEffect(() => {
    if (query.length < 2) {
      setState({ repos: [], loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, note: undefined }));
    const timer = setTimeout(() => {
      searchSkillRepos(query)
        .then(
          (found) =>
            live &&
            setState({
              repos: found.repos.slice(0, 5),
              loading: false,
              note: found.waitSeconds ? `GitHub asks to wait ${found.waitSeconds}s before searching again.` : undefined,
            }),
        )
        .catch((e) => live && setState({ repos: [], loading: false, note: String(e) }));
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  return state;
}

export function SkillIcon({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300",
        size === "md" ? "size-8 rounded-lg [&_svg]:size-4" : "size-5 [&_svg]:size-3.5",
      )}
    >
      <FileTextIcon />
    </span>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 pl-9" />
    </div>
  );
}

function PickerSection({ title, empty, busy, children }: { title: string; empty?: string; busy?: boolean; children: ReactNode }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-1.5 px-0.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {title}
        {busy && <LoaderIcon className="size-3 animate-spin" />}
      </h3>
      {hasItems ? <ul className="-mx-2.5 flex flex-col">{children}</ul> : empty && <p className="px-0.5 py-1 text-xs text-muted-foreground">{empty}</p>}
    </section>
  );
}

function PickRow({
  icon,
  title,
  meta,
  suggested,
  on,
  disabled,
  onToggle,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  suggested?: boolean;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
          disabled ? "cursor-not-allowed opacity-50" : "hover:bg-muted/50",
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{title}</span>
            {suggested && <SuggestedTag />}
          </span>
          {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
        </span>
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
          )}
        >
          {on && <CheckIcon className="size-3.5" strokeWidth={3} />}
        </span>
      </button>
    </li>
  );
}

export function SuggestedTag({ label = "Suggested" }: { label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-px text-[10px] font-semibold text-violet-700 dark:text-violet-300">
      <LightbulbIcon className="size-2.5" aria-hidden /> {label}
    </span>
  );
}
