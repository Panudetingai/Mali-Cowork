import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useInstructions } from "@/features/instructions";
import {
  catalogConnectorsSuggested,
  catalogServer,
  installedFromRegistry,
  McpToolIcon,
  useCustomMcps,
  useInstalledConnectors,
  type McpDef,
  type RegistryServer,
} from "@/features/mcp";
import { hasRecommendedSkill, recommendedSkill, recommendedSkillsFor, type RecommendedSkill } from "@/features/skills";
import type { TeammateProposal } from "@/features/team";
import { cn } from "@/lib/utils";
import { RegistryIcon } from "@/pages/settings/mcp/connector-icon";
import { CheckIcon, DownloadIcon, LoaderIcon, PackagePlusIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { EnvFields, useConnectorInstall, useSkillInstall } from "./bot-maker-install";
import { SkillIcon, useRegistrySearch } from "./bot-maker-pickers";

/** At most this many of each, so the list stays a short to-do. */
const MAX_CONNECTORS = 4;
const MAX_SKILLS = 3;

type Props = {
  proposal: TeammateProposal;
  pickedConnectors: string[];
  pickedSkills: string[];
  onConnectors: (ids: string[]) => void;
  onSkills: (ids: string[]) => void;
  /** Open a picker, e.g. to see more Registry results for some words. */
  onMore: (kind: "connectors" | "skills", query?: string) => void;
};

/**
 * What this bot works better with that isn't on this computer yet — the
 * writer's picks, and anything its duty names. Each installs in place and is
 * added to the bot; nothing installs until the user presses the button.
 */
export function RecommendedInstalls({ proposal: p, pickedConnectors, pickedSkills, onConnectors, onSkills, onMore }: Props) {
  const installed = useInstalledConnectors();
  const custom = useCustomMcps();
  const { skills } = useInstructions();
  const duty = `${p.role}\n${p.instructions}`;

  // What was missing when the bot was opened: rows stay (as "Added") once installed.
  const [missing] = useState(() => {
    const added = new Set(installed.map((c) => c.id));
    const builtIns = [...new Set([...(p.installConnectors ?? []), ...catalogConnectorsSuggested(p.role, p.instructions, added).map((s) => s.id)])]
      .filter((id) => !added.has(id))
      .map(catalogServer)
      .filter((s): s is McpDef => !!s)
      .slice(0, MAX_CONNECTORS);
    const finds = (p.findConnectors ?? []).slice(0, Math.max(0, MAX_CONNECTORS - builtIns.length));
    const toInstall = [
      ...(p.installSkills ?? []).map(recommendedSkill).filter((s): s is RecommendedSkill => !!s),
      ...recommendedSkillsFor(duty, skills),
    ];
    const skillRows = [...new Map(toInstall.map((s) => [s.id, s])).values()]
      .filter((s) => !hasRecommendedSkill(s, skills))
      .slice(0, MAX_SKILLS);
    return { builtIns, finds, skills: skillRows };
  });

  const addConnectors = (ids: string[]) => onConnectors([...new Set([...pickedConnectors, ...ids])]);
  const addSkills = (ids: string[]) => onSkills([...new Set([...pickedSkills, ...ids])]);
  const connector = useConnectorInstall((ids) => {
    addConnectors(ids);
    toast.success("Installed and added to the bot.");
  });
  const skill = useSkillInstall((ids) => {
    addSkills(ids);
    toast.success("Installed and added to the bot.");
  });

  const total = missing.builtIns.length + missing.finds.length + missing.skills.length;
  if (total === 0) return null;

  const builtInDone = (id: string) => installed.some((c) => c.id === id) && pickedConnectors.includes(id);
  const skillId = (s: RecommendedSkill) =>
    skills.find((k) => hasRecommendedSkill(s, [k]))?.id;
  const done =
    missing.builtIns.filter((s) => builtInDone(s.id)).length + missing.skills.filter((s) => {
      const id = skillId(s);
      return !!id && pickedSkills.includes(id);
    }).length;

  return (
    <div className="border-t border-border/60 bg-gradient-to-b from-violet-500/[0.035] to-transparent px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
            <PackagePlusIcon className="size-3.5" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] font-medium">Recommended to install</span>
            <span className="text-[11px] leading-snug text-muted-foreground">
              This bot works better with these. Nothing installs until you press Install — then it’s added to the bot.
            </span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums ring-1 ring-border/60">
          {done}/{missing.builtIns.length + missing.skills.length} added
        </span>
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {missing.builtIns.map((s) => {
          const isAdded = installed.some((c) => c.id === s.id);
          const inBot = pickedConnectors.includes(s.id);
          const settingUp = connector.setup === s.id;
          return (
            <Row
              key={s.id}
              wide={settingUp}
              icon={<McpToolIcon mcp={{ serverId: s.id, serverName: s.name, tool: "", def: s }} size={22} />}
              title={s.name}
              kind="Connector"
              description={s.description}
              action={
                isAdded && inBot ? (
                  <Added />
                ) : isAdded ? (
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => addConnectors([s.id])}>
                    <PlusIcon className="size-3.5" /> Add to bot
                  </Button>
                ) : (
                  <Button size="sm" className="h-7 gap-1" disabled={!!connector.connecting} onClick={() => void connector.connect(s)}>
                    {connector.connecting === s.id ? <LoaderIcon className="size-3.5 animate-spin" /> : <DownloadIcon className="size-3.5" />}
                    {settingUp ? "Connect" : (s.envVars ?? []).length > 0 ? "Set up" : "Install"}
                  </Button>
                )
              }
            >
              {settingUp && !isAdded && (
                <div className="flex flex-col gap-2.5 rounded-lg bg-muted/50 p-3">
                  <EnvFields server={s} env={connector.env} onChange={connector.setEnv} />
                  <button type="button" onClick={connector.cancelSetup} className="self-start text-[11px] text-muted-foreground hover:text-foreground">
                    Cancel
                  </button>
                </div>
              )}
            </Row>
          );
        })}

        {missing.finds.map((words) => (
          <RegistryRow
            key={words}
            words={words}
            picked={pickedConnectors}
            installedIds={installed.map((c) => c.id)}
            custom={custom}
            waitingFor={connector.waitingFor}
            onInstall={connector.installFromRegistry}
            onAdd={(id) => addConnectors([id])}
            onMore={() => onMore("connectors", words)}
          />
        ))}

        {missing.skills.map((s) => {
          const id = skillId(s);
          const inBot = !!id && pickedSkills.includes(id);
          return (
            <Row
              key={s.id}
              icon={<SkillIcon size="md" />}
              title={s.name}
              kind="Skill"
              description={`${s.description} · ${s.repo}`}
              action={
                id && inBot ? (
                  <Added />
                ) : id ? (
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => addSkills([id])}>
                    <PlusIcon className="size-3.5" /> Add to bot
                  </Button>
                ) : (
                  <Button size="sm" className="h-7 gap-1" disabled={skill.waitingFor === s.url} onClick={() => skill.install(s.url)}>
                    {skill.waitingFor === s.url ? <LoaderIcon className="size-3.5 animate-spin" /> : <DownloadIcon className="size-3.5" />}
                    Install
                  </Button>
                )
              }
            />
          );
        })}
      </ul>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <button type="button" onClick={() => onMore("connectors")} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <SearchIcon className="size-3" /> Find other connectors
        </button>
        <button type="button" onClick={() => onMore("skills")} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <SearchIcon className="size-3" /> Find other skills
        </button>
      </div>
    </div>
  );
}

/** An app the writer named that isn't built in: the Registry's best match for its words. */
function RegistryRow({
  words,
  picked,
  installedIds,
  custom,
  waitingFor,
  onInstall,
  onAdd,
  onMore,
}: {
  words: string;
  picked: string[];
  installedIds: string[];
  custom: ReturnType<typeof useCustomMcps>;
  waitingFor?: string;
  onInstall: (server: RegistryServer) => void;
  onAdd: (id: string) => void;
  onMore: () => void;
}) {
  const found = useRegistrySearch(words, 1);
  const server = found.servers[0];
  const own = server ? installedFromRegistry(server.name, custom) : undefined;
  const id = own && installedIds.includes(own.id) ? own.id : undefined;

  if (found.loading || (!server && !found.error)) {
    return (
      <Row
        icon={<span className="flex size-8 items-center justify-center rounded-lg bg-muted"><LoaderIcon className="size-4 animate-spin text-muted-foreground" /></span>}
        title={`Finding a connector for “${words}”…`}
        kind="MCP Registry"
      />
    );
  }
  if (!server) return null;
  return (
    <Row
      icon={<RegistryIcon icons={server.icons} size={32} />}
      title={server.title}
      kind="MCP Registry"
      description={server.description}
      action={
        id && picked.includes(id) ? (
          <Added />
        ) : id ? (
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => onAdd(id)}>
            <PlusIcon className="size-3.5" /> Add to bot
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button size="sm" className="h-7 gap-1" disabled={waitingFor === server.name} onClick={() => onInstall(server)}>
              {waitingFor === server.name ? <LoaderIcon className="size-3.5 animate-spin" /> : <DownloadIcon className="size-3.5" />}
              Install
            </Button>
          </div>
        )
      }
      footer={
        !id && (
          <button type="button" onClick={onMore} className="text-[11px] text-muted-foreground hover:text-foreground">
            Not this one? See more for “{words}”
          </button>
        )
      }
    />
  );
}

function Row({
  icon,
  title,
  kind,
  description,
  action,
  footer,
  wide,
  children,
}: {
  icon: ReactNode;
  title: string;
  kind: "Connector" | "MCP Registry" | "Skill";
  description?: string;
  action?: ReactNode;
  footer?: ReactNode;
  /** Its keys are being filled in: take the whole row. */
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={cn("flex min-w-0 flex-col gap-2.5 rounded-xl border border-border/70 bg-background p-3", wide && "sm:col-span-2")}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium">{title}</span>
            <span
              className={cn(
                "shrink-0 rounded px-1 py-px text-[9.5px] font-semibold tracking-wide uppercase",
                kind === "Skill" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-sky-500/10 text-sky-700 dark:text-sky-300",
              )}
            >
              {kind}
            </span>
          </span>
          {description && <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">{description}</span>}
          {footer}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </li>
  );
}

function Added() {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-500/10 px-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <CheckIcon className="size-3.5" strokeWidth={3} /> Added
    </span>
  );
}
