import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  type ModelSelectorLogoProps,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import { ScrollMore, useScrollFade } from "@/components/ui/scroll-fade";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, FilmIcon, ImageIcon, KeyRoundIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OPENCODE_DEFAULT_ID, type AiModel } from "../models";

/**
 * What a heading actually offers. Two tabs called "Agents" and "Models" put
 * the same provider in both places — the tab was the only thing saying which
 * OpenCode was behind it — so providers are a rail down the side now, split by
 * where they run: the same name can appear under both "Your API keys" and
 * "Via OpenCode", and the section says which is which.
 */
type GroupKind = "agent" | "chat";

const KIND_LABEL: Record<GroupKind, { badge: string; title: string }> = {
  agent: { badge: "Agent", title: "Works in your folders — files, terminal and MCP tools" },
  chat: { badge: "Chat", title: "Answers only — no file access" },
};

/**
 * Where a provider's models actually run, which is what the rail sorts by —
 * except `setup`, which wins over all of them: a provider with no API key and
 * a CLI that has not been signed into cannot answer anything yet, and mixing
 * them in with the ready ones made the list look like a menu of models that
 * work. They keep their place in the rail so a key can still be added from
 * here, but below everything that is ready, under a heading that says so.
 */
type SectionId = "cli" | "key" | "opencode" | "setup";

const SECTIONS: { id: SectionId; label: string; hint: string }[] = [
  { id: "cli", label: "CLI agents", hint: "Runs on the subscription you signed in with" },
  { id: "key", label: "Your API keys", hint: "Called straight over its API with your key" },
  { id: "opencode", label: "Via OpenCode", hint: "Routed through the OpenCode server" },
  {
    id: "setup",
    label: "Not set up yet",
    hint: "No API key or sign-in yet — picking one asks for it first",
  },
];

const SETUP_NOTICE =
  "These can't answer yet. Pick one and you'll be asked for its API key or sign-in; it moves up the list once it works.";

export type Group = {
  key: string;
  /** Provider name as the user knows it. */
  label: string;
  /** Where it runs, when the name alone doesn't say. */
  note?: string;
  kind: GroupKind;
  section: SectionId;
  items: AiModel[];
};

/** A signed-in CLI is the one a user most often means, so it leads the rail. */
const CLI_RANK = ["Cursor CLI", "Codex CLI", "Antigravity CLI"];

type Props = {
  models: AiModel[];
  selected: AiModel;
  loading?: boolean;
  onSelect: (model: AiModel) => void;
};

/**
 * The agent in front of the model name for the CLIs, because their models are
 * named almost exactly like OpenCode's: picking "muse-spark-1.3-medium" from
 * the Cursor list and expecting OpenCode to answer is an easy mistake, and an
 * expensive one when the CLI runs on a different subscription.
 */
function agentLabel(model: AiModel) {
  if (model.source !== "cli") return model.name;
  return `${model.group.replace(/\s*CLI$/i, "")} · ${model.name}`;
}

/** The single place to choose a model, OpenCode models included. */
export function ModelPicker({ models, selected, loading, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const groups = useMemo(() => buildGroups(models), [models]);
  const query = search.trim().toLowerCase();

  // Search narrows the rail too, so a provider with no match disappears
  // instead of opening onto an empty list.
  const shown = useMemo(() => {
    if (!query) return groups;
    return groups
      .map((group) => ({ ...group, items: group.items.filter((m) => matches(m, query)) }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const selectedKey = groupKeyOf(selected);
  const active =
    shown.find((g) => g.key === picked) ??
    shown.find((g) => g.key === selectedKey) ??
    shown[0];

  useEffect(() => {
    if (open) return;
    setSearch("");
    setPicked(null);
  }, [open]);

  const select = (model: AiModel) => {
    onSelect(model);
    setOpen(false);
  };

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="max-w-56 min-w-0 shrink gap-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Select AI model"
        >
          {modelIsConnected(selected) && <ConnectedDot />}
          <Logo provider={selected.provider} />
          <ModelSelectorName className="text-sm font-normal">
            {agentLabel(selected)}
          </ModelSelectorName>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent
        title="Select model"
        className="max-h-[min(34rem,85svh)] sm:max-w-3xl"
        commandProps={{ shouldFilter: false }}
      >
        <ModelSelectorInput
          placeholder="Search every provider…"
          value={search}
          onValueChange={setSearch}
        />

        {shown.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            {query
              ? "No models match your search."
              : loading
                ? "Loading models…"
                : "Nothing to pick yet. Add an API key in Settings → Models, sign in to a CLI in Settings → Agents, or start the OpenCode server."}
          </p>
        ) : (
          <div className="flex h-[min(28rem,70svh)] min-h-0 flex-col sm:flex-row">
            <ProviderRail
              groups={shown}
              activeKey={active?.key}
              onPick={setPicked}
            />
            {active && (
              <ModelList group={active} selected={selected} onSelect={select} />
            )}
          </div>
        )}
      </ModelSelectorContent>
    </ModelSelector>
  );
}

/**
 * The providers, down the side. Below `sm` it turns into one scrolling strip
 * of chips, where section headings would only get in the way.
 */
function ProviderRail({
  groups,
  activeKey,
  onPick,
}: {
  groups: Group[];
  activeKey?: string;
  onPick: (key: string) => void;
}) {
  const fade = useScrollFade<HTMLElement>(groups);

  return (
    <div className="relative shrink-0 border-b sm:w-56 sm:border-r sm:border-b-0">
      <nav
        ref={fade.ref}
        onScroll={fade.onScroll}
        style={fade.style}
        aria-label="Providers"
        className="scroll-hidden flex max-h-32 gap-1 overflow-x-auto overflow-y-auto p-1 sm:h-full sm:max-h-none sm:flex-col sm:gap-0 sm:overflow-x-hidden sm:[&>div:first-child>p]:pt-1"
      >
        {SECTIONS.map(({ id, label, hint }) => {
          const inSection = groups.filter((group) => group.section === id);
          if (inSection.length === 0) return null;
          return (
            <div key={id} className="contents sm:block">
              <p
                title={hint}
                className="hidden px-2 pt-2.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase sm:block"
              >
                {label}
              </p>
              {inSection.map((group) => (
                <RailItem
                  key={group.key}
                  group={group}
                  active={group.key === activeKey}
                  onPick={() => onPick(group.key)}
                />
              ))}
            </div>
          );
        })}
      </nav>
      <ScrollMore show={fade.more} className="hidden sm:flex" />
    </div>
  );
}

function RailItem({
  group,
  active,
  onPick,
}: {
  group: Group;
  active: boolean;
  onPick: () => void;
}) {
  const connected = groupIsConnected(group.items);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={active || undefined}
      title={group.note ? `${group.label} ${group.note}` : group.label}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors sm:w-full",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      {connected ? (
        <ConnectedDot className="size-1.5" title="Ready to use" />
      ) : (
        <span className="size-1.5 shrink-0" aria-hidden />
      )}
      <Logo provider={group.items[0]?.provider ?? "opencode"} />
      <span className="min-w-0 truncate sm:flex-1">{group.label}</span>
      <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
        {group.items.length}
      </span>
    </button>
  );
}

function ModelList({
  group,
  selected,
  onSelect,
}: {
  group: Group;
  selected: AiModel;
  onSelect: (model: AiModel) => void;
}) {
  const { badge, title } = KIND_LABEL[group.kind];
  const fade = useScrollFade<HTMLDivElement>(group.key);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
        <Logo provider={group.items[0]?.provider ?? "opencode"} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {group.label}
          {group.note && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{group.note}</span>
          )}
        </span>
        <span
          title={title}
          className={cn(
            "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
            group.kind === "agent"
              ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
              : "border-border bg-muted/60 text-muted-foreground",
          )}
        >
          {badge}
        </span>
      </div>
      {group.section === "setup" && (
        <p className="border-b bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          {SETUP_NOTICE}
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        <ModelSelectorList
          ref={fade.ref}
          onScroll={fade.onScroll}
          style={fade.style}
          className="h-full max-h-none px-1 py-1"
        >
          {group.items.map((model) => (
            <ModelRow key={model.id} model={model} selected={selected} onSelect={onSelect} />
          ))}
        </ModelSelectorList>
        <ScrollMore show={fade.more} />
      </div>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: AiModel;
  selected: AiModel;
  onSelect: (model: AiModel) => void;
}) {
  const active = model.id === selected.id;
  const connected = modelIsConnected(model);

  return (
    <ModelSelectorItem
      value={model.id}
      onSelect={() => onSelect(model)}
      className={cn("min-w-0 gap-2 py-2 [&>svg:last-child]:hidden my-1", active && "bg-muted")}
    >
      {connected ? (
        <ConnectedDot title="Ready to use" />
      ) : (
        <span className="size-2 shrink-0" aria-hidden />
      )}
      <Logo provider={model.provider} />
      <ModelSelectorName className="min-w-0">{model.name}</ModelSelectorName>
      <ModelBadge model={model} />
      {active && <CheckIcon className="size-4 shrink-0 text-foreground" />}
    </ModelSelectorItem>
  );
}

function ConnectedDot({
  className,
  title = "Connected",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "size-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_6px_1px_rgba(16,185,129,0.45)] ring-2 ring-background",
        className,
      )}
    />
  );
}

function ModelBadge({ model }: { model: AiModel }) {
  // The one thing a row has to say about itself: this model answers with a
  // file, not with words. Picking "Gemini 3 Pro Image" expecting a reply and
  // getting a drawing is the mistake worth one badge.
  if (model.media) {
    return (
      <span
        title={`Answers with ${model.media === "video" ? "a video clip" : "a picture"}, not text — describe what you want made`}
        className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700 dark:text-fuchsia-300"
      >
        {model.media === "video" ? (
          <FilmIcon className="size-2.5" />
        ) : (
          <ImageIcon className="size-2.5" />
        )}
        {model.media === "video" ? "Video" : "Image"}
      </span>
    );
  }
  if (model.needsLogin) {
    return (
      <span
        title={`Sign in to ${model.group} to use its models`}
        className="ml-auto flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
      >
        <KeyRoundIcon className="size-2.5" />
        Sign in
      </span>
    );
  }
  if (model.needsKey) {
    return (
      <span
        title={`${model.group} has no API key yet — picking this asks for one`}
        className="ml-auto flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
      >
        <KeyRoundIcon className="size-2.5" />
        Add key
      </span>
    );
  }
  if (model.free) {
    return (
      <span className="ml-auto shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        Free
      </span>
    );
  }
  return <span className="ml-auto" />;
}

function Logo({ provider }: { provider: string }) {
  return (
    <ModelSelectorLogo
      provider={provider as ModelSelectorLogoProps["provider"]}
      className="size-4 shrink-0"
      onError={(event) => {
        event.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}

function matches(model: AiModel, query: string) {
  return (
    model.name.toLowerCase().includes(query) ||
    model.id.toLowerCase().includes(query) ||
    model.group.toLowerCase().includes(query)
  );
}

function modelIsConnected(model: AiModel) {
  return !model.needsKey && !model.needsLogin;
}

function groupIsConnected(items: AiModel[]) {
  return items.some(modelIsConnected);
}

function sectionOf(model: AiModel): SectionId {
  if (!modelIsConnected(model)) return "setup";
  if (model.source === "cli") return "cli";
  if (model.source === "opencode") return "opencode";
  return "key";
}

/**
 * Anthropic-with-your-key and Anthropic-through-OpenCode are different runs on
 * different credentials, so they stay separate entries even though the
 * provider name is the same.
 */
function groupKeyOf(model: AiModel) {
  return `${sectionOf(model)}:${model.group}`;
}

/**
 * Only needed where the rail's section heading isn't in view — and under
 * "Not set up yet", where CLI agents and OpenCode providers sit together and
 * the heading no longer says which is which.
 */
function noteFor(model: AiModel) {
  if (model.source === "api" || model.source === "local") return "· your key";
  if (model.source === "cli") return model.needsLogin ? "· CLI agent, sign in" : undefined;
  if (model.source === "opencode" && model.id !== OPENCODE_DEFAULT_ID) return "· via OpenCode";
  return undefined;
}

/**
 * The list only ever offers models that work in the mode it was built for.
 * A row that could be looked at but not picked was the worst of both: it
 * lengthened every provider's list and still had to be explained. A model fit
 * for both Chat and Cowork appears in both; one fit for neither appears in
 * neither (see `issue` in `models.ts`).
 */
export function buildGroups(models: AiModel[]): Group[] {
  const map = new Map<string, Group>();
  for (const model of models.filter((m) => !m.issue)) {
    const key = groupKeyOf(model);
    const group = map.get(key);
    if (group) {
      group.items.push(model);
      continue;
    }
    map.set(key, {
      key,
      label: model.group,
      note: noteFor(model),
      kind: model.source === "opencode" || model.source === "cli" ? "agent" : "chat",
      section: sectionOf(model),
      items: [model],
    });
  }
  return [...map.values()]
    .map((group) => ({ ...group, items: sortModels(group.items) }))
    .sort(compareGroups);
}

/** Sections in rail order, then a fixed CLI order, then connected, then A–Z. */
function compareGroups(a: Group, b: Group) {
  const sa = SECTIONS.findIndex((s) => s.id === a.section);
  const sb = SECTIONS.findIndex((s) => s.id === b.section);
  if (sa !== sb) return sa - sb;
  if (a.section === "cli") {
    const ra = CLI_RANK.indexOf(a.label);
    const rb = CLI_RANK.indexOf(b.label);
    if (ra !== rb) return (ra === -1 ? CLI_RANK.length : ra) - (rb === -1 ? CLI_RANK.length : rb);
  }
  // OpenCode's own pick is the safe default, so it heads its section.
  const da = Number(a.items.some((m) => m.id === OPENCODE_DEFAULT_ID));
  const db = Number(b.items.some((m) => m.id === OPENCODE_DEFAULT_ID));
  if (da !== db) return db - da;
  const ca = groupIsConnected(a.items);
  const cb = groupIsConnected(b.items);
  if (ca !== cb) return ca ? -1 : 1;
  return a.label.localeCompare(b.label);
}

function sortModels(items: AiModel[]): AiModel[] {
  return [...items].sort((a, b) => {
    const ca = modelIsConnected(a);
    const cb = modelIsConnected(b);
    if (ca !== cb) return ca ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
